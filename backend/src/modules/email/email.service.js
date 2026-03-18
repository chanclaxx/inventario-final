const negocioNombre = (config) => config?.nombre_negocio || 'Tu Tienda';

// ── Cliente Brevo inicializado lazy ───────────────────────────────────────────
let _brevoClient = null;

const _getBrevoClient = () => {
  if (_brevoClient) return _brevoClient;
  const SibApiV3Sdk = require('@getbrevo/brevo');
  const client      = new SibApiV3Sdk.TransactionalEmailsApi();
  const apiKey      = client.authentications['api-key'];
  apiKey.apiKey     = process.env.BREVO_API_KEY;
  _brevoClient      = client;
  return client;
};

// ── Envío silencioso — nunca lanza error al caller ───────────────────────────
const _enviarSilencioso = async (payload) => {
  try {
    if (!process.env.BREVO_API_KEY) {
      console.warn('[email] BREVO_API_KEY no configurada — email omitido');
      return { ok: false, razon: 'sin_config' };
    }

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method:  'POST',
      headers: {
        'accept':       'application/json',
        'content-type': 'application/json',
        'api-key':      process.env.BREVO_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const texto = await response.text().catch(() => 'sin detalle');
      console.warn(`[email] ✗ No se pudo enviar (${response.status}): ${texto}`);
      return { ok: false, razon: texto };
    }

    console.info(`[email] ✓ Enviado a ${payload.to?.[0]?.email}`);
    return { ok: true };
  } catch (err) {
    console.warn(`[email] ✗ No se pudo enviar (desconocido): ${err?.message || err}`);
    return { ok: false, razon: err?.message || 'Error desconocido' };
  }
};

// ── Formateador COP reutilizable ──────────────────────────────────────────────
const _cop = (valor) =>
  new Intl.NumberFormat('es-CO', {
    style:                'currency',
    currency:             'COP',
    maximumFractionDigits: 0,
  }).format(valor);

// ── Template HTML de factura ──────────────────────────────────────────────────
const _htmlFactura = (factura, config) => {
  const nombre  = negocioNombre(config);
  const total   = factura.lineas?.reduce((s, l)  => s + Number(l.subtotal    || 0), 0) || 0;
  const pagado  = factura.pagos?.reduce((s, p)   => s + Number(p.valor       || 0), 0) || 0;
  const retomas = factura.retomas?.reduce((s, r) => s + Number(r.valor_retoma || 0), 0) || 0;
  const neto    = total - retomas;
  const cambio  = pagado - neto;

  // ── Filas de productos ────────────────────────────────────────────────────
  const filaProducto = (l) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">
        <div style="font-weight:600;color:#1a1a1a;">${l.nombre_producto}</div>
        ${l.imei ? `<div style="font-size:11px;color:#999;font-family:monospace;">IMEI: ${l.imei}</div>` : ''}
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:center;color:#555;">${l.cantidad}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right;color:#555;">${_cop(l.precio)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;color:#1a1a1a;">${_cop(l.subtotal)}</td>
    </tr>
  `;

  // ── Filas de retomas ──────────────────────────────────────────────────────
  const filaRetoma = (r) => `
    <tr>
      <td colspan="3" style="padding:6px 12px;color:#7c3aed;font-size:13px;">
        Retoma: ${r.descripcion}${r.imei ? ` (IMEI: ${r.imei})` : ''}
      </td>
      <td style="padding:6px 12px;text-align:right;color:#7c3aed;font-weight:600;">
        - ${_cop(r.valor_retoma)}
      </td>
    </tr>
  `;

  // ── Filas de pagos ────────────────────────────────────────────────────────
  const filaPago = (p) => `
    <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:14px;color:#555;">
      <span>${p.metodo}</span>
      <span>${_cop(p.valor)}</span>
    </div>
  `;

  // ── Sección de garantías — solo si hay garantías aplicables ───────────────
  const garantias = factura.garantias || [];
  const seccionGarantias = garantias.length === 0 ? '' : `
    <div style="padding:24px 32px 0;">
      <h2 style="margin:0 0 16px;font-size:15px;color:#374151;font-weight:600;
        text-transform:uppercase;letter-spacing:0.05em;">
        Términos y Garantías
      </h2>
      ${[...garantias]
        .sort((a, b) => a.orden - b.orden)
        .map((g) => `
          <div style="margin-bottom:16px;">
            <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1a1a1a;">
              ${g.titulo}
            </p>
            <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.6;
              white-space:pre-wrap;word-break:break-word;">
              ${g.texto}
            </p>
          </div>
        `).join('')}
    </div>
  `;

  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:12px;
    overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="background:#2563eb;padding:24px 32px;">
      <h1 style="margin:0;color:#fff;font-size:22px;">${nombre}</h1>
      <p style="margin:4px 0 0;color:#bfdbfe;font-size:14px;">
        Factura #${String(factura.id).padStart(6, '0')}
      </p>
    </div>

    <!-- Cliente -->
    <div style="padding:24px 32px 0;">
      <h2 style="margin:0 0 12px;font-size:15px;color:#374151;font-weight:600;
        text-transform:uppercase;letter-spacing:0.05em;">Cliente</h2>
      <p style="margin:0;font-size:15px;font-weight:600;color:#1a1a1a;">${factura.nombre_cliente}</p>
      ${factura.cedula !== 'COMPANERO' ? `<p style="margin:2px 0;font-size:13px;color:#6b7280;">CC: ${factura.cedula}</p>` : ''}
      ${factura.celular && factura.celular !== '0000000000' ? `<p style="margin:2px 0;font-size:13px;color:#6b7280;">Tel: ${factura.celular}</p>` : ''}
    </div>

    <!-- Productos -->
    <div style="padding:24px 32px 0;">
      <h2 style="margin:0 0 12px;font-size:15px;color:#374151;font-weight:600;
        text-transform:uppercase;letter-spacing:0.05em;">Productos</h2>
      <table style="width:100%;border-collapse:collapse;border:1px solid #f0f0f0;
        border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;">Producto</th>
            <th style="padding:10px 12px;text-align:center;font-size:12px;color:#6b7280;font-weight:600;">Cant.</th>
            <th style="padding:10px 12px;text-align:right;font-size:12px;color:#6b7280;font-weight:600;">Precio</th>
            <th style="padding:10px 12px;text-align:right;font-size:12px;color:#6b7280;font-weight:600;">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${factura.lineas?.map(filaProducto).join('') || ''}
          ${garantias.length > 0 && factura.retomas?.length > 0
            ? factura.retomas.map(filaRetoma).join('')
            : (factura.retomas?.map(filaRetoma).join('') || '')}
        </tbody>
      </table>
    </div>

    <!-- Totales -->
    <div style="padding:20px 32px 0;">
      <div style="background:#f9fafb;border-radius:8px;padding:16px;">
        ${factura.pagos?.map(filaPago).join('') || ''}
        <div style="border-top:2px solid #e5e7eb;margin-top:10px;padding-top:10px;
          display:flex;justify-content:space-between;">
          <span style="font-size:16px;font-weight:700;color:#1a1a1a;">Total a pagar</span>
          <span style="font-size:16px;font-weight:700;color:#2563eb;">${_cop(neto)}</span>
        </div>
        ${cambio > 0 ? `
        <div style="display:flex;justify-content:space-between;margin-top:6px;">
          <span style="font-size:13px;color:#6b7280;">Cambio</span>
          <span style="font-size:13px;color:#059669;font-weight:600;">${_cop(cambio)}</span>
        </div>` : ''}
      </div>
    </div>

    ${factura.notas ? `
    <div style="padding:16px 32px 0;">
      <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;">
        <p style="margin:0;font-size:13px;color:#92400e;">${factura.notas}</p>
      </div>
    </div>` : ''}

    <!-- Garantías -->
    ${seccionGarantias}

    <!-- Footer -->
    <div style="padding:24px 32px;text-align:center;color:#9ca3af;font-size:12px;
      margin-top:24px;border-top:1px solid #f0f0f0;">
      <p style="margin:0;">Gracias por su compra · ${nombre}</p>
      ${config?.telefono  ? `<p style="margin:4px 0 0;">Tel: ${config.telefono}</p>`   : ''}
      ${config?.direccion ? `<p style="margin:4px 0 0;">${config.direccion}</p>`       : ''}
    </div>
  </div>
</body>
</html>
  `.trim();
};

// ── API pública ───────────────────────────────────────────────────────────────

const enviarFactura = async (factura, config) => {
  const email = factura.email || factura.cliente_email;
  if (!email) return { ok: false, razon: 'sin_email' };

  return _enviarSilencioso({
    to:      [{ email, name: factura.nombre_cliente }],
    sender:  {
      email: process.env.BREVO_FROM_EMAIL,
      name:  process.env.BREVO_FROM_NAME || negocioNombre(config),
    },
    subject: `Factura #${String(factura.id).padStart(6, '0')} — ${negocioNombre(config)}`,
    htmlContent: _htmlFactura(factura, config),
  });
};

const enviarAprobacion = async ({ email, nombre_negocio, password_temporal }) => {
  return _enviarSilencioso({
    to:      [{ email }],
    sender:  {
      email: process.env.BREVO_FROM_EMAIL,
      name:  process.env.BREVO_FROM_NAME || 'Sistema de Inventario',
    },
    subject: `Tu cuenta ha sido aprobada — ${nombre_negocio}`,
    htmlContent: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;">
        <h2 style="color:#2563eb;">¡Bienvenido, ${nombre_negocio}!</h2>
        <p>Tu cuenta ha sido aprobada. Estas son tus credenciales de acceso:</p>
        <div style="background:#f9fafb;border-radius:8px;padding:16px;margin:16px 0;">
          <p style="margin:0;"><strong>Email:</strong> ${email}</p>
          <p style="margin:8px 0 0;"><strong>Contraseña temporal:</strong>
            <span style="font-family:monospace;font-size:18px;color:#2563eb;">${password_temporal}</span>
          </p>
        </div>
        <p style="color:#6b7280;font-size:13px;">Deberás cambiar tu contraseña al iniciar sesión por primera vez.</p>
      </div>
    `,
  });
};

const enviarConfirmacionRegistro = async ({ email, nombre_negocio }) => {
  return _enviarSilencioso({
    to:      [{ email }],
    sender:  {
      email: process.env.BREVO_FROM_EMAIL,
      name:  process.env.BREVO_FROM_NAME || 'Sistema de Inventario',
    },
    subject: `Registro recibido — ${nombre_negocio}`,
    htmlContent: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;">
        <h2 style="color:#2563eb;">Registro recibido</h2>
        <p>Hemos recibido tu solicitud de registro para <strong>${nombre_negocio}</strong>.</p>
        <p>Te notificaremos cuando tu cuenta sea aprobada.</p>
      </div>
    `,
  });
};
const enviarRecuperacionPassword = async ({ email, nombre, token }) => {
  const urlBase = process.env.FRONTEND_URL || 'http://localhost:5173';
  const enlace  = `${urlBase}/nueva-contrasena?token=${token}`;
 
  return _enviarSilencioso({
    to:     [{ email, name: nombre }],
    sender: {
      email: process.env.BREVO_FROM_EMAIL,
      name:  process.env.BREVO_FROM_NAME || 'Sistema de Inventario',
    },
    subject: 'Recuperación de contraseña',
    htmlContent: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;">
        <div style="text-align:center;margin-bottom:24px;">
          <div style="width:56px;height:56px;background:#2563eb;border-radius:14px;
            display:inline-flex;align-items:center;justify-content:center;">
            <span style="color:#fff;font-size:24px;font-weight:700;">I</span>
          </div>
        </div>
 
        <h2 style="margin:0 0 8px;color:#1a1a1a;font-size:20px;">
          Recuperación de contraseña
        </h2>
        <p style="margin:0 0 20px;color:#6b7280;font-size:14px;">
          Hola <strong>${nombre}</strong>, recibimos una solicitud para restablecer
          la contraseña de tu cuenta.
        </p>
 
        <a href="${enlace}"
          style="display:block;background:#2563eb;color:#fff;text-align:center;
            padding:14px 24px;border-radius:10px;font-size:15px;font-weight:600;
            text-decoration:none;margin-bottom:20px;">
          Restablecer contraseña
        </a>
 
        <div style="background:#f9fafb;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
          <p style="margin:0;font-size:12px;color:#6b7280;">
            Si el botón no funciona, copia y pega este enlace en tu navegador:
          </p>
          <p style="margin:6px 0 0;font-size:11px;color:#2563eb;word-break:break-all;">
            ${enlace}
          </p>
        </div>
 
        <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
          Este enlace expira en <strong>1 hora</strong>. Si no solicitaste
          este cambio, ignora este mensaje — tu contraseña no será modificada.
        </p>
      </div>
    `,
  });
};

module.exports = { enviarFactura, enviarAprobacion, enviarConfirmacionRegistro,enviarRecuperacionPassword };