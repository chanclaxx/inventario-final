// ─────────────────────────────────────────────────────────────────────────────
// PRECIO MÍNIMO DE VENTA — nadie vende ni despacha por debajo del precio que
// ya está escrito (feature opt-in: `config_negocio.precio_minimo_activo`).
//
// **Ausente o '0' = apagado**, y apagado todo se comporta exactamente como
// siempre: el precio del carrito y el valor del despacho son editables sin
// límite. Encendido, el PISO de cada producto es el MENOR de los precios que el
// negocio le escribió:
//
//   · el precio de venta predeterminado del nodo (variante > atributo >
//     producto; en un serial el de la unidad gana sobre el de la referencia), y
//   · con las listas de precios activas, el de cada lista configurada (mezclado
//     clave por clave hacia abajo, la misma herencia del escaneo).
//
// ¿Por qué el MENOR y no el de la lista que eligió el vendedor? Porque la
// factura no guarda qué lista se usó (decisión de 20260912_listas_precios) y
// el vendedor puede elegir la más barata con un toque: exigir la del chip no
// protegería nada más y obligaría a tocar la emisión, la edición y el PDF.
// Lo que se cierra es teclear un número que NO está en ninguna parte.
//
// Un producto SIN ningún precio escrito (todo en 0 o NULL) no tiene piso: no
// hay «precio que haya» contra el cual comparar, y bloquearlo dejaría la venta
// imposible. El despacho de un producto sin precio cae al costo como siempre.
//
// Las tarifas porcentuales NO entran: calculan el precio desde el costo, y ese
// cálculo vive en el navegador. Por eso `saveConfig` hace esta feature y las
// tarifas EXCLUYENTES, igual que las tarifas y las listas.
//
// `pisoDePrecios` está duplicada a mano en `frontend/src/utils/precioMinimo.js`
// (el frontend no puede importar del backend); la prueba
// `56-precio-minimo` corre las dos sobre los mismos casos.
// ─────────────────────────────────────────────────────────────────────────────
const { hayListasPrecios } = require('../config/columnas');
const { parsearListas } = require('./listasPrecios.util');

const CLAVE = 'precio_minimo_activo';

const _positivo = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const _mapaPrecios = (crudo) => {
  let obj = crudo;
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj); } catch { return {}; }
  }
  return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
};

/**
 * El piso de un nodo, o null si no tiene ningún precio escrito.
 *   precio   → el predeterminado ya resuelto (número, string NUMERIC o null)
 *   precios  → el JSONB de listas ya mezclado, o null
 *   listaIds → ids de las listas VIGENTES; [] si las listas están apagadas.
 *              Un precio guardado en una lista borrada no cuenta: el vendedor
 *              ya no tiene cómo elegirlo.
 */
const pisoDePrecios = ({ precio, precios, listaIds = [] }) => {
  const candidatos = [];
  const base = _positivo(precio);
  if (base != null) candidatos.push(base);

  const mapa = _mapaPrecios(precios);
  for (const id of listaIds) {
    const v = _positivo(mapa[id]);
    if (v != null) candidatos.push(v);
  }
  return candidatos.length ? Math.min(...candidatos) : null;
};

/**
 * Lee la regla del negocio. null = feature apagada (el llamador no hace nada).
 * `db` es el pool o el client de la transacción.
 */
const leerRegla = async (db, negocioId) => {
  const { rows } = await db.query(
    `SELECT clave, valor FROM config_negocio
     WHERE negocio_id = $1 AND clave = ANY($2::text[])`,
    [negocioId, [CLAVE, 'listas_precios_activo', 'listas_precios_lista']]
  );
  const cfg = Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
  if (cfg[CLAVE] !== '1') return null;

  const conListas = hayListasPrecios() && cfg.listas_precios_activo === '1';
  return {
    listaIds: conListas ? parsearListas(cfg.listas_precios_lista).map((l) => l.id) : [],
  };
};

const _selPrecios = (expr) => (hayListasPrecios() ? `${expr} AS precios` : 'NULL::jsonb AS precios');

/**
 * Piso de un serial. Se busca por id (despacho) o por IMEI dentro de la
 * sucursal (factura: la línea solo guarda el IMEI). Con el fan-out del IMEI
 * puede haber varias filas en la sede: gana la disponible y, entre iguales, la
 * más reciente — la misma que la venta va a marcar.
 */
const pisoSerial = async (db, regla, { serialId = null, imei = null, sucursalId }) => {
  if (!regla) return null;
  const { rows } = await db.query(`
    SELECT COALESCE(s.precio, ps.precio) AS precio, ${_selPrecios('ps.precios')}
    FROM seriales s
    JOIN productos_serial ps ON ps.id = s.producto_id
    WHERE ps.sucursal_id = $1
      AND ${serialId ? 's.id = $2' : 'UPPER(BTRIM(s.imei)) = UPPER(BTRIM($2))'}
    ORDER BY s.vendido ASC, s.id DESC
    LIMIT 1
  `, [sucursalId, serialId || imei]);
  if (!rows.length) return null;
  return pisoDePrecios({ ...rows[0], listaIds: regla.listaIds });
};

/** Piso de un nodo por cantidad (variante > atributo > producto). */
const pisoCantidad = async (db, regla, { productoId, atributoId = null, varianteId = null }) => {
  if (!regla || !productoId) return null;
  let sql;
  let params;
  if (varianteId) {
    sql = `SELECT COALESCE(v.precio, ap.precio, pc.precio) AS precio,
             ${_selPrecios(`COALESCE(pc.precios, '{}'::jsonb) || COALESCE(ap.precios, '{}'::jsonb)
                            || COALESCE(v.precios, '{}'::jsonb)`)}
           FROM variantes_atributo v
           JOIN atributos_producto ap ON ap.id = v.atributo_id
           JOIN productos_cantidad pc ON pc.id = ap.producto_id
           WHERE v.id = $1 AND pc.id = $2`;
    params = [varianteId, productoId];
  } else if (atributoId) {
    sql = `SELECT COALESCE(ap.precio, pc.precio) AS precio,
             ${_selPrecios(`COALESCE(pc.precios, '{}'::jsonb) || COALESCE(ap.precios, '{}'::jsonb)`)}
           FROM atributos_producto ap
           JOIN productos_cantidad pc ON pc.id = ap.producto_id
           WHERE ap.id = $1 AND pc.id = $2`;
    params = [atributoId, productoId];
  } else {
    sql = `SELECT pc.precio, ${_selPrecios('pc.precios')}
           FROM productos_cantidad pc WHERE pc.id = $1`;
    params = [productoId];
  }
  const { rows } = await db.query(sql, params);
  if (!rows.length) return null;
  return pisoDePrecios({ ...rows[0], listaIds: regla.listaIds });
};

const _fmt = (n) => `$${Math.round(n).toLocaleString('es-CO')}`;

/**
 * Lanza 400 `PRECIO_BAJO_MINIMO` si `valor` queda por debajo del piso.
 * Medio peso de tolerancia: los NUMERIC viajan con decimales y un 6999,999
 * redondeado en pantalla no es un descuento.
 */
const exigirNoBajoMinimo = ({ valor, piso, nombre, accion = 'vender' }) => {
  if (piso == null) return;
  const v = Number(valor);
  if (Number.isFinite(v) && v + 0.5 >= piso) return;
  throw {
    status: 400,
    code: 'PRECIO_BAJO_MINIMO',
    message: `No puedes ${accion} "${nombre}" por ${_fmt(Number.isFinite(v) ? v : 0)}: `
      + `el precio mínimo es ${_fmt(piso)}. `
      + 'Este negocio no permite precios por debajo de los precios de venta registrados.',
    detalle: { nombre, valor: Number.isFinite(v) ? v : null, minimo: piso },
  };
};

module.exports = {
  CLAVE, pisoDePrecios, leerRegla, pisoSerial, pisoCantidad, exigirNoBajoMinimo,
};
