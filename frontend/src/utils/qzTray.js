import { qzCertificado, qzFirmar } from '../api/etiquetas.api';

// ── QZ Tray: imprimir en la impresora de etiquetas sin pasar por Chrome ─────
//
// Chrome/Edge imprimen un PDF sobre el papel que tenga el driver y lo GIRAN
// cuando la página no calza con él; y ninguno de los dos deja que la página
// elija el tamaño del papel. En una térmica eso es una tira de 3 columnas que
// sale como 3 filas, o filas en blanco entre impresiones (DIG T451B, sep-2026).
//
// QZ Tray es un programa gratuito que se instala en el PC de la impresora y
// recibe los trabajos por un websocket local. Con él la aplicación dice el
// tamaño EXACTO del papel y la orientación en cada trabajo —como BarTender—, o
// manda directamente los comandos de la impresora (TSPL/ZPL).
//
// La librería se carga solo al usarla: pesa y el 99 % de las pantallas no
// imprime etiquetas.

let _qz = null;
let _seguridadLista = false;
let _firmado = false;

const _cargar = async () => {
  if (!_qz) {
    const m = await import('qz-tray');
    _qz = m.default || m;
  }
  return _qz;
};

const _configurarSeguridad = async (qz) => {
  if (_seguridadLista) return;
  qz.api.setPromiseType((resolver) => new Promise(resolver));

  let cert = null;
  try {
    const { data } = await qzCertificado();
    cert = typeof data === 'string' && data.includes('BEGIN CERTIFICATE') ? data : null;
  } catch { cert = null; }

  if (cert) {
    qz.security.setCertificatePromise((resolve) => resolve(cert));
    qz.security.setSignatureAlgorithm('SHA512');
    qz.security.setSignaturePromise((datos) => (resolve, reject) => {
      qzFirmar(datos).then((r) => resolve(r.data)).catch(reject);
    });
  } else {
    // Sin certificado: QZ imprime igual, pero pregunta «¿Permitir?» cada vez.
    qz.security.setCertificatePromise((resolve) => resolve());
    qz.security.setSignaturePromise(() => (resolve) => resolve());
  }
  _firmado = !!cert;
  _seguridadLista = true;
};

/** Traduce los errores de QZ a algo que el usuario pueda resolver. */
export const mensajeQz = (err) => {
  const m = String(err?.message || err || '');
  if (/establish connection|Unable to connect|websocket/i.test(m)) {
    // Chrome/Edge recientes piden permiso para que un sitio hable con programas
    // del propio computador («acceder a otras apps y servicios»): si se negó,
    // el error es idéntico a no tener QZ instalado.
    return 'No se pudo conectar con QZ Tray. Revisa que esté instalado y abierto (ícono junto al reloj; se descarga de qz.io/download). Si el navegador preguntó si este sitio puede «acceder a otras apps y servicios de este dispositivo», elige Permitir (se cambia en el candado junto a la dirección).';
  }
  if (/blocked|rejected|denied|not allowed/i.test(m)) {
    return 'QZ Tray bloqueó la impresión. Vuelve a intentarlo y en la ventana de QZ elige «Allow» (Permitir).';
  }
  if (/printer.*not found|Cannot find printer|No printer/i.test(m)) {
    return 'QZ Tray no encuentra esa impresora. Revisa que esté encendida y conectada, y vuelve a cargar la lista.';
  }
  return m || 'QZ Tray no pudo imprimir';
};

/** Conecta (una vez) y devuelve `{ qz, firmado }`. */
export const conectarQz = async () => {
  const qz = await _cargar();
  await _configurarSeguridad(qz);
  if (!qz.websocket.isActive()) await qz.websocket.connect({ retries: 1, delay: 1 });
  return { qz, firmado: _firmado };
};

export const qzActivo = () => !!_qz?.websocket?.isActive();

export const listarImpresoras = async () => {
  const { qz } = await conectarQz();
  const [todas, defecto] = await Promise.all([
    qz.printers.find(),
    qz.printers.getDefault().catch(() => null),
  ]);
  return { impresoras: Array.isArray(todas) ? todas : [todas].filter(Boolean), defecto };
};

/**
 * Los papeles que el DRIVER dice tener, en mm. Sirve para avisar ANTES de
 * imprimir por PDF: QZ pide el tamaño a medida, pero un driver que no acepta
 * tamaños libres lo ignora y usa su papel por defecto (probado con el de
 * «Microsoft Print to PDF»: salió en Carta). En una térmica eso es una fila y
 * después avance en blanco — el síntoma de siempre. Los comandos (B/C) no
 * dependen de esto.
 */
export const papelesDe = async (impresora) => {
  const { qz } = await conectarQz();
  const d = await qz.printers.details(impresora);
  const det = Array.isArray(d) ? d.find((x) => x.name === impresora) : d;
  return (det?.sizes || [])
    .map((s) => ({ nombre: s.name, ancho: Number(s.mm?.width), alto: Number(s.mm?.height) }))
    .filter((s) => Number.isFinite(s.ancho) && Number.isFinite(s.alto));
};

/** ¿Hay un papel de ancho × alto (en cualquier sentido, ±1 mm)? */
export const tienePapel = (papeles, ancho, alto) => papeles.some((p) =>
  (Math.abs(p.ancho - ancho) <= 1 && Math.abs(p.alto - alto) <= 1)
  || (Math.abs(p.ancho - alto) <= 1 && Math.abs(p.alto - ancho) <= 1));

/** Blob → base64 sin el prefijo `data:`. */
export const blobABase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

/**
 * El PDF, con el papel y la orientación FIJADOS por la aplicación.
 *
 * `rasterize` a la densidad de la impresora con vecino más cercano: cada módulo
 * del código de barras ya es un número entero de puntos del cabezal (el plano
 * se calculó con esos dpi), así que el raster lo reproduce sin redondeos.
 *
 * @param {object} p
 * @param {string} p.impresora nombre en Windows
 * @param {Blob}   p.pdf
 * @param {{ancho:number, alto:number}} p.papelMm el de la PÁGINA del PDF
 * @param {'auto'|'portrait'|'landscape'|'reverse-landscape'} p.orientacion
 * @param {number|null} p.dpi
 */
export const imprimirPdfQz = async ({ impresora, pdf, papelMm, orientacion = 'auto', dpi = null, nombre = 'Etiquetas' }) => {
  const { qz } = await conectarQz();
  const cfg = qz.configs.create(impresora, {
    size: { width: papelMm.ancho, height: papelMm.alto, custom: true },
    units: 'mm',
    margins: 0,
    scaleContent: false,
    orientation: orientacion === 'auto' ? null : orientacion,
    colorType: 'blackwhite',
    rasterize: true,
    density: (Number(dpi) || 203) / 25.4,   // con units 'mm' la densidad va en puntos por mm
    interpolation: 'nearest-neighbor',
    jobName: nombre,
  });
  await qz.print(cfg, [{ type: 'pixel', format: 'pdf', flavor: 'base64', data: await blobABase64(pdf) }]);
};

/** Los comandos (TSPL/ZPL) tal cual, sin driver de por medio. */
export const imprimirComandosQz = async ({ impresora, comandos, nombre = 'Etiquetas' }) => {
  const { qz } = await conectarQz();
  const cfg = qz.configs.create(impresora, { jobName: nombre });
  await qz.print(cfg, [{ type: 'raw', format: 'command', flavor: 'base64', data: await blobABase64(comandos) }]);
};
