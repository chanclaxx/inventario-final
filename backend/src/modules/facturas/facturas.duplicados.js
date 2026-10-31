// ─── La misma venta no se factura dos veces ──────────────────────────────────
//
// La auditoría del 30-oct-2026 encontró facturas gemelas —mismo usuario, mismo
// cliente, mismos productos— separadas por 10 a 40 segundos (Tesla, MarioWorld,
// Hydra…). Con un equipo con IMEI la segunda ya se rechazaba desde julio (el
// serial se bloquea con FOR UPDATE y la gemela ve «ya fue vendido»), pero con
// accesorios y productos por cantidad no había freno: dos clics, o un Enter y
// un clic, eran dos ventas, dos salidas de stock y dos pagos en la caja.
//
// Dos barandas, SIN tocar el esquema de la base:
//   1. La CLAVE del intento: la pantalla manda `clave_idempotencia` (una por
//      intento de venta, la misma si el formulario se envía dos veces). Si la
//      clave ya produjo una factura, se devuelve ESA factura. Se recuerda en
//      memoria 10 minutos: alcanza para el reintento tras un corte de red, que
//      es el caso que la gemela por contenido no cubre (axios corta a los 30 s).
//   2. La GEMELA por contenido: misma sede, mismo usuario, mismo cliente y las
//      mismas líneas, creada hace menos de 30 s. Cubre a la pantalla vieja en
//      caché, que no manda clave, y a un proceso reiniciado entre los dos clics.
//
// Las dos se consultan DENTRO de la transacción y DESPUÉS del candado
// (`bloquearOperacion`): sin él, la segunda petición no ve la factura que la
// primera todavía no confirmó y las dos pasan — exactamente como entraron los
// pagos duplicados de agosto (ver utils/idempotencia.util.js).
//
// Lo repetido no es un error para el usuario: la venta SÍ quedó hecha. Por eso
// se devuelve la factura existente con `repetida: true` en vez de un 409; la
// pantalla la muestra (y la imprime) como si fuera la respuesta del primer clic.

const VENTANA_GEMELA_SEG = 30;
const TTL_CLAVE_MS = 10 * 60 * 1000;
const _claves = new Map(); // `${sucursal}:${clave}` → { facturaId, vence }

const _clave = (sucursalId, clave) => `${Number(sucursalId)}:${String(clave)}`;

const _limpiar = (ahora) => {
  for (const [k, v] of _claves) if (v.vence <= ahora) _claves.delete(k);
};

/** Una clave usable: texto corto. Cualquier otra cosa se ignora (sin clave). */
const normalizarClave = (clave) => {
  if (typeof clave !== 'string') return null;
  const c = clave.trim();
  return c.length >= 8 && c.length <= 100 ? c : null;
};

const recordarClave = (sucursalId, clave, facturaId) => {
  if (!clave) return;
  const ahora = Date.now();
  _limpiar(ahora);
  _claves.set(_clave(sucursalId, clave), { facturaId, vence: ahora + TTL_CLAVE_MS });
};

/**
 * La firma de una venta: sus líneas normalizadas y ordenadas. Las líneas que
 * llegan de la pantalla y las que se leen de la base pasan por aquí, así que
 * comparar dos firmas es comparar dos ventas.
 */
const firmaLineas = (lineas) => (lineas || []).map((l) => [
  String(l.nombre_producto || '').trim().toLowerCase(),
  Number(l.cantidad || 0),
  Number(l.precio || 0).toFixed(2),
  String(l.imei || '').trim(),
  l.imei ? '' : String(l.producto_id || ''),
  String(l.atributo_id || ''),
  String(l.variante_id || ''),
].join('~')).sort().join('|');

const _clienteDe = ({ nombre_cliente, cedula }) =>
  `${String(nombre_cliente || '').trim().toLowerCase()}|${String(cedula || '').trim()}`;

/**
 * La factura que ya existe para este intento, o null. Va dentro de la
 * transacción, después del candado. `lineas` son las de la petición, con el
 * precio que de verdad se va a escribir (el de un obsequio es 0).
 */
const buscarRepetida = async (client, { sucursal_id, usuario_id, nombre_cliente, cedula, lineas, clave }) => {
  // Con clave manda la clave y NADA más: la pantalla renueva la clave después
  // de cada venta completada, así que una clave nueva es un intento nuevo —
  // aunque sea idéntico al anterior (dos clientes que se llevan el mismo
  // vidrio uno detrás del otro). La gemela por contenido es solo para quien
  // no manda clave.
  if (clave) {
    const ahora = Date.now();
    const guardada = _claves.get(_clave(sucursal_id, clave));
    if (!guardada || guardada.vence <= ahora) return null;
    const { rows } = await client.query(
      `SELECT * FROM facturas WHERE id = $1 AND sucursal_id = $2 AND estado <> 'Cancelada'`,
      [guardada.facturaId, sucursal_id],
    );
    return rows[0] || null;
  }

  const { rows: candidatas } = await client.query(`
    SELECT f.*,
           COALESCE(json_agg(json_build_object(
             'nombre_producto', l.nombre_producto, 'cantidad', l.cantidad, 'precio', l.precio,
             'imei', l.imei, 'producto_id', l.producto_id,
             'atributo_id', l.atributo_id, 'variante_id', l.variante_id)) FILTER (WHERE l.id IS NOT NULL), '[]') AS _lineas
    FROM facturas f
    LEFT JOIN lineas_factura l ON l.factura_id = f.id
    WHERE f.sucursal_id = $1
      AND f.usuario_id IS NOT DISTINCT FROM $2
      AND f.estado <> 'Cancelada'
      AND f.fecha > NOW() - ($3 || ' seconds')::interval
    GROUP BY f.id
    ORDER BY f.id DESC
  `, [sucursal_id, usuario_id || null, String(VENTANA_GEMELA_SEG)]);
  if (!candidatas.length) return null;

  const firma = firmaLineas(lineas);
  const cliente = _clienteDe({ nombre_cliente, cedula });
  const gemela = candidatas.find((f) =>
    _clienteDe(f) === cliente && firmaLineas(f._lineas) === firma);
  if (!gemela) return null;
  delete gemela._lineas;
  return gemela;
};

module.exports = {
  buscarRepetida, recordarClave, normalizarClave, firmaLineas,
  VENTANA_GEMELA_SEG, _claves,
};
