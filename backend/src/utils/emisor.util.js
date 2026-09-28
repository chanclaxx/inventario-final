// src/utils/emisor.util.js
// ─────────────────────────────────────────────────────────────────────────────
// QUIÉN EMITE EL DOCUMENTO — el negocio, con los datos propios de la sucursal
// encima (`sucursales_documento`, 20260928).
//
// Todos los documentos imprimen su encabezado desde el mapa de `config_negocio`
// (nombre_negocio, nit, direccion, telefono, logo_negocio). Esto no cambia esa
// forma: devuelve el MISMO mapa con esas cinco claves reemplazadas por las de
// la sucursal cuando las tiene escritas. Así cada generador sigue leyendo
// `config.nombre_negocio` y no hay que enseñarle nada nuevo a ninguno.
//
// Reglas:
//   · Campo vacío = se hereda del negocio. Sin fila, o sin la tabla, el mapa
//     sale INTACTO (la sección 1 de la prueba 67).
//   · La sucursal se busca DENTRO del negocio: un id de otro negocio no aporta
//     nada, aunque exista.
//   · Nunca lanza: un documento que no puede leer los datos de la sucursal sale
//     con los del negocio, no deja de salir.
//
// Copia del navegador (la mezcla, no la lectura): `frontend/src/utils/emisor.js`.
// ─────────────────────────────────────────────────────────────────────────────
const { pool } = require('../config/db');
const { hayDatosDocumentoSucursal } = require('../config/columnas');

// Columna de `sucursales_documento` → clave de `config_negocio` que reemplaza.
const CAMPOS = {
  nombre_comercial: 'nombre_negocio',
  nit:              'nit',
  direccion:        'direccion',
  telefono:         'telefono',
  logo:             'logo_negocio',
};

const _texto = (v) => (v == null ? '' : String(v).trim());

/**
 * Mezcla pura: `config` con los campos NO vacíos de `datos` encima.
 * Devuelve `config` tal cual (misma referencia) si no hay nada que mezclar.
 */
const aplicarDatosSucursal = (config, datos) => {
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

/** Los datos propios de la sucursal (o null), acotados al negocio. */
const datosDeSucursal = async (negocioId, sucursalId, { conLogo = true } = {}) => {
  const id = Number(sucursalId);
  if (!hayDatosDocumentoSucursal() || !Number.isInteger(id) || id <= 0) return null;
  try {
    const { rows } = await pool.query(
      `SELECT sd.nombre_comercial, sd.nit, sd.direccion, sd.telefono
              ${conLogo ? ', sd.logo' : ''}
       FROM sucursales_documento sd
       JOIN sucursales s ON s.id = sd.sucursal_id
       WHERE sd.sucursal_id = $1 AND s.negocio_id = $2`,
      [id, Number(negocioId)]
    );
    return rows[0] || null;
  } catch (err) {
    console.warn('[emisor] No se pudieron leer los datos de la sucursal:', err.message);
    return null;
  }
};

const _configNegocio = async (negocioId) => {
  const { rows } = await pool.query(
    'SELECT clave, valor FROM config_negocio WHERE negocio_id = $1', [Number(negocioId)]);
  const config = {};
  for (const r of rows) config[r.clave] = r.valor;
  return config;
};

/**
 * El mapa de config con que se dibuja un documento de `sucursalId`.
 * `config` opcional: si el llamador ya lo cargó, no se vuelve a pedir.
 */
const configDocumento = async (negocioId, sucursalId, config = null) => {
  const base = config || await _configNegocio(negocioId);
  return aplicarDatosSucursal(base, await datosDeSucursal(negocioId, sucursalId));
};

/**
 * Para los generadores que reciben el nombre y el logo SUELTOS (préstamos,
 * estados de cuenta): los de la sucursal si los tiene, si no los que ya traían.
 */
const encabezadoPara = async (negocioId, sucursalId, { nombre, logo } = {}) => {
  const d = await datosDeSucursal(negocioId, sucursalId);
  return {
    nombre: _texto(d?.nombre_comercial) || nombre,
    logo:   _texto(d?.logo) || logo,
    datos:  d,
  };
};

module.exports = {
  CAMPOS,
  encabezadoPara,
  aplicarDatosSucursal,
  datosDeSucursal,
  configDocumento,
};
