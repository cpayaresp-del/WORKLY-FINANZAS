import nodemailer from 'nodemailer';

let transporter;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });
  return transporter;
}

export async function sendPasswordResetEmail(to, token) {
  const mailer = getTransporter();
  if (!mailer) throw new Error('SMTP no está configurado');
  const baseUrl = process.env.PASSWORD_RESET_URL || 'https://workly.app/reset-password';
  await mailer.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: 'Restablece tu contraseña de Workly',
    text: `Restablece tu contraseña usando este enlace: ${baseUrl}?token=${token}`,
    html: `<p>Solicitaste restablecer tu contraseña de Workly.</p><p><a href="${baseUrl}?token=${token}">Restablecer contraseña</a></p><p>El enlace caduca en 15 minutos.</p>`,
  });
}
