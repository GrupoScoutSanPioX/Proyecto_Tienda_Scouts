import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';
import nodemailer from 'nodemailer';

export async function POST(request: Request) {
  try {
    const { buyer_name, total_amount, order_items } = await request.json();

    // 1. Revisar todo el inventario para ver qué falta
    const { data: variants } = await supabase
      .from('product_variants')
      .select('id, size, stock, min_stock_alert, products(name, min_stock_alert)');

    const itemsToRestock: string[] = [];
    
    if (variants) {
      for (const v of variants) {
        // Usamos el aviso específico de la talla, o el del producto general, o 5 por defecto
        const minAlert = v.min_stock_alert ?? (v.products as any)?.min_stock_alert ?? 5;
        const currentStock = v.stock;

        // Si el stock actual es menor o igual al mínimo establecido, lo añadimos a la lista de avisos
        if (currentStock <= minAlert) {
          itemsToRestock.push(
            `<b>${(v.products as any)?.name}</b> (Talla: ${v.size}) - Quedan: <span style="color:red; font-weight:bold;">${currentStock} uds</span> (Mínimo: ${minAlert})`
          );
        }
      }
    }

    // 2. Configurar el enviador de correos
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // 3. Montar el mensaje HTML
    let itemsHtml = order_items.map((item: any) => 
      `<li><strong>${item.quantity}x</strong> ${item.product_name} (Talla: ${item.size})</li>`
    ).join('');
    
    let restockHtml = '';
    if (itemsToRestock.length > 0) {
      restockHtml = `
        <div style="background-color: #fffbeb; border: 1px solid #fde68a; padding: 15px; border-radius: 10px; margin-top: 20px;">
          <h3 style="color: #d97706; margin-top: 0;">⚠️ Alerta de Stock Bajo general</h3>
          <p style="font-size: 14px;">Deberíais ir pensando en hacer un pedido a proveedores de los siguientes artículos:</p>
          <ul style="font-size: 14px;">
            ${itemsToRestock.map(i => `<li style="margin-bottom: 5px;">${i}</li>`).join('')}
          </ul>
        </div>
      `;
    } else {
      restockHtml = `
        <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; padding: 15px; border-radius: 10px; margin-top: 20px;">
          <p style="color: #059669; margin: 0; font-weight: bold;">✅ El stock de todos los artículos de la tienda está en niveles saludables.</p>
        </div>
      `;
    }

    // 4. Enviar el correo al propio Grupo Scout
    const mailOptions = {
      from: `"Tienda Grupo Scout" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER, // Te lo envías a vuestro propio correo
      subject: `🛒 Nueva reserva de ${buyer_name} (${total_amount}€)`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 15px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
          <div style="background-color: #6b21a8; padding: 20px; text-align: center;">
            <h2 style="color: white; margin: 0;">¡Nueva reserva recibida!</h2>
          </div>
          <div style="padding: 20px;">
            <p><strong>Comprador:</strong> ${buyer_name}</p>
            <p><strong>Total a pagar:</strong> <span style="font-size: 18px; color: #059669; font-weight: bold;">${Number(total_amount).toFixed(2)} €</span></p>
            <p><strong>Artículos reservados en este pedido:</strong></p>
            <ul style="background-color: #f8fafc; padding: 15px 15px 15px 35px; border-radius: 10px;">
              ${itemsHtml}
            </ul>
            ${restockHtml}
            <p style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 30px;">
              Este es un mensaje automático de tu sistema de tienda Scout.
            </p>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error enviando aviso de reserva:', error);
    return NextResponse.json({ success: false, error: 'Fallo al enviar correo' }, { status: 500 });
  }
}