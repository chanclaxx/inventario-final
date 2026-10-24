// ─────────────────────────────────────────────────────────────────────────────
// ¿ESTE EQUIPO ESTÁ EN GARANTÍA CON EL PROVEEDOR? — ver
// migrations/20261023_reclamos_garantia.sql
//
// El candado de verdad es el trigger `fn_serial_en_garantia`. Esto es para los
// caminos que COMPROMETEN un equipo sin escribir en `seriales` todavía —el
// despacho de la red interna solo escribe al recibir—, igual que
// `serialEnTecnico.util`.
//
// Y los fragmentos SQL para el inventario: sin las tablas
// (`hayReclamosGarantia()` en falso) devuelven el SQL de siempre — la consulta
// nombraría una tabla ausente y tumbaría el listado de seriales.
// ─────────────────────────────────────────────────────────────────────────────

const { hayReclamosGarantia } = require('../config/columnas');

const buscarEnGarantia = async (client, serialId) => {
  if (!hayReclamosGarantia() || !serialId) return null;
  const { rows } = await client.query(`
    SELECT COALESCE(r.numero, r.id) AS numero, r.fecha, pr.nombre AS proveedor_nombre
    FROM reclamos_garantia_lineas l
    JOIN reclamos_garantia r ON r.id = l.reclamo_id
    LEFT JOIN proveedores pr ON pr.id = r.proveedor_id
    WHERE l.serial_id = $1 AND NOT l.cerrada AND NOT r.anulado
    LIMIT 1
  `, [serialId]);
  return rows[0] || null;
};

const exigirNoEnGarantia = async (client, serialId, imei) => {
  const abierto = await buscarEnGarantia(client, serialId);
  if (abierto) {
    throw {
      status: 409,
      code:   'EQUIPO_EN_GARANTIA',
      message: `El equipo ${imei || ''} está en garantía con el proveedor (garantía #${abierto.numero}). `
             + 'Resuélvela en Proveedores → Garantías antes de moverlo.',
    };
  }
};

/**
 * Condición «este serial NO está en una garantía abierta», para sumarla a los
 * conteos de disponibles. Sin las tablas, `TRUE` (la consulta de siempre).
 */
const sqlNoEnGarantia = (aliasSerial) => (hayReclamosGarantia()
  ? `NOT EXISTS (SELECT 1 FROM reclamos_garantia_lineas rgl
                 JOIN reclamos_garantia rg ON rg.id = rgl.reclamo_id
                 WHERE rgl.serial_id = ${aliasSerial}.id AND NOT rgl.cerrada AND NOT rg.anulado)`
  : 'TRUE');

module.exports = { buscarEnGarantia, exigirNoEnGarantia, sqlNoEnGarantia };
