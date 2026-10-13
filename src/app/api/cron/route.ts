import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase'; // Ajusta los ../ si te da error de ruta

export async function GET() {
  try {
    // 1. MANTENER SUPABASE DESPIERTO
    await supabase.from('configuracion').select('id').limit(1);

    // 2. CALCULAR FECHA LÍMITE (hace 15 días)
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() - 15); 
    const fechaISO = fechaLimite.toISOString();

    // 3. BUSCAR PEDIDOS CADUCADOS ANTES DE BORRARLOS
    const { data: pedidosCaducados, error: selectError } = await supabase
      .from('orders')
      .select('id')
      .eq('status', 'Pendiente')
      .lt('created_at', fechaISO);

    if (selectError) throw selectError;

    // Si hay pedidos caducados, procedemos a devolver el stock y borrarlos
    if (pedidosCaducados && pedidosCaducados.length > 0) {
      const idsPedidos = pedidosCaducados.map(p => p.id);

      // Obtenemos todos los artículos de esos pedidos caducados
      const { data: articulos, error: itemsError } = await supabase
        .from('order_items')
        .select('variant_id, quantity')
        .in('order_id', idsPedidos); // Busca los items que pertenezcan a estos pedidos

      if (!itemsError && articulos && articulos.length > 0) {
        // Agrupamos cuántas unidades hay que devolver de cada variante
        const devoluciones = articulos.reduce((acumulador: any, item: any) => {
          const vId = item.variant_id;
          if (!acumulador[vId]) acumulador[vId] = 0;
          acumulador[vId] += (item.quantity || 1);
          return acumulador;
        }, {});

        // Devolvemos el stock variante por variante
        for (const [variantId, cantidadADevolver] of Object.entries(devoluciones)) {
          // Consultamos el stock actual de esa variante
          const { data: varianteData } = await supabase
            .from('product_variants')
            .select('stock')
            .eq('id', variantId)
            .single();
            
          if (varianteData) {
            // Le sumamos lo que acabamos de rescatar del pedido caducado
            await supabase
              .from('product_variants')
              .update({ stock: varianteData.stock + (cantidadADevolver as number) })
              .eq('id', variantId);
          }
        }
      }

      // 4. AHORA SÍ, BORRAMOS LOS PEDIDOS (ya hemos rescatado el stock)
      const { error: deleteError } = await supabase
        .from('orders')
        .delete()
        .in('id', idsPedidos);

      if (deleteError) throw deleteError;
    }

    return NextResponse.json({ 
      success: true,
      message: '¡Mantenimiento completado! Supabase despertado y stock de pedidos caducados devuelto correctamente. 🧹📦', 
      timestamp: new Date().toISOString() 
    }, { status: 200 });

  } catch (error: any) {
    return NextResponse.json({ 
      success: false,
      message: 'Error al ejecutar las tareas de mantenimiento',
      detalles_del_error: error?.message || "Error desconocido."
    }, { status: 500 });
  }
}