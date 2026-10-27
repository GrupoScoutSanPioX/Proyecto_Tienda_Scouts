import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';
import nodemailer from 'nodemailer';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const now = new Date();
    // Calculamos la fecha dentro de 24 horas
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const nowISO = now.toISOString();
    const tomorrowISO = tomorrow.toISOString();

    // ==========================================
    // 1. TAREA DE RECORDATORIOS (Caducan en 1 día)
    // ==========================================
    const { data: ordersToRemind, error: errRemind } = await supabase
      .from('orders')
      .select('id, buyer_name, email, total_amount')
      .in('status', ['Pendiente'])
      .eq('aviso_enviado', false)
      .lte('expires_at', tomorrowISO) // Caduca antes de 24h
      .gt('expires_at', nowISO)       // Pero aún no ha caducado
      .not('email', 'is', null);

    if (errRemind) console.error('Error buscando pedidos para avisar:', errRemind);

    if (ordersToRemind && ordersToRemind.length > 0) {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });

      for (const order of ordersToRemind) {
        if (!order.email || order.email.trim() === '') continue;

        await transporter.sendMail({
          from: `"Tienda Grupo Scout" <${process.env.EMAIL_USER}>`,
          to: order.email,
          subject: '⚠️ Tu reserva de material caduca mañana',
          html: `
            <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 12px; padding: 25px;">
              <h2 style="color: #6b21a8; margin-top: 0;">¡Hola ${order.buyer_name}!</h2>
              <p>Te escribimos desde la tienda del Grupo Scout para recordarte que tu reserva de material por valor de <strong>${Number(order.total_amount).toFixed(2)} €</strong> <b>caduca mañana</b>.</p>
              <p>Por favor, realiza el pago lo antes posible para confirmarla. Si el plazo expira, la reserva se cancelará automáticamente y los artículos volverán a estar disponibles.</p>
              <p>Si ya has realizado el pago y estamos pendientes de validarlo, puedes ignorar este mensaje.</p>
              <br/>
              <p>¡Un saludo y Buena Caza! ⚜️</p>
            </div>
          `,
        });

        await supabase.from('orders').update({ aviso_enviado: true }).eq('id', order.id);
      }
    }

    // ==========================================
    // 2. TAREA DE LIMPIEZA (Ya han caducado)
    // ==========================================
    // Solo borra pedidos "Pendiente" (nunca los "Reservado" con backorder)
    const { data: expiredOrders } = await supabase
      .from('orders')
      .select('id')
      .eq('status', 'Pendiente')
      .lt('expires_at', nowISO);

    if (expiredOrders && expiredOrders.length > 0) {
      const expiredIds = expiredOrders.map((o) => o.id);

      const { data: expiredItems } = await supabase
        .from('order_items')
        .select('variant_id, quantity')
        .in('order_id', expiredIds);

      // Devolvemos el stock al inventario
      if (expiredItems && expiredItems.length > 0) {
        for (const item of expiredItems) {
          if (!item.variant_id) continue;
          const { data: vData } = await supabase
            .from('product_variants')
            .select('stock')
            .eq('id', item.variant_id)
            .single();

          if (vData) {
            await supabase
              .from('product_variants')
              .update({ stock: vData.stock + item.quantity })
              .eq('id', item.variant_id);
          }
        }
      }

      await supabase.from('orders').delete().in('id', expiredIds);
    }

    return NextResponse.json({
      success: true,
      message: 'Rutina de limpieza y avisos ejecutada con éxito',
      avisos_procesados: ordersToRemind?.length || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error en el cron:', error);
    return NextResponse.json(
      { success: false, error: 'Fallo al ejecutar el robot', detalles: error?.message },
      { status: 500 }
    );
  }
}