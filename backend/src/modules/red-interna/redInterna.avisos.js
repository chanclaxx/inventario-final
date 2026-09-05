// ─────────────────────────────────────────────────────────────────────────────
// AVISOS DE LA RED INTERNA — la cuenta no cambia en silencio
//
// Toda acción de un lado que le mueve la cuenta (o el trabajo) al otro manda un
// aviso. Es la pieza que faltaba para que "no pueda modificar cuentas y la
// bodega no se entere": el control no es solo poder deshacer, es enterarse a
// tiempo.
//
// NUNCA lanza ni se espera: quien llamó estaba despachando, recibiendo, pagando
// o pidiendo, y eso tiene que terminar bien aunque el aviso falle. Es la misma
// regla del módulo de notificaciones.
//
// Vive en su propio archivo —y no dentro de `redInterna.service`— porque lo
// usan también los pedidos, y hacer que el service de pedidos importara el
// service principal montaría un ciclo entre los dos. Son quince líneas: la
// alternativa era copiarlas, y una copia de esto se separa en cuanto alguien
// cambie el `tag` o el `url` en un solo lado.
// ─────────────────────────────────────────────────────────────────────────────

const avisar = ({ negocioId, sucursalId = null, roles = null, titulo, cuerpo, url = '/bodega' }) => {
  try {
    const notif = require('../notificaciones/notificaciones.service');
    notif.enviar({
      negocio_id: negocioId, sucursal_id: sucursalId, roles,
      titulo, cuerpo, url, tag: 'red-interna', tipo: 'red_interna',
    }).catch(() => {});
  } catch { /* sin módulo de notificaciones, el circuito sigue igual */ }
};

module.exports = { avisar };
