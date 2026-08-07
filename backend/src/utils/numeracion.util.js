// ─── Numeración de documentos por negocio ─────────────────────────────────────
//
// Cada negocio lleva su propio consecutivo por tipo de documento en la tabla
// `contadores_documento` (migración 20260716). El incremento es un solo
// INSERT … ON CONFLICT DO UPDATE … RETURNING: atómico, el lock de fila
// serializa creaciones concurrentes del mismo negocio y, si la transacción
// hace ROLLBACK, el incremento se revierte con ella (sin huecos).
//
// Para MOSTRAR el número siempre se usa `numero ?? id`: los documentos
// históricos (numero = NULL) conservan el id global que siempre mostraron.

const TABLAS = {
  factura:        'facturas',
  prestamo:       'prestamos',
  orden_servicio: 'ordenes_servicio',
  compra:         'compras',
  // Consecutivo propio: una orden de compra NO es una compra (todavía no ha
  // entrado nada) y no puede consumir números del consecutivo de compras.
  orden_compra:   'ordenes_compra',
  // Red interna. Consecutivos propios: una remisión NO es una venta y no puede
  // consumir números del consecutivo de facturas.
  remision:       'remisiones',
  remesa:         'remesas',
};

// Cache: una vez detectada la infraestructura no se vuelve a consultar.
let _infraLista = false;

/**
 * Asigna el siguiente número de documento del negocio y lo escribe en la fila.
 * Acepta `negocioId` directo o `sucursalId` (resuelve el negocio vía sucursales).
 * `client` puede ser un client de transacción o el pool.
 *
 * Devuelve el número asignado, o null si la migración 20260716 aún no se ha
 * aplicado (el documento queda sin numero y se sigue mostrando su id).
 */
const asignarNumeroDocumento = async (client, { tipo, docId, negocioId = null, sucursalId = null }) => {
  const tabla = TABLAS[tipo];
  if (!tabla) throw new Error(`Tipo de documento desconocido: ${tipo}`);

  if (!_infraLista) {
    const { rows } = await client.query(
      `SELECT to_regclass('public.contadores_documento') AS t`
    );
    if (!rows[0].t) return null; // migración no aplicada aún → fallback al id
    _infraLista = true;
  }

  const { rows } = negocioId != null
    ? await client.query(`
        INSERT INTO contadores_documento (negocio_id, tipo, ultimo_numero)
        VALUES ($1, $2, 1)
        ON CONFLICT (negocio_id, tipo)
        DO UPDATE SET ultimo_numero = contadores_documento.ultimo_numero + 1
        RETURNING ultimo_numero
      `, [negocioId, tipo])
    : await client.query(`
        INSERT INTO contadores_documento (negocio_id, tipo, ultimo_numero)
        SELECT s.negocio_id, $2, 1 FROM sucursales s WHERE s.id = $1
        ON CONFLICT (negocio_id, tipo)
        DO UPDATE SET ultimo_numero = contadores_documento.ultimo_numero + 1
        RETURNING ultimo_numero
      `, [sucursalId, tipo]);

  if (!rows.length) return null; // sucursal inexistente — no debería ocurrir

  const numero = rows[0].ultimo_numero;
  await client.query(`UPDATE ${tabla} SET numero = $1 WHERE id = $2`, [numero, docId]);
  return numero;
};

module.exports = { asignarNumeroDocumento };
