import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function POST(request: Request) {
  try {
    const { lista } = await request.json();

    if (!lista || lista.length === 0) {
      return NextResponse.json({ success: false, message: 'La lista está vacía' }, { status: 400 });
    }

    // 1. PREPARAR TEXTOS Y FORMATOS
    const resumenTexto = lista.map((item: any) => 
      `🔹 ${item.cantidadPedir} uds. de ${item.productName} (Talla: ${item.size})`
    ).join('\n');
    
    const mensajeTelegram = `¡Hola!\n\nRevisando el inventario de la Tienda Scout, aquí tienes la lista de prendas por debajo del stock mínimo para pedir a fábrica:\n\n${resumenTexto}`;

    const itemsHtml = lista.map((item: any) => 
      `<li style="margin-bottom: 5px;">
        <strong>${item.cantidadPedir} uds.</strong> de ${item.productName} 
        <span style="color: #6b21a8; font-weight: bold;">(Talla: ${item.size})</span>
      </li>`
    ).join('');

    // 2. ENVIAR POR TELEGRAM
    const token = process.env.NEXT_PUBLIC_TELEGRAM_TOKEN;
    const chatId = process.env.NEXT_PUBLIC_TELEGRAM_CHAT_ID;
    
    if (token && chatId) {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      // Usamos .catch() para que si falla Telegram, no bloquee el envío del correo
      await fetch(url, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ chat_id: chatId, text: `🏭 *PEDIDO A FÁBRICA*\n\n${mensajeTelegram}` }) 
      }).catch(err => console.error('Error enviando a Telegram:', err));
    }

    // 3. ENVIAR POR CORREO (Gmail)
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: `"Administración Tienda Scout" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER, // Te lo envías a vuestro propio correo
      subject: `🏭 Lista de artículos para pedir a fábrica`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 15px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
          <div style="background-color: #6b21a8; padding: 20px; text-align: center;">
            <h2 style="color: white; margin: 0;">📦 Pedido a Fábrica</h2>
          </div>
          <div style="padding: 20px;">
            <p style="font-size: 16px;">¡Hola!</p>
            <p style="font-size: 15px; line-height: 1.5;">
              Revisando el inventario de la Tienda Scout y las estadísticas de ventas, aquí tienes la lista de prendas que se encuentran por debajo del stock mínimo fijado y que debes solicitar a fábrica:
            </p>
            
            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 10px; margin-top: 20px;">
              <ul style="font-size: 15px; margin: 0; padding-left: 20px;">
                ${itemsHtml}
              </ul>
            </div>
            
            <p style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 30px;">
              Generado automáticamente desde la pestaña "Estudio de Stock y Ventas".
            </p>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error enviando la lista a fábrica:', error);
    return NextResponse.json({ success: false, error: 'Fallo al enviar correo o telegram' }, { status: 500 });
  }
}