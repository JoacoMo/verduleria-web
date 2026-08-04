import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export const runtime = 'nodejs';

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}.`);
  }
  return value;
}

export async function POST(request: Request) {
  try {
    const { name, message, email } = await request.json();

    if (!name || !email || !message) {
      return NextResponse.json({ error: 'Faltan datos del formulario.' }, { status: 400 });
    }

    const smtpHost = getRequiredEnv('SMTP_HOST');
    const smtpPort = Number(getRequiredEnv('SMTP_PORT'));
    const smtpUser = getRequiredEnv('SMTP_USER');
    const smtpPass = getRequiredEnv('SMTP_PASS');
    const contactToEmail = getRequiredEnv('CONTACT_TO_EMAIL');
    const contactFromEmail = process.env.CONTACT_FROM_EMAIL || smtpUser;

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    await transporter.sendMail({
      from: `Verdulería Fresca <${contactFromEmail}>`,
      to: contactToEmail,
      replyTo: email,
      subject: `Nuevo mensaje de contacto de ${name}`,
      text: `Nombre: ${name}\nEmail: ${email}\n\nMensaje:\n${message}`,
      html: `<p><strong>Nombre:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p><p><strong>Mensaje:</strong></p><p>${message.replace(/\n/g, '<br />')}</p>`,
    });

    return NextResponse.json({ message: 'Mensaje enviado correctamente.' });
  } catch (error) {
    console.error('Error en POST /api/contact:', error);
    return NextResponse.json({ error: 'No se pudo enviar el mensaje.' }, { status: 500 });
  }
}