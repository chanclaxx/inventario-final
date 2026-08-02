const { pool }    = require('../../config/db');
const moraService = require('../mora/mora.service');

// ─────────────────────────────────────────────────────────────────────────────
// ALERTAS — de dónde salen los avisos automáticos.
//
// Una sola fuente de verdad por alerta: el cron y la pantalla de Cobros llaman a
// las MISMAS funciones. Si el aviso dice "5 clientes vencidos", la pantalla que
// abre el aviso tiene que mostrar esos 5 y no otros.
//
// Todas devuelven estructuras vacías ante cualquier problema (columna que no
// existe, migración sin aplicar) en vez de lanzar: un aviso que no se pudo
// calcular no puede tumbar el cron ni dejar sin avisos a los demás negocios.
// ─────────────────────────────────────────────────────────────────────────────

const hoyBogota = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

const num = (v) => Number(v || 0);

// ── 1. Cartera vencida (clientes a los que hay que cobrarles) ────────────────

/**
 * Documentos con el plazo ya pasado y que todavía deben algo.
 *
 * DOS COSAS QUE NO SON OBVIAS:
 *
 *   · Se traen TODOS los vencidos activos, incluso los que tienen el capital en
 *     cero. Desde que capital y mora son deudas separadas, un préstamo con el
 *     producto pagado pero con intereses pendientes sigue abierto y hay que
 *     cobrarle. Filtrar por `saldo > 0` lo dejaría fuera.
 *
 *   · La mora la calcula `mora.service` con la fórmula real (acumulada por
 *     tramos), no una cuenta rápida aquí. Duplicarla daría un número distinto al
 *     que ve el usuario en la pantalla del préstamo, y en plata eso no se
 *     perdona.
 *
 * @param {number} negocioId
 * @param {number|null} sucursalId — limita a una sucursal (para supervisor/vendedor)
 */
const carteraVencida = async (negocioId, sucursalId = null) => {
  const vacio = { items: [], total_clientes: 0, capital: 0, mora: 0, total: 0 };
  if (!negocioId) return vacio;

  try {
    const hoy = hoyBogota();

    // Préstamos vencidos. El nombre y el teléfono salen de la persona ligada
    // (prestatario o cliente) y, si no hay, de lo que se escribió en el préstamo.
    const { rows: prestamos } = await pool.query(`
      SELECT
        p.id, p.numero, p.sucursal_id, su.nombre AS sucursal_nombre,
        p.valor_prestamo, p.total_abonado, p.fecha_limite, p.mora_condicion,
        p.nombre_producto AS detalle,
        COALESCE(pr.nombre, cl.nombre, p.prestatario) AS persona,
        -- '0000000000' es el comodín de "sin teléfono" que usa el sistema para
        -- compañeros y clientes sin datos. Dejarlo pasar pintaría un botón de
        -- llamar que marca un número que no existe.
        COALESCE(NULLIF(NULLIF(cl.celular, ''), '0000000000'),
                 NULLIF(NULLIF(p.telefono, ''), '0000000000')) AS telefono
      FROM prestamos p
      JOIN sucursales su ON su.id = p.sucursal_id
      LEFT JOIN prestatarios pr ON pr.id = p.prestatario_id
      LEFT JOIN clientes     cl ON cl.id = p.cliente_id
      WHERE su.negocio_id = $1
        AND ($2::int IS NULL OR p.sucursal_id = $2)
        AND p.estado = 'Activo'
        AND p.fecha_limite IS NOT NULL
        AND p.fecha_limite < $3::date
    `, [negocioId, sucursalId, hoy]);

    // Créditos vencidos. La persona vive en la factura (o en el cliente ligado).
    const { rows: creditos } = await pool.query(`
      SELECT
        c.id, c.sucursal_id, su.nombre AS sucursal_nombre,
        c.valor_total, c.cuota_inicial, c.total_abonado, c.fecha_limite, c.mora_condicion,
        f.numero AS numero, c.factura_id,
        COALESCE(cl.nombre, f.nombre_cliente) AS persona,
        COALESCE(NULLIF(NULLIF(cl.celular, ''), '0000000000'),
                 NULLIF(NULLIF(f.celular,  ''), '0000000000')) AS telefono
      FROM creditos c
      JOIN sucursales su ON su.id = c.sucursal_id
      LEFT JOIN facturas f ON f.id = c.factura_id
      LEFT JOIN clientes cl ON cl.id = c.cliente_id
      WHERE su.negocio_id = $1
        AND ($2::int IS NULL OR c.sucursal_id = $2)
        AND c.estado = 'Activo'
        AND c.fecha_limite IS NOT NULL
        AND c.fecha_limite < $3::date
    `, [negocioId, sucursalId, hoy]);

    if (!prestamos.length && !creditos.length) return vacio;

    // La mora, con la fórmula real y en lote (una consulta para todos).
    const [prestamosConMora, creditosConMora] = await Promise.all([
      moraService.anotarLista(prestamos, 'prestamo'),
      moraService.anotarLista(creditos,  'credito'),
    ]);

    const items = [];

    for (const p of prestamosConMora) {
      const capital = Math.max(0, num(p.valor_prestamo) - num(p.total_abonado));
      const mora    = num(p.mora?.pendiente);
      if (capital + mora <= 0) continue;      // ya no debe nada: no es cobro
      items.push({
        tipo: 'prestamo',
        id: Number(p.id),
        numero: p.numero ?? p.id,
        sucursal_id: p.sucursal_id,
        sucursal_nombre: p.sucursal_nombre,
        persona: p.persona || 'Sin nombre',
        telefono: p.telefono || null,
        detalle: p.detalle || null,
        fecha_limite: p.fecha_limite,
        dias_vencidos: num(p.mora?.dias_vencidos),
        capital, mora, total: capital + mora,
      });
    }

    for (const c of creditosConMora) {
      const capital = Math.max(0, num(c.valor_total) - num(c.cuota_inicial) - num(c.total_abonado));
      const mora    = num(c.mora?.pendiente);
      if (capital + mora <= 0) continue;
      items.push({
        tipo: 'credito',
        id: Number(c.id),
        numero: c.numero ?? c.factura_id,
        sucursal_id: c.sucursal_id,
        sucursal_nombre: c.sucursal_nombre,
        persona: c.persona || 'Sin nombre',
        telefono: c.telefono || null,
        detalle: null,
        fecha_limite: c.fecha_limite,
        dias_vencidos: num(c.mora?.dias_vencidos),
        capital, mora, total: capital + mora,
      });
    }

    // El más atrasado primero: es a quien hay que llamar hoy.
    items.sort((a, b) => b.dias_vencidos - a.dias_vencidos || b.total - a.total);

    return {
      items,
      total_clientes: new Set(items.map((i) => `${i.persona}|${i.telefono ?? ''}`)).size,
      capital: items.reduce((s, i) => s + i.capital, 0),
      mora:    items.reduce((s, i) => s + i.mora, 0),
      total:   items.reduce((s, i) => s + i.total, 0),
    };
  } catch (err) {
    console.warn('[alertas] Cartera vencida no disponible:', err.message);
    return vacio;
  }
};

// ── 2. Plan por vencer ───────────────────────────────────────────────────────

const DIAS_AVISO_PLAN = [7, 3, 1, 0];

/**
 * Estado del plan del negocio, con los días que faltan.
 *
 * Solo se avisa en los hitos de `DIAS_AVISO_PLAN`. Avisar todos los días desde
 * el séptimo convierte el aviso en ruido y el dueño deja de mirarlo, que es
 * justo lo contrario de lo que se busca.
 */
const planPorVencer = async (negocioId) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, nombre, plan, estado_plan, fecha_vencimiento,
             ((fecha_vencimiento AT TIME ZONE 'America/Bogota')::date
               - (NOW() AT TIME ZONE 'America/Bogota')::date) AS dias
      FROM negocios
      WHERE id = $1
    `, [negocioId]);
    const n = rows[0];
    if (!n || !n.fecha_vencimiento) return null;

    const dias = Number(n.dias);
    if (!Number.isFinite(dias)) return null;
    // Ya vencido: de eso se encarga el bloqueo del plan, no un aviso.
    if (dias < 0) return null;
    if (!DIAS_AVISO_PLAN.includes(dias)) return null;
    if (n.estado_plan !== 'activo' && n.estado_plan !== 'trial') return null;

    return { negocio_id: n.id, nombre: n.nombre, plan: n.plan, dias, fecha_vencimiento: n.fecha_vencimiento };
  } catch (err) {
    console.warn('[alertas] Plan por vencer no disponible:', err.message);
    return null;
  }
};

// ── 3. Stock bajo ────────────────────────────────────────────────────────────

/**
 * Productos en o por debajo de su mínimo, agrupados por sucursal.
 *
 * SOLO cuentan los que tienen un mínimo configurado (`stock_minimo > 0`). Sin
 * ese filtro, todo producto agotado y sin mínimo entraría en la alerta y el
 * aviso diario se volvería una lista de cien cosas que a nadie le importan.
 *
 * Los productos con serial (IMEI) no entran: no tienen mínimo, son piezas
 * únicas.
 */
const stockBajo = async (negocioId, sucursalId = null) => {
  const vacio = [];
  if (!negocioId) return vacio;

  try {
    const { rows } = await pool.query(`
      WITH bajos AS (
        -- Productos simples
        SELECT pc.sucursal_id, pc.nombre, pc.stock::numeric AS stock, pc.stock_minimo::numeric AS minimo
        FROM productos_cantidad pc
        WHERE pc.activo
          AND pc.stock_minimo > 0
          AND pc.stock <= pc.stock_minimo

        UNION ALL

        -- Atributos (un nivel de variante)
        SELECT ap.sucursal_id, pc.nombre || ' · ' || ap.valor, ap.stock::numeric, ap.stock_minimo::numeric
        FROM atributos_producto ap
        JOIN productos_cantidad pc ON pc.id = ap.producto_id
        WHERE ap.activo AND pc.activo
          AND ap.stock_minimo > 0
          AND ap.stock <= ap.stock_minimo

        UNION ALL

        -- Variantes (dos niveles)
        SELECT ap.sucursal_id, pc.nombre || ' · ' || ap.valor || ' · ' || va.valor,
               va.stock::numeric, va.stock_minimo::numeric
        FROM variantes_atributo va
        JOIN atributos_producto ap ON ap.id = va.atributo_id
        JOIN productos_cantidad pc ON pc.id = ap.producto_id
        WHERE va.activo AND ap.activo AND pc.activo
          AND va.stock_minimo > 0
          AND va.stock <= va.stock_minimo
      )
      SELECT b.sucursal_id, su.nombre AS sucursal_nombre,
             COUNT(*)::int                                  AS cuantos,
             COUNT(*) FILTER (WHERE b.stock <= 0)::int       AS agotados,
             (ARRAY_AGG(b.nombre ORDER BY b.stock ASC))[1:3] AS ejemplos
      FROM bajos b
      JOIN sucursales su ON su.id = b.sucursal_id
      WHERE su.negocio_id = $1
        AND ($2::int IS NULL OR b.sucursal_id = $2)
      GROUP BY b.sucursal_id, su.nombre
      ORDER BY cuantos DESC
    `, [negocioId, sucursalId]);

    return rows.map((r) => ({
      sucursal_id: Number(r.sucursal_id),
      sucursal_nombre: r.sucursal_nombre,
      cuantos: Number(r.cuantos),
      agotados: Number(r.agotados),
      ejemplos: r.ejemplos || [],
    }));
  } catch (err) {
    console.warn('[alertas] Stock bajo no disponible:', err.message);
    return vacio;
  }
};

// ── Negocios a los que hay que revisarles las alertas ────────────────────────

/**
 * Negocios activos con al menos un dispositivo suscrito.
 *
 * El filtro por dispositivos es lo que hace barato el cron: sin él, un
 * despliegue con 28 negocios recorrería 28 carteras completas cada mañana para
 * no enviarle nada a nadie.
 */
const negociosANotificar = async () => {
  const { rows } = await pool.query(`
    SELECT DISTINCT n.id, n.nombre
    FROM negocios n
    JOIN push_suscripciones ps ON ps.negocio_id = n.id AND ps.activa
    WHERE n.activo
      AND n.estado_plan <> 'suspendido'
    ORDER BY n.id
  `);
  return rows;
};

module.exports = { carteraVencida, planPorVencer, stockBajo, negociosANotificar, hoyBogota };
