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

// ── 1. Cartera: lo vencido y lo que está por vencer ──────────────────────────

/** Días de anticipación por defecto para avisar de un pago que se acerca. */
const DIAS_AVISO_PREVIO = 3;

/** Cuántos días antes quiere el negocio que se le avise. Configurable en Ajustes. */
const diasAvisoPrevio = async (negocioId) => {
  try {
    const configRepo = require('../config/config.repository');
    const cfg = await configRepo.getMap(negocioId);
    const n = Number(cfg?.mora_aviso_previo_dias);
    // Tope de 30: más allá el aviso deja de ser "se acerca" y se vuelve ruido
    // diario sobre deudas que todavía nadie tiene que pagar.
    if (Number.isFinite(n) && n >= 1 && n <= 30) return Math.floor(n);
  } catch { /* sin config utilizable: se queda con el valor por defecto */ }
  return DIAS_AVISO_PREVIO;
};

/**
 * Documentos con plazo que hay que trabajar: los VENCIDOS y los que están POR
 * VENCER dentro de la ventana de aviso.
 *
 * Los dos grupos salen de la misma consulta a propósito. Avisar solo de lo
 * vencido llega tarde: el negocio quería llamar ANTES, que es cuando el cliente
 * todavía puede pagar sin mora y la llamada es un recordatorio y no un reclamo.
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
 *     perdona. En los que aún no vencen da 0, como debe ser.
 *
 * @param {number} negocioId
 * @param {number|null} sucursalId — limita a una sucursal (para supervisor/vendedor)
 * @param {number|null} diasAviso  — ventana de "por vencer"; si no se pasa, la del negocio
 */
const cartera = async (negocioId, sucursalId = null, diasAviso = null) => {
  const grupoVacio = { items: [], total_clientes: 0, capital: 0, mora: 0, interes: 0, total: 0 };
  const vacio = { vencidos: grupoVacio, por_vencer: grupoVacio, dias_aviso: DIAS_AVISO_PREVIO };
  if (!negocioId) return vacio;

  try {
    const hoy  = hoyBogota();
    const dias = diasAviso ?? await diasAvisoPrevio(negocioId);

    // Préstamos vencidos. El nombre y el teléfono salen de la persona ligada
    // (prestatario o cliente) y, si no hay, de lo que se escribió en el préstamo.
    const { rows: prestamos } = await pool.query(`
      SELECT
        p.id, p.numero, p.sucursal_id, su.nombre AS sucursal_nombre,
        p.valor_prestamo, p.total_abonado, p.fecha_limite, p.mora_condicion,
        -- Sin el pacto de interés, anotarLista lo da por inexistente y el total
        -- del cobro saldría corto. Las consultas de préstamos listan columnas
        -- explícitas: hay que acordarse de agregarlas en cada una.
        p.interes_condicion, p.interes_desde, p.fecha,
        p.nombre_producto AS detalle,
        p.prestatario_id, p.cliente_id,
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
        AND p.fecha_limite <= ($3::date + $4::int)
    `, [negocioId, sucursalId, hoy, dias]);

    // Créditos vencidos. La persona vive en la factura (o en el cliente ligado).
    const { rows: creditos } = await pool.query(`
      SELECT
        c.id, c.sucursal_id, su.nombre AS sucursal_nombre,
        c.valor_total, c.cuota_inicial, c.total_abonado, c.fecha_limite, c.mora_condicion,
        c.interes_condicion, c.interes_desde, c.creado_en,
        f.numero AS numero, c.factura_id,
        -- La pantalla de créditos agrupa por (cedula o nombre_cliente) tomados
        -- de la FACTURA (ver creditos.repository.findAll). El enlace del aviso
        -- tiene que usar exactamente esa clave o no abre a nadie.
        f.cedula AS factura_cedula, f.nombre_cliente AS factura_nombre,
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
        AND c.fecha_limite <= ($3::date + $4::int)
    `, [negocioId, sucursalId, hoy, dias]);

    if (!prestamos.length && !creditos.length) return { ...vacio, dias_aviso: dias };

    // La mora, con la fórmula real y en lote (una consulta para todos).
    const [prestamosConMora, creditosConMora] = await Promise.all([
      moraService.anotarLista(prestamos, 'prestamo'),
      moraService.anotarLista(creditos,  'credito'),
    ]);

    const vencidos  = [];
    const porVencer = [];

    // ── A dónde lleva el aviso ────────────────────────────────────────────
    //
    // Directo a la ficha de la persona en la pantalla donde está su deuda: un
    // préstamo abre la lista de préstamos con ese compañero/cliente ya
    // seleccionado, y un crédito abre la pestaña de créditos con ese cliente.
    // El vendedor no tiene que buscar a nadie.
    //
    // Las claves son las MISMAS que arma cada pantalla al agrupar
    // (`prestatario_<id>` / `cliente_<id>` en préstamos, `cédula o nombre` en
    // créditos). Si alguna cambia allá, este enlace deja de abrir la ficha.
    const urlPrestamo = (p) => {
      const clave = p.prestatario_id ? `prestatario_${p.prestatario_id}`
        : p.cliente_id               ? `cliente_${p.cliente_id}`
        : null;
      return clave
        ? `/prestamos?tab=prestamos&persona=${encodeURIComponent(clave)}`
        : '/prestamos';
    };
    const urlCredito = (c) => {
      const clave = c.factura_cedula || c.factura_nombre;
      return clave
        ? `/prestamos?tab=creditos&persona=${encodeURIComponent(clave)}`
        : '/prestamos?tab=creditos';
    };

    // Días entre hoy y la fecha límite, en calendario puro (sin horas ni zonas).
    // Negativo = ya venció.
    const diasHasta = (fechaLimite) => {
      const f = String(fechaLimite instanceof Date ? fechaLimite.toISOString() : fechaLimite).slice(0, 10);
      const [ay, am, ad] = hoy.split('-').map(Number);
      const [by, bm, bd] = f.split('-').map(Number);
      return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
    };

    const clasificar = (item) => {
      const restantes = diasHasta(item.fecha_limite);
      if (restantes < 0) {
        vencidos.push({ ...item, estado: 'vencido', dias_restantes: 0 });
      } else {
        // Lo que aún no vence no causa mora: `dias_vencidos` es 0 por definición.
        porVencer.push({ ...item, estado: 'por_vencer', dias_restantes: restantes, dias_vencidos: 0 });
      }
    };

    // Lo que hay que cobrarle a esta persona son las TRES cubetas. Dejar el
    // interés por fuera haría que el vendedor llamara pidiendo menos de lo que
    // el cliente realmente debe.
    for (const p of prestamosConMora) {
      const capital = Math.max(0, num(p.valor_prestamo) - num(p.total_abonado));
      const mora    = num(p.mora?.pendiente);
      const interes = num(p.interes?.pendiente);
      if (capital + mora + interes <= 0) continue;   // ya no debe nada: no es cobro
      clasificar({
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
        capital, mora, interes, total: capital + mora + interes,
        url: urlPrestamo(p),
      });
    }

    for (const c of creditosConMora) {
      const capital = Math.max(0, num(c.valor_total) - num(c.cuota_inicial) - num(c.total_abonado));
      const mora    = num(c.mora?.pendiente);
      const interes = num(c.interes?.pendiente);
      if (capital + mora + interes <= 0) continue;
      clasificar({
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
        capital, mora, interes, total: capital + mora + interes,
        url: urlCredito(c),
      });
    }

    // Vencidos: el más atrasado primero (es a quien hay que llamar ya).
    vencidos.sort((a, b) => b.dias_vencidos - a.dias_vencidos || b.total - a.total);
    // Por vencer: el más próximo primero (el que vence hoy antes que el de 3 días).
    porVencer.sort((a, b) => a.dias_restantes - b.dias_restantes || b.total - a.total);

    return {
      vencidos:   _resumirGrupo(vencidos),
      por_vencer: _resumirGrupo(porVencer),
      dias_aviso: dias,
    };
  } catch (err) {
    console.warn('[alertas] Cartera no disponible:', err.message);
    return vacio;
  }
};

/** Totales de un grupo de cobros. Los clientes se cuentan sin repetir. */
const _resumirGrupo = (items) => ({
  items,
  total_clientes: new Set(items.map((i) => `${i.persona}|${i.telefono ?? ''}`)).size,
  capital: items.reduce((s, i) => s + i.capital, 0),
  mora:    items.reduce((s, i) => s + i.mora, 0),
  interes: items.reduce((s, i) => s + (i.interes || 0), 0),
  total:   items.reduce((s, i) => s + i.total, 0),
});

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

// ── Cartera de PROVEEDORES: lo que el negocio debe, no lo que le deben ───────
//
// Misma forma que `cartera` pero en la dirección contraria: aquí el negocio es
// el deudor. Sale de las órdenes de compra con factura y plazo pactado, cruzadas
// contra lo que ya se abonó al cargo del acreedor.
//
// Está detrás del flag `ordenes_compra_activas`: un negocio sin órdenes no tiene
// ninguna fecha de vencimiento registrada (antes de agosto de 2026 NINGÚN cargo
// de acreedor tenía plazo), así que recorrerlo sería trabajo perdido.
//
// Devuelve vacío ante cualquier problema —tabla inexistente, migración sin
// aplicar— igual que las demás: un aviso que no se pudo calcular no puede dejar
// sin avisos a los otros 27 negocios.
const carteraProveedores = async (negocioId) => {
  const vacio = { vencidas: [], por_vencer: [], dias_aviso: 3 };
  if (!negocioId) return vacio;

  try {
    const { getConfigOrdenes } = require('../../middlewares/ordenesCompra.middleware');
    const cfg = await getConfigOrdenes(negocioId);
    if (!cfg.activas) return vacio;

    const dias = cfg.dias_aviso;

    // El saldo se DERIVA del cargo menos sus abonos: no hay ni puede haber un
    // "saldo pendiente" guardado que se desfase cuando se anula una compra.
    //
    // Va en dos pasos, y el segundo NO es opcional:
    //
    //   1. Los CARGOS de la orden. Se buscan por las dos vías porque los dos
    //      modos conviven: en modo 'orden' el cargo cuelga de orden_compra_id, y
    //      en modo 'recepcion' hay uno por cada compra de la orden.
    //
    //   2. Los ABONOS, que se siguen por `cargo_id` y NO por la orden. Un pago
    //      hecho desde la cuenta del proveedor —la vía normal— solo lleva
    //      cargo_id: ni orden_compra_id ni compra_id. Buscándolos por la orden,
    //      pagar una factura no apagaría su aviso y el dueño seguiría viendo
    //      "vencida" sobre algo que ya pagó.
    //
    // Los abonos de saldo a favor (una devolución que excedió la deuda, con
    // cargo_id NULL) quedan fuera a propósito: son un crédito general del
    // proveedor, no el pago de ESTA factura. Avisar de más es preferible a
    // callar una factura que sí está pendiente.
    const { rows } = await pool.query(`
      WITH vivas AS (
        SELECT o.*
        FROM ordenes_compra o
        WHERE o.negocio_id = $1
          AND o.estado = 'Emitida'
          AND o.fecha_vencimiento IS NOT NULL
          AND o.fecha_vencimiento <= $2::date + $3::int
      ),
      cargos AS (
        SELECT DISTINCT v.id AS orden_id, m.id AS cargo_id, m.valor
        FROM      vivas   v
        LEFT JOIN compras c ON c.orden_compra_id = v.id AND c.estado <> 'Cancelada'
        JOIN      movimientos_acreedor m
               ON m.tipo = 'Cargo'
              AND (m.orden_compra_id = v.id OR m.compra_id = c.id)
      ),
      saldos AS (
        SELECT cg.orden_id,
               SUM(cg.valor)                        AS cargado,
               COALESCE(SUM(ab.abonado), 0)         AS abonado
        FROM cargos cg
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(a.valor), 0) AS abonado
          FROM movimientos_acreedor a
          WHERE a.cargo_id = cg.cargo_id AND a.tipo = 'Abono'
        ) ab ON TRUE
        GROUP BY cg.orden_id
      )
      SELECT
        v.id, v.numero, v.sucursal_id, su.nombre AS sucursal_nombre,
        v.fecha_vencimiento, v.numero_factura,
        p.nombre AS proveedor_nombre,
        (v.fecha_vencimiento - $2::date) AS dias_para_vencer,
        (s.cargado - s.abonado)          AS saldo
      FROM vivas v
      JOIN saldos      s  ON s.orden_id = v.id
      JOIN sucursales  su ON su.id = v.sucursal_id
      JOIN proveedores p  ON p.id  = v.proveedor_id
      WHERE s.cargado - s.abonado > 0
      ORDER BY v.fecha_vencimiento
    `, [negocioId, hoyBogota(), dias]);

    const items = rows.map((r) => ({
      id:               r.id,
      numero:           r.numero,
      sucursal_id:      r.sucursal_id,
      sucursal_nombre:  r.sucursal_nombre,
      proveedor:        r.proveedor_nombre,
      numero_factura:   r.numero_factura,
      dias_para_vencer: Number(r.dias_para_vencer),
      saldo:            num(r.saldo),
    }));

    return {
      vencidas:   items.filter((i) => i.dias_para_vencer < 0),
      por_vencer: items.filter((i) => i.dias_para_vencer >= 0),
      dias_aviso: dias,
    };
  } catch (err) {
    console.warn('[alertas] Cartera de proveedores no disponible:', err.message);
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

// ── Borradores de venta por vencer ───────────────────────────────────────────
//
// Un borrador que vence deja de reservar sin que nadie se entere: la mercancía
// que el vendedor le prometió a un cliente vuelve a estar libre en silencio.
// Este es el único aviso de la casa que se manda para que alguien DECIDA —
// llamar al cliente, renovar el borrador o descartarlo.
//
// Solo para negocios que encendieron la feature: sin el flag no hay borradores
// y la consulta ni se hace.
const borradoresPorVencer = async (negocioId, dias = 1) => {
  const vacio = [];
  if (!negocioId) return vacio;

  try {
    const { rows: cfg } = await pool.query(
      `SELECT valor FROM config_negocio
        WHERE negocio_id = $1 AND clave = 'borradores_activo'`,
      [negocioId]
    );
    if (cfg[0]?.valor !== '1') return vacio;

    const repo = require('../borradores/borradores.repository');
    return await repo.porVencer(negocioId, dias);
  } catch (err) {
    // Sin la migración aplicada (42P01) el negocio simplemente no recibe este
    // aviso; los otros cuatro siguen saliendo igual.
    if (err?.code !== '42P01') {
      console.error(`[alertas] borradoresPorVencer negocio ${negocioId}:`, err.message);
    }
    return vacio;
  }
};

module.exports = {
  cartera, diasAvisoPrevio, DIAS_AVISO_PREVIO,
  carteraProveedores,
  planPorVencer, stockBajo, borradoresPorVencer, negociosANotificar, hoyBogota,
};
