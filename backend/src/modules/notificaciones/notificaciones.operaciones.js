const { pool } = require('../../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// ALERTAS DE OPERACIÓN — lo que se vence o se queda a medias
//
// Van aparte de `notificaciones.alertas.js` porque son de otra naturaleza. Allá
// vive la CARTERA: plata que se debe, con su mora y su interés, y consultas que
// cruzan créditos, préstamos y el motor de devengo. Aquí viven cuatro preguntas
// operativas, independientes entre sí, que solo comparten la forma:
//
//   1. ¿Qué garantía de proveedor está por vencerse?     → plata que se pierde sola
//   2. ¿Qué pedido debía haber llegado y no llegó?       → hay que llamar al proveedor
//   3. ¿Qué entrada sigue sin valorizar?                 → se vende con costo falso
//   4. ¿Qué caja quedó abierta?                          → el descuadre de mañana
//
// ── Las tres reglas de este archivo ─────────────────────────────────────────
//
//   1. NINGUNA LANZA. Cada una devuelve su vacío ante cualquier error y lo
//      registra. Un negocio sin la migración de órdenes no puede quedarse sin
//      el aviso de cartera por culpa de una consulta de garantías.
//
//   2. NADA SE INVENTA. Las cuatro se derivan de lo que ya existe: la garantía
//      sale de `lineas_compra.garantia_dias`, el atraso de
//      `ordenes_compra.fecha_esperada`, la entrada sin valorizar de
//      `factura_confirmada`, y la caja de `aperturas_caja.estado`. Ninguna
//      necesita una tabla ni una columna nueva.
//
//   3. LAS FECHAS SE LEEN COMO SON. `fecha_esperada` y `garantia_hasta` son
//      DATE; `compras.fecha` y `aperturas_caja.fecha_apertura` son TIMESTAMP y
//      van en Bogotá. Mezclarlos corre un día — el error que ya costó dos veces
//      en `mora.service`, y que en un aviso significa avisar de una garantía el
//      día después de que venció.
// ─────────────────────────────────────────────────────────────────────────────

/** Hoy en Bogotá, como 'YYYY-MM-DD'. Mismo helper que usa `alertas.js`. */
const hoyBogota = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

// Un error de tabla ausente (42P01) o columna ausente (42703) es lo esperado en
// un negocio que no aplicó una migración opcional: se apaga ESE aviso y ya. Todo
// lo demás sí merece quedar en el log.
const _fallo = (etiqueta, negocioId, err, vacio) => {
  if (err?.code !== '42P01' && err?.code !== '42703') {
    console.error(`[alertas] ${etiqueta} negocio ${negocioId}:`, err.message);
  }
  return vacio;
};

// ── 1. Garantías del proveedor por vencer ────────────────────────────────────
//
// La más valiosa de las cuatro y la que no existía de ninguna forma: el plazo se
// congela en `lineas_compra.garantia_dias`, el vencimiento se DERIVA, la ficha
// del equipo lo pinta con su semáforo… y nadie va a entrar a mirarlo equipo por
// equipo. Una garantía que se vence sin reclamar es plata perdida, y se pierde
// en silencio.
//
// Solo cuentan las unidades que TODAVÍA SON DEL NEGOCIO. Un equipo ya vendido
// pasó a ser garantía del cliente y reclamarle al proveedor por él es otro
// trámite; meterlo aquí llenaría el aviso de cosas que no se pueden hacer.
//
// El `AT TIME ZONE` no es decorativo: `compras.fecha` es TIMESTAMP en Bogotá y
// el vencimiento es una fecha. Sin él, una compra registrada a las 8 p.m. vence
// un día antes de lo que dice la pantalla.
const garantiasPorVencer = async (negocioId, dias = 15) => {
  const vacio = { items: [], total: 0, vencen_hoy: 0 };
  if (!negocioId) return vacio;

  try {
    const { rows } = await pool.query(`
      SELECT lc.nombre_producto,
             lc.imei,
             c.id                                        AS compra_id,
             c.numero                                    AS compra_numero,
             p.nombre                                    AS proveedor_nombre,
             su.nombre                                   AS sucursal_nombre,
             c.sucursal_id,
             -- ── Las fechas se formatean en SQL, no en JavaScript ──────────
             -- node-postgres devuelve un DATE como objeto Date de JS, asi que
             -- String(fila.vence).slice(0, 10) da "Wed Sep 24" y no
             -- "2026-09-24". Y dias_restantes calculado restando Dates en JS
             -- arrastra la zona horaria del servidor —que en Railway es UTC— y
             -- corre un dia justo en el aviso que dice "vence HOY".
             --
             -- Postgres ya sabe restar fechas y ya está en la zona correcta:
             -- que lo haga él es más corto y no puede desfasarse.
             to_char((c.fecha AT TIME ZONE 'America/Bogota')::date + lc.garantia_dias,
                     'YYYY-MM-DD')                                      AS vence,
             (((c.fecha AT TIME ZONE 'America/Bogota')::date + lc.garantia_dias)
               - $2::date)                                              AS dias_restantes
      FROM      lineas_compra lc
      JOIN      compras       c  ON c.id = lc.compra_id AND c.estado <> 'Cancelada'
      JOIN      sucursales    su ON su.id = c.sucursal_id
      LEFT JOIN proveedores   p  ON p.id = c.proveedor_id
      -- La unidad tiene que seguir siendo del negocio: si ya se vendió o se
      -- prestó, la garantía que corre es la del cliente y este aviso no aplica.
      JOIN LATERAL (
        SELECT 1
        FROM      seriales        se
        JOIN      productos_serial ps ON ps.id = se.producto_id
        WHERE lc.imei IS NOT NULL
          AND UPPER(TRIM(se.imei)) = UPPER(TRIM(lc.imei))
          AND ps.sucursal_id = c.sucursal_id
          AND NOT se.vendido
          AND NOT se.prestado
        LIMIT 1
      ) viva ON TRUE
      WHERE su.negocio_id = $1
        AND lc.garantia_dias IS NOT NULL
        AND lc.imei IS NOT NULL
        AND ((c.fecha AT TIME ZONE 'America/Bogota')::date + lc.garantia_dias)
              BETWEEN $2::date AND ($2::date + $3::int)
      ORDER BY vence, lc.id
      LIMIT 50
    `, [negocioId, hoyBogota(), dias]);

    const items = rows.map((r) => ({ ...r, dias_restantes: Number(r.dias_restantes) }));
    return {
      items,
      total: items.length,
      // "Vence hoy" es 0 días restantes. Se cuenta sobre el número que ya trajo
      // Postgres, no comparando cadenas de fecha.
      vencen_hoy: items.filter((i) => i.dias_restantes === 0).length,
    };
  } catch (err) {
    return _fallo('garantiasPorVencer', negocioId, err, vacio);
  }
};

// ── 2. Pedidos que debían haber llegado ──────────────────────────────────────
//
// `fecha_esperada` se captura al crear la orden y hasta hoy no la miraba nadie:
// había que acordarse de entrar a la pestaña de Órdenes y compararla a ojo.
//
// El pendiente se DERIVA de `lineas_compra`, con el mismo FILTER que el resto
// del módulo: una recepción cancelada no puede seguir contando como recibida, y
// sin el FILTER una orden cancelada entera se quedaría "completa" y no volvería
// a aparecer aquí nunca.
const pedidosAtrasados = async (negocioId) => {
  const vacio = { items: [], total: 0 };
  if (!negocioId) return vacio;

  try {
    const { rows } = await pool.query(`
      SELECT o.id, o.numero, o.fecha_esperada, o.sucursal_id,
             p.nombre  AS proveedor_nombre,
             su.nombre AS sucursal_nombre,
             ($2::date - o.fecha_esperada) AS dias_atraso,
             SUM(GREATEST(a.pedida - a.recibida, 0))::int AS unidades_pendientes
      FROM      ordenes_compra o
      JOIN      proveedores    p  ON p.id  = o.proveedor_id
      JOIN      sucursales     su ON su.id = o.sucursal_id
      JOIN LATERAL (
        SELECT loc.cantidad_pedida AS pedida,
               COALESCE(SUM(lcc.cantidad - COALESCE(lcc.cantidad_devuelta, 0))
                 FILTER (WHERE cc.id IS NOT NULL), 0) AS recibida
        FROM      lineas_orden_compra loc
        LEFT JOIN lineas_compra lcc ON lcc.orden_linea_id = loc.id
        LEFT JOIN compras       cc  ON cc.id = lcc.compra_id AND cc.estado <> 'Cancelada'
        WHERE loc.orden_id = o.id
        GROUP BY loc.id
      ) a ON TRUE
      WHERE o.negocio_id = $1
        AND o.estado = 'Emitida'
        AND o.fecha_esperada IS NOT NULL
        AND o.fecha_esperada < $2::date
      GROUP BY o.id, p.nombre, su.nombre
      HAVING SUM(GREATEST(a.pedida - a.recibida, 0)) > 0
      ORDER BY o.fecha_esperada
      LIMIT 30
    `, [negocioId, hoyBogota()]);

    return {
      items: rows.map((r) => ({ ...r, dias_atraso: Number(r.dias_atraso) })),
      total: rows.length,
    };
  } catch (err) {
    return _fallo('pedidosAtrasados', negocioId, err, vacio);
  }
};

// ── 3. Entradas de bodega sin confirmar ──────────────────────────────────────
//
// Mientras una entrada no se confirma, su mercancía está en el inventario
// valorizada al ÚLTIMO COSTO CONOCIDO — un provisional. Todo lo que se venda de
// ahí calcula la utilidad contra una cifra que no es la real.
//
// Por eso el aviso no es "hay entradas pendientes" sino que aparece pasados unos
// días: la ventana entre recibir y confirmar es normal y corta; lo que hay que
// señalar es cuando se vuelve larga.
const entradasSinConfirmar = async (negocioId, dias = 3) => {
  const vacio = { items: [], total: 0 };
  if (!negocioId) return vacio;

  try {
    const { rows } = await pool.query(`
      SELECT c.id, c.numero, c.fecha, c.total, c.sucursal_id,
             su.nombre AS sucursal_nombre,
             u.nombre  AS recibida_por,
             p.nombre  AS proveedor_nombre,
             EXTRACT(DAY FROM (NOW() - c.fecha))::int AS dias_esperando
      FROM      compras    c
      JOIN      sucursales su ON su.id = c.sucursal_id
      LEFT JOIN usuarios   u  ON u.id  = c.usuario_id
      LEFT JOIN proveedores p ON p.id  = c.proveedor_id
      WHERE su.negocio_id = $1
        AND c.es_entrada
        AND NOT c.factura_confirmada
        AND c.estado <> 'Cancelada'
        AND c.fecha < NOW() - ($2 || ' days')::interval
      ORDER BY c.fecha
      LIMIT 30
    `, [negocioId, String(dias)]);

    return { items: rows, total: rows.length };
  } catch (err) {
    return _fallo('entradasSinConfirmar', negocioId, err, vacio);
  }
};

// ── 4. Cajas que quedaron abiertas ───────────────────────────────────────────
//
// Una caja que no se cierra es el descuadre de mañana: el turno siguiente vende
// sobre la apertura del anterior y ya no hay forma de saber a quién le faltaba.
//
// A diferencia de los otros tres, este NO es un vencimiento: no hay una fecha
// límite, hay una caja que lleva demasiado tiempo abierta. Por eso el umbral se
// mide en horas y no en días — una caja abierta desde hace 4 horas es la
// operación normal; una de 20 es que nadie la cerró anoche.
const cajasSinCerrar = async (negocioId, horas = 16) => {
  const vacio = { items: [], total: 0 };
  if (!negocioId) return vacio;

  try {
    const { rows } = await pool.query(`
      SELECT ac.id, ac.sucursal_id, ac.fecha_apertura,
             su.nombre AS sucursal_nombre,
             u.nombre  AS usuario_nombre,
             EXTRACT(EPOCH FROM (NOW() - ac.fecha_apertura)) / 3600 AS horas_abierta
      FROM      aperturas_caja ac
      JOIN      sucursales     su ON su.id = ac.sucursal_id
      LEFT JOIN usuarios       u  ON u.id  = ac.usuario_id
      WHERE su.negocio_id = $1
        AND ac.estado = 'Abierta'
        AND ac.fecha_apertura < NOW() - ($2 || ' hours')::interval
      ORDER BY ac.fecha_apertura
      LIMIT 20
    `, [negocioId, String(horas)]);

    return {
      items: rows.map((r) => ({ ...r, horas_abierta: Math.round(Number(r.horas_abierta)) })),
      total: rows.length,
    };
  } catch (err) {
    return _fallo('cajasSinCerrar', negocioId, err, vacio);
  }
};

module.exports = {
  garantiasPorVencer, pedidosAtrasados, entradasSinConfirmar, cajasSinCerrar,
  hoyBogota,
};
