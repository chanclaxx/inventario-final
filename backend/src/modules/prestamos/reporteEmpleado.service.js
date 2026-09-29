// src/modules/prestamos/reporteEmpleado.service.js
// ─────────────────────────────────────────────────────────────────────────────
// REPORTE POR EMPLEADO — qué vendió, prestó y dio a crédito entre dos fechas.
//
// En estos negocios al empleado se le paga por los equipos que sale a mover
// —vendidos, prestados a clientes y a compañeros, a crédito— y el jefe liquida
// cada mes. Para eso el empleado necesita ver TODO lo que hizo en el período y
// en qué quedó cada cosa, separado por tipo y por estado, porque lo devuelto no
// se paga igual que lo vendido.
//
// Es un reporte INFORMATIVO: no calcula comisiones ni totales de plata. Cada
// fila dice lo que el sistema ya sabe (valor, lo que se debe, cuándo se pagó) y
// la liquidación la hacen el empleado y el jefe (decisión del negocio).
//
// Reglas:
//   · Quién lo hizo = `usuario_id` del documento: quien tenía la sesión. Es lo
//     único que tienen a la vez facturas y préstamos (`vendedor_id` solo existe
//     en facturas, y es opt-in).
//   · Una fila por PRODUCTO, no por documento: una factura con dos celulares son
//     dos filas, y si uno se devolvió cae en otro grupo que el otro.
//   · La fecha es la de la operación (la venta, el préstamo). El ESTADO es el de
//     hoy: un préstamo de agosto pagado en septiembre sale como pagado.
//   · Fuera: la factura que el sistema genera al saldarse un préstamo (el
//     equipo ya sale como préstamo pagado; contarlo también como venta lo
//     duplicaría) y los «ajustes de deuda» (cédula 'AJUSTE'), que no son un
//     préstamo de mercancía.
//   · Las fechas se formatean en SQL: node-postgres convierte un TIMESTAMP en un
//     Date con la zona del servidor (UTC en Railway) y el día se correría.
// ─────────────────────────────────────────────────────────────────────────────
const { pool } = require('../../config/db');

// Texto con que `_crearFacturaDesdePrestamo` marca la factura de un préstamo
// saldado. Es la misma marca que usa `cancelarFacturaDePrestamo`.
const MARCA_FACTURA_DE_PRESTAMO = 'Factura generada por saldo de préstamo%';

const TIPOS = [
  { id: 'contado',            titulo: 'Ventas de contado',        color: 'azul'    },
  { id: 'credito',            titulo: 'Ventas a crédito',         color: 'morado'  },
  { id: 'prestamo_cliente',   titulo: 'Préstamos a clientes',     color: 'naranja' },
  { id: 'prestamo_companero', titulo: 'Préstamos a compañeros',   color: 'verde'   },
];

// El orden en que se leen los grupos dentro de cada tipo.
const GRUPOS = [
  { id: 'pagado',           titulo: 'Pagados',                 tono: 'verde'   },
  { id: 'pendiente',        titulo: 'Pendientes de pago',      tono: 'naranja', corto: 'Pendientes'   },
  { id: 'devuelto_parcial', titulo: 'Con devolución parcial',  tono: 'azul',    corto: 'Dev. parcial' },
  { id: 'devuelto',         titulo: 'Devueltos',               tono: 'rojo'    },
  { id: 'cancelado',        titulo: 'Cancelados',              tono: 'gris'    },
];

// Un nombre por tipo cuando el grupo «pagado» merece decirse distinto.
const TITULO_GRUPO = {
  contado: { pagado: 'Vendidos' },
};

const tituloGrupo = (tipo, grupo) =>
  TITULO_GRUPO[tipo]?.[grupo] || GRUPOS.find((g) => g.id === grupo)?.titulo || grupo;

const _num = (v) => Number(v) || 0;

// ─── Clasificación (funciones puras) ────────────────────────────────────────

/**
 * A qué grupo va una línea de factura. Sirve para contado y para crédito: lo
 * que las distingue es solo si hay crédito, y en contado nunca hay
 * «pendiente» (se pagó al vender).
 */
const clasificarLineaFactura = (l) => {
  const cantidad  = _num(l.cantidad);
  const devuelta  = _num(l.cantidad_devuelta);
  const esCredito = !!l.credito_id || l.factura_estado === 'Credito';

  if (l.factura_estado === 'Cancelada' || l.credito_estado === 'Cancelado') return 'cancelado';
  if (cantidad > 0 && devuelta >= cantidad) return 'devuelto';
  if (devuelta > 0) return 'devuelto_parcial';
  if (!esCredito) return 'pagado';
  return l.credito_estado === 'Saldado' ? 'pagado' : 'pendiente';
};

const clasificarPrestamo = (p) => {
  if (p.estado === 'Devuelto') return 'devuelto';
  if (p.estado === 'Saldado')  return 'pagado';
  if (p.estado === 'Activo')   return 'pendiente';
  // Un estado que no conocemos no se esconde: se muestra como pendiente, que
  // es lo que obliga a alguien a mirarlo antes de liquidar.
  return 'pendiente';
};

const tipoDePrestamo = (p) => (p.cliente_id ? 'prestamo_cliente' : 'prestamo_companero');
const tipoDeLinea    = (l) => (l.credito_id || l.factura_estado === 'Credito' ? 'credito' : 'contado');

// ─── Filas listas para pintar ───────────────────────────────────────────────

const _producto = (nombre, ...etiquetas) => {
  const extra = etiquetas.filter((e) => e && !String(nombre || '').includes(e));
  return [nombre || 'Producto', ...extra].join(' · ');
};

const filaDeLinea = (l) => {
  const grupo = clasificarLineaFactura(l);
  const cantidad = _num(l.cantidad);
  const devuelta = _num(l.cantidad_devuelta);
  const obsequio = l.obsequio === true || l.obsequio === 'true';
  const detalle = [];

  if (grupo === 'cancelado') detalle.push('Factura cancelada');
  if (grupo === 'devuelto') detalle.push(cantidad > 1 ? `Devolvió las ${cantidad}` : 'Devuelto');
  if (grupo === 'devuelto_parcial') detalle.push(`Devolvió ${devuelta} de ${cantidad}`);
  if (l.credito_id && grupo !== 'cancelado') {
    if (l.credito_estado === 'Saldado') {
      detalle.push(l.ultimo_abono_txt ? `Crédito pagado el ${l.ultimo_abono_txt}` : 'Crédito pagado');
    } else {
      const saldo = _num(l.valor_total) - _num(l.cuota_inicial) - _num(l.total_abonado);
      detalle.push({ etiqueta: 'Saldo crédito', valor: Math.max(0, saldo) });
    }
  }

  return {
    grupo,
    fecha:     l.fecha_txt,
    documento: `F-${l.numero ?? l.factura_id}`,
    persona:   l.nombre_cliente || 'Cliente',
    persona_extra: [l.cedula && l.cedula !== 'COMPANERO' ? `CC ${l.cedula}` : null,
      l.vendedor_nombre ? `Vendedor: ${l.vendedor_nombre}` : null].filter(Boolean).join(' · '),
    producto:  l.nombre_producto || 'Producto',
    imei:      l.imei || null,
    cantidad,
    valor:     obsequio ? null : _num(l.subtotal ?? _num(l.precio) * cantidad),
    obsequio,
    detalle,
  };
};

const filaDePrestamo = (p) => {
  const grupo = clasificarPrestamo(p);
  const detalle = [];
  const abonado = _num(p.total_abonado);

  if (grupo === 'pagado') {
    detalle.push(p.ultimo_abono_txt ? `Pagado el ${p.ultimo_abono_txt}` : 'Pagado');
  } else if (grupo === 'pendiente') {
    detalle.push({ etiqueta: 'Debe', valor: Math.max(0, _num(p.valor_prestamo) - abonado) });
    if (abonado > 0) detalle.push({ etiqueta: 'Abonado', valor: abonado });
  } else if (grupo === 'devuelto') {
    detalle.push('Equipo devuelto');
    if (abonado > 0) detalle.push({ etiqueta: 'Había abonado', valor: abonado });
  }

  const esCliente = !!p.cliente_id;
  const persona = esCliente
    ? (p.cliente_nombre || p.prestatario || 'Cliente')
    : (p.prestatario_nombre || p.prestatario || 'Compañero');
  const extra = esCliente
    ? (p.cedula && !['COMPANERO', 'AJUSTE'].includes(p.cedula) ? `CC ${p.cedula}` : '')
    : (p.empleado_nombre ? `Recibió: ${p.empleado_nombre}` : '');

  return {
    grupo,
    fecha:     p.fecha_txt,
    documento: `P-${p.numero ?? p.id}`,
    persona,
    persona_extra: extra,
    producto:  _producto(p.nombre_producto, p.atributo_label, p.variante_label),
    imei:      p.imei || null,
    cantidad:  _num(p.cantidad_prestada) || 1,
    valor:     _num(p.valor_prestamo),
    obsequio:  false,
    detalle,
  };
};

/**
 * Arma el reporte agrupado: empleado → tipo → grupo → filas.
 * Siempre trae los CUATRO tipos de cada empleado, aunque estén vacíos: que un
 * tipo no aparezca no dice si no hubo nada o si el reporte no lo buscó.
 */
const armarReporte = ({ lineas = [], prestamos = [], empleados = [] }) => {
  const porEmpleado = new Map();
  const empleado = (id, nombre) => {
    const clave = id ?? 0;
    if (!porEmpleado.has(clave)) {
      porEmpleado.set(clave, {
        usuario_id: id ?? null,
        nombre: nombre || (id ? `Usuario #${id}` : 'Sin usuario registrado'),
        tipos: Object.fromEntries(TIPOS.map((t) => [t.id, []])),
      });
    }
    return porEmpleado.get(clave);
  };

  // Los elegidos salen aunque no tengan nada: un reporte vacío también es una
  // respuesta, y la tiene que ver quien lo pidió.
  for (const e of empleados) empleado(e.id, e.nombre);
  for (const l of lineas)    empleado(l.usuario_id, l.usuario_nombre).tipos[tipoDeLinea(l)].push(filaDeLinea(l));
  for (const p of prestamos) empleado(p.usuario_id, p.usuario_nombre).tipos[tipoDePrestamo(p)].push(filaDePrestamo(p));

  const lista = [...porEmpleado.values()].map((e) => {
    const secciones = TIPOS.map((t) => {
      const filas = e.tipos[t.id];
      const grupos = GRUPOS
        .map((g) => ({
          id: g.id, tono: g.tono, titulo: tituloGrupo(t.id, g.id),
          filas: filas.filter((f) => f.grupo === g.id),
        }))
        .filter((g) => g.filas.length > 0);
      return {
        id: t.id, titulo: t.titulo, color: t.color,
        total_filas: filas.length,
        unidades: filas.reduce((s, f) => s + (f.cantidad || 0), 0),
        grupos,
      };
    });
    return {
      usuario_id: e.usuario_id,
      nombre: e.nombre,
      total_filas: secciones.reduce((s, x) => s + x.total_filas, 0),
      secciones,
    };
  });

  // Quien no tiene usuario (documentos viejos) va al final.
  return lista.sort((a, b) => {
    if ((a.usuario_id == null) !== (b.usuario_id == null)) return a.usuario_id == null ? 1 : -1;
    return String(a.nombre).localeCompare(String(b.nombre), 'es');
  });
};

// ─── Consultas ──────────────────────────────────────────────────────────────

const _lineasFactura = async ({ sucursalId, desde, hasta, usuarioId, soloEquipos }) => {
  const { rows } = await pool.query(`
    SELECT
      f.id AS factura_id, f.numero, f.estado AS factura_estado,
      TO_CHAR(f.fecha, 'DD/MM/YYYY') AS fecha_txt,
      f.usuario_id, u.nombre AS usuario_nombre,
      f.nombre_cliente, f.cedula, vd.nombre AS vendedor_nombre,
      l.id AS linea_id, l.nombre_producto, l.imei, l.cantidad,
      COALESCE(l.cantidad_devuelta, 0) AS cantidad_devuelta,
      l.precio, l.subtotal,
      -- Por to_jsonb y no por nombre: sin la migración de obsequios la columna
      -- no existe y nombrarla tumbaría el reporte entero.
      (to_jsonb(l) ->> 'obsequio') AS obsequio,
      cr.id AS credito_id, cr.estado AS credito_estado,
      cr.valor_total, cr.cuota_inicial, cr.total_abonado, cr.ultimo_abono_txt
    FROM facturas f
    JOIN lineas_factura    l  ON l.factura_id = f.id
    LEFT JOIN usuarios     u  ON u.id  = f.usuario_id
    LEFT JOIN vendedores   vd ON vd.id = f.vendedor_id
    LEFT JOIN LATERAL (
      SELECT c.id, c.estado, c.valor_total, c.cuota_inicial, c.total_abonado,
             (SELECT TO_CHAR(MAX(ac.fecha), 'DD/MM/YYYY')
                FROM abonos_credito ac
               WHERE ac.credito_id = c.id AND NOT ac.anulado) AS ultimo_abono_txt
        FROM creditos c
       WHERE c.factura_id = f.id
       ORDER BY c.id DESC
       LIMIT 1
    ) cr ON TRUE
    WHERE f.sucursal_id = $1
      AND f.fecha >= $2::date
      AND f.fecha <  $3::date + 1
      AND ($4::int IS NULL OR f.usuario_id = $4)
      AND COALESCE(f.notas, '') NOT LIKE $5
      AND ($6::boolean IS FALSE OR NULLIF(BTRIM(l.imei), '') IS NOT NULL)
    ORDER BY f.fecha, f.id, l.id
  `, [sucursalId, desde, hasta, usuarioId, MARCA_FACTURA_DE_PRESTAMO, !!soloEquipos]);
  return rows;
};

const _prestamos = async ({ sucursalId, desde, hasta, usuarioId, soloEquipos }) => {
  const { rows } = await pool.query(`
    SELECT
      p.id, p.numero, p.estado,
      TO_CHAR(p.fecha, 'DD/MM/YYYY') AS fecha_txt,
      p.usuario_id, u.nombre AS usuario_nombre,
      p.prestatario, p.cedula, p.prestatario_id, p.cliente_id,
      pr.nombre AS prestatario_nombre, e.nombre AS empleado_nombre, c.nombre AS cliente_nombre,
      p.nombre_producto, p.imei, p.cantidad_prestada, p.valor_prestamo, p.total_abonado,
      (to_jsonb(p) ->> 'atributo_label') AS atributo_label,
      (to_jsonb(p) ->> 'variante_label') AS variante_label,
      (SELECT TO_CHAR(MAX(ab.fecha), 'DD/MM/YYYY')
         FROM abonos_prestamo ab
        WHERE ab.prestamo_id = p.id AND NOT ab.anulado) AS ultimo_abono_txt
    FROM prestamos p
    LEFT JOIN usuarios              u  ON u.id  = p.usuario_id
    LEFT JOIN prestatarios          pr ON pr.id = p.prestatario_id
    LEFT JOIN empleados_prestatario e  ON e.id  = p.empleado_id
    LEFT JOIN clientes              c  ON c.id  = p.cliente_id
    WHERE p.sucursal_id = $1
      AND p.fecha >= $2::date
      AND p.fecha <  $3::date + 1
      AND ($4::int IS NULL OR p.usuario_id = $4)
      AND COALESCE(p.cedula, '') <> 'AJUSTE'
      AND ($5::boolean IS FALSE OR NULLIF(BTRIM(p.imei), '') IS NOT NULL)
    ORDER BY p.fecha, p.id
  `, [sucursalId, desde, hasta, usuarioId, !!soloEquipos]);
  return rows;
};

/**
 * Quién puede salir en el selector. Un VENDEDOR solo se ve a sí mismo: el
 * reporte es su liquidación, no la de sus compañeros. Supervisor y admin eligen
 * entre los usuarios de la sede (los inactivos también: a quien se fue hay que
 * liquidarle el último mes).
 */
const listarEmpleados = async ({ negocioId, sucursalId, usuario }) => {
  if (usuario.rol === 'vendedor') {
    return { puede_elegir: false, yo: usuario.id, empleados: [{ id: usuario.id, nombre: usuario.nombre, rol: usuario.rol, activo: true }] };
  }
  const { rows } = await pool.query(`
    SELECT u.id, u.nombre, u.rol, u.activo
      FROM usuarios u
     WHERE u.negocio_id = $1
       AND (u.sucursal_id = $2 OR u.rol = 'admin_negocio')
     ORDER BY u.activo DESC, u.nombre
  `, [negocioId, sucursalId]);
  return { puede_elegir: true, yo: usuario.id, empleados: rows };
};

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS = 400;

const validarRango = (desde, hasta) => {
  if (!FECHA_RE.test(String(desde || '')) || !FECHA_RE.test(String(hasta || ''))) {
    throw { status: 400, message: 'Indica la fecha inicial y la final' };
  }
  const d = Date.parse(`${desde}T00:00:00Z`);
  const h = Date.parse(`${hasta}T00:00:00Z`);
  if (Number.isNaN(d) || Number.isNaN(h)) throw { status: 400, message: 'Fecha inválida' };
  if (d > h) throw { status: 400, message: 'La fecha inicial no puede ser posterior a la final' };
  if ((h - d) / 86400000 > MAX_DIAS) {
    throw { status: 400, message: 'El rango no puede pasar de un año' };
  }
};

/**
 * `usuarioId` null = todos los empleados de la sede (solo quien puede elegir).
 * Un vendedor SIEMPRE sale con el suyo, pida lo que pida.
 */
const obtenerReporte = async ({ negocioId, sucursalId, usuario, usuarioId, desde, hasta, soloEquipos }) => {
  validarRango(desde, hasta);

  let elegido = usuarioId ?? null;
  if (usuario.rol === 'vendedor') elegido = usuario.id;

  let empleadosElegidos = [];
  if (elegido) {
    const { rows } = await pool.query(
      'SELECT id, nombre, rol FROM usuarios WHERE id = $1 AND negocio_id = $2', [elegido, negocioId]);
    if (!rows.length) throw { status: 404, message: 'Empleado no encontrado' };
    empleadosElegidos = rows;
  }

  const filtros = { sucursalId, desde, hasta, usuarioId: elegido, soloEquipos };
  const [lineas, prestamos] = await Promise.all([_lineasFactura(filtros), _prestamos(filtros)]);
  const empleados = armarReporte({ lineas, prestamos, empleados: empleadosElegidos });

  const { rows: suc } = await pool.query(
    'SELECT nombre FROM sucursales WHERE id = $1 AND negocio_id = $2', [sucursalId, negocioId]);

  return {
    desde, hasta,
    solo_equipos: !!soloEquipos,
    todos: !elegido,
    sucursal_nombre: suc[0]?.nombre || '',
    empleados,
  };
};

module.exports = {
  TIPOS, GRUPOS, MARCA_FACTURA_DE_PRESTAMO,
  tituloGrupo, clasificarLineaFactura, clasificarPrestamo,
  filaDeLinea, filaDePrestamo, armarReporte,
  validarRango, listarEmpleados, obtenerReporte,
};
