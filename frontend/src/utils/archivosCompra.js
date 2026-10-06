// ─────────────────────────────────────────────────────────────────────────────
// Archivos de una compra (opt-in `compras_archivos_activo`, ausente = apagado):
// el manifiesto de importación y los demás papeles, vinculados a la compra.
//
// La lista de tipos es la MISMA que `TIPOS_DOCUMENTO` en
// backend/src/modules/compras/archivosCompra.service.js y que el CHECK de la
// migración. No se puede importar del backend; la suite 73 compara las tres
// para que no se separen (es lo que ya pasó con las dos listas de módulos).
// ─────────────────────────────────────────────────────────────────────────────

export const TIPOS_DOCUMENTO = {
  manifiesto:  'Manifiesto de importación',
  declaracion: 'Declaración de importación',
  factura:     'Factura del proveedor',
  empaque:     'Lista de empaque',
  otro:        'Otro documento',
};

export const TIPO_POR_DEFECTO = 'manifiesto';

export const etiquetaTipo = (tipo) => TIPOS_DOCUMENTO[tipo] ?? TIPOS_DOCUMENTO.otro;

/** ¿El negocio encendió los archivos de compra? */
export const archivosCompraActivos = (config) => config?.compras_archivos_activo === '1';

/**
 * ¿Este usuario puede ver los archivos? Es el mismo permiso que ver el
 * historial de compras (`requirePermisoVerCompras` en el backend): un
 * manifiesto trae proveedor y precios.
 */
export const puedeVerArchivosCompra = (config, usuario) =>
  archivosCompraActivos(config)
  && (usuario?.rol === 'admin_negocio' || usuario?.permisos_proveedores?.ver_compras === true);

/** Adjuntar exige además supervisor, como registrar la compra. */
export const puedeAdjuntarArchivosCompra = (usuario) =>
  usuario?.rol === 'admin_negocio' || usuario?.rol === 'supervisor';

export const formatBytes = (bytes) => {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
};

/** Lo que el navegador abre en una pestaña sin descargarlo. */
export const seAbreEnNavegador = (mime) =>
  mime === 'application/pdf' || String(mime || '').startsWith('image/');

export const claseDeArchivo = (mime) => {
  const m = String(mime || '');
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('image/')) return 'imagen';
  if (m.includes('spreadsheet') || m.includes('excel')) return 'hoja';
  return 'otro';
};

/** Lo que acepta el selector de archivos. El backend decide por el contenido. */
export const ACEPTA = '.pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.docx,.doc';

/**
 * El mensaje de un error de la API. La descarga pide un blob, así que su error
 * también llega como blob: hay que leerlo antes de poder mostrarlo.
 */
export const mensajeDeError = async (err, porDefecto) => {
  const data = err?.response?.data;
  if (data && typeof data.text === 'function') {
    try { return JSON.parse(await data.text()).error || porDefecto; } catch { return porDefecto; }
  }
  if (data?.error) return data.error;
  if (err?.code === 'ECONNABORTED') return 'La conexión tardó demasiado. Revisa la lista antes de repetir.';
  return porDefecto;
};
