const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const FROM = `Inventario <${process.env.EMAIL_USER}>`;

// ── Plantillas ────────────────────────────────────────

function templateAprobacion({ nombre_negocio, email, password_temporal }) {
  return {
    subject: '¡Tu cuenta ha sido aprobada! — Inventario',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <div style="background: #2563eb; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
          <h1 style="color: white; margin: 0; font-size: 24px;">¡Bienvenido!</h1>
        </div>
        <p style="color: #374151;">Hola, tu negocio <strong>${nombre_negocio}</strong> ha sido aprobado.</p>
        <p style="color: #374151;">Estas son tus credenciales de acceso:</p>
        <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="margin: 4px 0; color: #374151;"><strong>Email:</strong> ${email}</p>
          <p style="margin: 4px 0; color: #374151;"><strong>Contraseña temporal:</strong> ${password_temporal}</p>
        </div>
        <p style="color: #6b7280; font-size: 14px;">
          Te recomendamos cambiar tu contraseña después de iniciar sesión por primera vez.
        </p>
        <a href="${process.env.FRONTEND_URL}/login"
           style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px;
                  border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px;">
          Iniciar sesión
        </a>
      </div>
    `,
  };
}

function templateRegistroPendiente({ nombre_negocio }) {
  return {
    subject: 'Registro recibido — Inventario',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #1f2937;">Registro recibido</h2>
        <p style="color: #374151;">
          Hemos recibido la solicitud de registro para <strong>${nombre_negocio}</strong>.
        </p>
        <p style="color: #374151;">
          Nuestro equipo revisará tu solicitud y te notificará por este medio cuando esté aprobada.
        </p>
        <p style="color: #6b7280; font-size: 14px;">Si tienes preguntas, responde a este correo.</p>
      </div>
    `,
  };
}

// ── Envío ─────────────────────────────────────────────

async function enviar({ to, subject, html }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn(`[email] Sin credenciales — email no enviado a ${to}: ${subject}`);
    return;
  }
  return transporter.sendMail({ from: FROM, to, subject, html });
}

async function enviarAprobacion({ email, nombre_negocio, password_temporal }) {
  const { subject, html } = templateAprobacion({ nombre_negocio, email, password_temporal });
  return enviar({ to: email, subject, html });
}

async function enviarConfirmacionRegistro({ email, nombre_negocio }) {
  const { subject, html } = templateRegistroPendiente({ nombre_negocio });
  return enviar({ to: email, subject, html });
}

module.exports = { enviarAprobacion, enviarConfirmacionRegistro };