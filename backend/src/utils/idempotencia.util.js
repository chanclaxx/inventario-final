// ─── Baranda contra el pago registrado dos veces ─────────────────────────────
//
// EL PROBLEMA, y por qué la primera versión no alcanzó.
//
// Un doble clic en "guardar" —o el formulario reenviándose mientras la primera
// petición sigue en vuelo— registraba el MISMO pago dos veces. En agosto de
// 2026 se puso una baranda: antes de escribir, buscar un movimiento idéntico
// dentro de una ventana corta y rechazarlo con 409.
//
// Esa baranda cerró el caso SECUENCIAL (el usuario espera, ve que no pasó nada
// y vuelve a darle) pero NO el simultáneo, que es el que de verdad pasaba:
//
//   1. La petición A abre su transacción e inserta el pago. Todavía no commitea
//      —el reparto sobre 27 préstamos tarda segundos.
//   2. La petición B, disparada 2 segundos después por el segundo clic, corre
//      su SELECT de "¿ya existe un gemelo?" sobre OTRA conexión. En READ
//      COMMITTED **no ve lo que A no ha commiteado**, así que no encuentra nada.
//   3. Las dos escriben. La cuenta del cliente baja el doble.
//
// Pasó con FACTURA JUANSHOP el 29-ago-2026: TRES pagos de $100.000.000 en 2,8
// segundos, $200.000.000 acreditados que nunca entraron.
//
// LA SOLUCIÓN: serializar la operación antes de mirar.
//
// `pg_advisory_xact_lock` hace esperar a B hasta que A COMMITEA y suelta el
// lock (se libera solo al terminar la transacción, sin necesidad de UNLOCK).
// Recién entonces B ejecuta su SELECT —una sentencia nueva en READ COMMITTED
// toma una instantánea nueva— y ahí sí ve el pago de A y lo rechaza.
//
// Es la misma idea que el `SELECT ... FOR UPDATE` sobre el acreedor que ya
// protegía el pago total a proveedores (`acreedores.repository.js`), pero sin
// bloquear una fila de datos: así no estorba a nadie que esté editando el
// cliente por otro lado.
//
// REGLAS DE USO, las tres importan:
//   · Se toma DENTRO de la transacción y ANTES de leer nada que se vaya a
//     decidir con ello. Un lock después de la lectura no sirve para nada: ya
//     leíste datos viejos.
//   · Se toma UNO SOLO por transacción. Con un único lock por transacción no
//     hay ciclo posible y por lo tanto no hay interbloqueo.
//   · La clave identifica la OPERACIÓN, no la fila: dos pagos totales del mismo
//     cliente compiten entre sí, pero no con un abono a un préstamo suelto.

/** Segundos dentro de los cuales un movimiento idéntico se considera repetido. */
const VENTANA_DUPLICADO_SEG = 90;

/**
 * Cuánto espera una petición a que la anterior termine antes de rendirse.
 *
 * Sin tope, si una transacción se quedara colgada la segunda petición esperaría
 * para siempre y el usuario —que ya está impaciente, de ahí el doble clic—
 * volvería a darle. Con tope, responde un mensaje que explica qué pasó.
 * 20 s es holgado: el pago total más grande de producción (27 préstamos) corre
 * en menos de 2.
 */
const ESPERA_LOCK = '20s';

/**
 * Serializa las peticiones que compiten por la misma operación.
 *
 * `clave` es texto libre y describe la operación completa, por ejemplo
 * `abono-total:cliente:1348`. `hashtext` la convierte en el entero que pide
 * Postgres; una colisión entre dos claves distintas solo costaría que dos
 * operaciones sin relación se esperen un instante, nunca un dato mal escrito.
 */
const bloquearOperacion = async (client, clave) => {
  await client.query(`SET LOCAL lock_timeout = '${ESPERA_LOCK}'`);
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [String(clave)]);
  } catch (err) {
    // 55P03 = lock_not_available. La otra petición sigue trabajando.
    if (err && err.code === '55P03') {
      throw {
        status: 409,
        message: 'Hay otro pago de esta misma persona registrándose en este momento. '
               + 'Espera a que termine y revisa el estado de cuenta antes de volver a intentarlo.',
      };
    }
    throw err;
  }
};

/** El 409 que ve el usuario cuando su formulario se envió dos veces. */
const errorDuplicado = (que) => ({
  status: 409,
  message: `Este mismo ${que} ya se registró hace un momento. `
         + 'Revisa el estado de cuenta antes de volver a intentarlo.',
});

module.exports = { bloquearOperacion, errorDuplicado, VENTANA_DUPLICADO_SEG, ESPERA_LOCK };
