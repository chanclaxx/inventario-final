// ─────────────────────────────────────────────────────────────────────────────
// ¿ESTE EQUIPO ESTÁ DONDE UN TÉCNICO? — ver migrations/20260918_tecnicos_externos.sql
//
// El candado de verdad es el trigger `fn_serial_en_tecnico`: cualquier escritura
// que venda, preste, mueva de referencia o borre un serial abierto donde un
// técnico revienta con ST001. Esto es para los caminos que COMPROMETEN un
// equipo sin escribir en `seriales` todavía —el despacho de la red interna solo
// escribe al recibir—: sin la pregunta aquí, la bodega despacharía un equipo
// que no tiene y el local se enteraría al intentar recibirlo.
//
// Sin las tablas (`hayTecnicos()` en falso) no pregunta nada: la consulta
// nombraría una tabla ausente y tumbaría el despacho, que es la operación
// diaria de un módulo que ya está en producción.
// ─────────────────────────────────────────────────────────────────────────────

const { hayTecnicos } = require('../config/columnas');

const buscarEnTecnico = async (client, serialId) => {
  if (!hayTecnicos() || !serialId) return null;
  const { rows } = await client.query(`
    SELECT t.nombre AS tecnico_nombre, COALESCE(s.numero, s.id) AS salida_numero,
           e.fecha_regreso, s.fecha
    FROM equipos_tecnico e
    JOIN tecnicos        t ON t.id = e.tecnico_id
    JOIN salidas_tecnico s ON s.id = e.salida_id
    WHERE e.serial_id = $1 AND e.estado = 'En_tecnico'
    LIMIT 1
  `, [serialId]);
  return rows[0] || null;
};

const exigirNoEnTecnico = async (client, serialId, imei) => {
  const abierto = await buscarEnTecnico(client, serialId);
  if (abierto) {
    throw {
      status: 409,
      code:   'EQUIPO_EN_TECNICO',
      message: `El equipo ${imei || ''} está donde el técnico ${abierto.tecnico_nombre} `
             + `(salida #${abierto.salida_numero}). Recíbelo en Servicios → Técnicos antes de moverlo.`,
    };
  }
};

module.exports = { buscarEnTecnico, exigirNoEnTecnico };
