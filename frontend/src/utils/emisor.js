// ─────────────────────────────────────────────────────────────────────────────
// Los datos de la SUCURSAL encima de los del negocio — copia de
// `backend/src/utils/emisor.util.js` (la mezcla; la lectura vive allá).
//
// Todo ticket POS dibuja su encabezado desde el mapa de config del negocio
// (nombre_negocio, nit, direccion, telefono). Esto devuelve el MISMO mapa con
// esas claves reemplazadas por las de la sede cuando las tiene escritas. Campo
// vacío = se hereda. La prueba 67 compara esta copia contra la del backend.
// ─────────────────────────────────────────────────────────────────────────────
export const CAMPOS = {
  nombre_comercial: 'nombre_negocio',
  nit:              'nit',
  direccion:        'direccion',
  telefono:         'telefono',
  logo:             'logo_negocio',
};

const _texto = (v) => (v == null ? '' : String(v).trim());

export const aplicarDatosSucursal = (config, datos) => {
  if (!datos) return config;
  let salida = null;
  for (const [col, clave] of Object.entries(CAMPOS)) {
    const v = _texto(datos[col]);
    if (!v) continue;
    salida = salida || { ...(config || {}) };
    salida[clave] = v;
  }
  return salida || config;
};
