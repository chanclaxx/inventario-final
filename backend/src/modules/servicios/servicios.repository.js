const { pool } = require('../../config/db');
const { asignarNumeroDocumento } = require('../../utils/numeracion.util');
const { VENTANA_DUPLICADO_SEG } = require('../../utils/idempotencia.util');
const { hayServicioAbonosV2, hayTecnicosServicio } = require('../../config/columnas');
const tecnicosSrv = require('./servicios.tecnicos');

// ─────────────────────────────────────────────────────────────────────────────
// ABONOS EN CUALQUIER ETAPA (migrations/20261025_servicio_abonos_tecnicos.sql)
//
// El cliente puede dejar plata desde que entrega el equipo. Mientras no hay
// precio final no hay tope (la pantalla avisa si pasa el estimado); cuando el
// precio queda por debajo de lo abonado, la diferencia se DEVUELVE en la misma
// transacción, y un «sin reparar» cobra el diagnóstico y devuelve el resto.
//
// `total_abonado` se sigue manteniendo como siempre —sube con un abono, baja
// con una devolución o una anulación— dentro de la transacción que bloquea la
// orden. Es lo que leen reportes, la tarjeta y el saldo.
//
// Sin la migración (`hayServicioAbonosV2()` en falso) todo es como antes:
// abonos solo en Listo / Pendiente de pago / Garantía, y ninguna consulta
// nombra las columnas nuevas.
// ─────────────────────────────────────────────────────────────────────────────

const ESTADOS_ABONO_V2     = ['Recibido', 'En_reparacion', 'Listo', 'Pendiente_pago', 'Garantia'];
const ESTADOS_ABONO_LEGADO = ['Listo', 'Pendiente_pago', 'Garantia'];
const ESTADOS_ABIERTOS     = ['Recibido', 'En_reparacion', 'Listo', 'Pendiente_pago', 'Garantia'];

// La orden está en un ciclo de GARANTÍA desde que se abre una (estado
// 'Garantia') hasta que se cierra (precio_garantia queda escrito al marcarla
// lista). Antes de la primera garantía `precio_garantia` es NULL.
const SQL_EN_GARANTIA = (a = 'os') => `(${a}.estado = 'Garantia' OR ${a}.precio_garantia IS NOT NULL)`;

// Lo que se le cobra al cliente en el ciclo VIGENTE (NULL = todavía no se sabe).
// Antes, una garantía cobrable marcada lista pasaba a 'Listo' y desde ahí el
// saldo, el abono y la entrega se medían contra el precio de la reparación
// ORIGINAL. Una garantía gratis cobra 0.
const SQL_PRECIO_CICLO = (a = 'os') => `(CASE WHEN ${SQL_EN_GARANTIA(a)}
    THEN CASE WHEN ${a}.garantia_cobrable THEN ${a}.precio_garantia ELSE 0 END
    ELSE ${a}.precio_final END)`;

const SQL_SALDO = (a = 'os') => `(CASE
    WHEN ${a}.estado IN ('Listo','Pendiente_pago','Garantia') AND ${SQL_PRECIO_CICLO(a)} IS NOT NULL
    THEN GREATEST(${SQL_PRECIO_CICLO(a)} - ${a}.total_abonado, 0)
    ELSE 0 END)`;

/** Misma regla que SQL_EN_GARANTIA / SQL_PRECIO_CICLO, sobre una fila ya leída. */
const enGarantia = (o) => o.estado === 'Garantia' || o.precio_garantia !== null && o.precio_garantia !== undefined;
const precioCiclo = (o) => {
  if (enGarantia(o)) {
    if (!o.garantia_cobrable) return 0;
    return o.precio_garantia === null || o.precio_garantia === undefined ? null : Number(o.precio_garantia);
  }
  return o.precio_final === null || o.precio_final === undefined ? null : Number(o.precio_final);
};

const COLS_ORDEN_BLOQUEO = `id, numero, estado, precio_final, precio_garantia, total_abonado,
  garantia_cobrable, sucursal_id, costo_estimado,
  usuario_id, cliente_id, cliente_nombre, cliente_cedula, cliente_telefono,
  equipo_tipo, equipo_nombre, falla_reportada, factura_id`;

const _colsOrdenBloqueo = () => (hayServicioAbonosV2()
  ? `${COLS_ORDEN_BLOQUEO}, ciclo, tecnico_id` : COLS_ORDEN_BLOQUEO);

const _numOS = (o, id) => `#OS-${String(o.numero ?? id ?? o.id).padStart(4, '0')}`;
const _cop = (v) => `$${Math.round(Number(v) || 0).toLocaleString('es-CO')}`;

/** Escribe un abono o una devolución. Sin la migración solo existen abonos. */
const _insertarMovimiento = async (client, { ordenId, usuarioId, valor, metodo, notas, tipo = 'abono', orden }) => {
  if (hayServicioAbonosV2()) {
    const { rows } = await client.query(`
      INSERT INTO abonos_servicio (orden_id, usuario_id, valor, metodo, notas, tipo, etapa, ciclo)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
    `, [ordenId, usuarioId || null, valor, metodo || 'Efectivo', notas || null, tipo,
      orden?.estado ?? null, orden?.ciclo ?? 0]);
    return rows[0];
  }
  if (tipo !== 'abono') {
    throw { status: 503, message: 'Falta la actualización de la base para registrar devoluciones de servicio' };
  }
  const { rows } = await client.query(`
    INSERT INTO abonos_servicio (orden_id, usuario_id, valor, metodo, notas)
    VALUES ($1, $2, $3, $4, $5) RETURNING *
  `, [ordenId, usuarioId || null, valor, metodo || 'Efectivo', notas || null]);
  return rows[0];
};

// ─── Factura automática al entregar ──────────────────────────────────────────

const METODOS_FACTURA = new Set(['Efectivo','Transferencia','Tarjeta','Nequi','Daviplata','Credito','Otro']);

/**
 * Los pagos de la factura salen de lo que de verdad quedó: abonos menos
 * devoluciones, sin anulados. Una devolución se descuenta primero de su mismo
 * método y, si ahí no alcanza, del método con más plata (la factura tiene que
 * sumar lo que se cobró, no lo que pasó por la mano).
 */
const pagosNetos = (filas) => {
  const neto = new Map();
  for (const f of filas) {
    const m = METODOS_FACTURA.has(f.metodo) ? f.metodo : 'Otro';
    neto.set(m, (neto.get(m) || 0) + Number(f.abonos || 0) - Number(f.devoluciones || 0));
  }
  let deficit = 0;
  for (const [m, v] of neto) if (v < 0) { deficit += -v; neto.set(m, 0); }
  const orden = [...neto.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  for (const par of orden) {
    if (deficit <= 0) break;
    const quita = Math.min(par[1], deficit);
    par[1] -= quita;
    deficit -= quita;
  }
  return orden.filter(([, v]) => v > 0.004).map(([metodo, valor]) => ({ metodo, valor: Math.round(valor * 100) / 100 }));
};

const _crearFacturaPorServicio = async (client, orden, precioServicio) => {
  if (orden.factura_id) return;

  const partes = ['Servicio técnico'];
  if (orden.equipo_tipo)   partes.push(`(${orden.equipo_tipo})`);
  if (orden.equipo_nombre) partes.push(`- ${orden.equipo_nombre}`);
  const nombreLinea = partes.join(' ');

  const notas = `OS-${String(orden.numero ?? orden.id).padStart(4, '0')}: ${(orden.falla_reportada || '').slice(0, 200)}`;

  const { rows: [factura] } = await client.query(`
    INSERT INTO facturas(sucursal_id, usuario_id, cliente_id, nombre_cliente, cedula, celular, notas, estado)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'Activa')
    RETURNING id
  `, [
    orden.sucursal_id,
    orden.usuario_id || null,
    orden.cliente_id || null,
    orden.cliente_nombre,
    orden.cliente_cedula  || 'S/C',
    orden.cliente_telefono || '0000000000',
    notas,
  ]);

  await asignarNumeroDocumento(client, {
    tipo: 'factura', docId: factura.id, sucursalId: orden.sucursal_id,
  });

  await client.query(`
    INSERT INTO lineas_factura(factura_id, nombre_producto, cantidad, precio)
    VALUES ($1, $2, 1, $3)
  `, [factura.id, nombreLinea, precioServicio]);

  // Pagos: lo abonado por método, neto de devoluciones y sin anulados.
  const { rows: filas } = await client.query(hayServicioAbonosV2() ? `
    SELECT metodo,
           SUM(valor) FILTER (WHERE tipo = 'abono')      AS abonos,
           SUM(valor) FILTER (WHERE tipo = 'devolucion') AS devoluciones
    FROM abonos_servicio
    WHERE orden_id = $1 AND NOT anulado
    GROUP BY metodo
  ` : `
    SELECT metodo, SUM(valor) AS abonos, 0 AS devoluciones
    FROM abonos_servicio
    WHERE orden_id = $1
    GROUP BY metodo
  `, [orden.id]);

  for (const p of pagosNetos(filas)) {
    await client.query(
      'INSERT INTO pagos_factura(factura_id, metodo, valor) VALUES ($1, $2, $3)',
      [factura.id, p.metodo, p.valor],
    );
  }

  await client.query(
    'UPDATE ordenes_servicio SET factura_id = $1 WHERE id = $2',
    [factura.id, orden.id],
  );
};

// ─── Constantes ───────────────────────────────────────────────────────────────

const HOY_BOGOTA = `(NOW() AT TIME ZONE 'America/Bogota')::date`;

// El día de una columna TIMESTAMP: se guardan YA en hora Bogotá (el pool fija
// la zona en cada conexión), así que no lleva conversión. Misma regla que
// reportes.service.js.
const fechaBogota = (col) =>
  `(${col})::date`;

const COLS_CALCULADAS = () => `
  ${SQL_SALDO('os')} AS saldo_pendiente,
  ${SQL_PRECIO_CICLO('os')} AS precio_ciclo,
  ${SQL_EN_GARANTIA('os')} AS en_garantia,
  CASE
    WHEN os.precio_final IS NOT NULL AND os.costo_real IS NOT NULL
    THEN os.precio_final - os.costo_real
    ELSE NULL
  END AS utilidad,
  CASE
    WHEN os.precio_garantia IS NOT NULL AND os.costo_garantia IS NOT NULL
    THEN os.precio_garantia - os.costo_garantia
    ELSE NULL
  END AS utilidad_garantia`;

// El técnico interno (nombre) y el externo que lo reparó, si la feature existe.
const _colsTecnico = () => (hayTecnicosServicio() ? `,
      os.tecnico_id, ts.nombre AS tecnico_nombre,
      ${tecnicosSrv.sqlTecnicoExterno('os')} AS tecnico_externo` : `,
      NULL::int AS tecnico_id, NULL::text AS tecnico_nombre,
      ${tecnicosSrv.sqlTecnicoExterno('os')} AS tecnico_externo`);
const _joinTecnico = () => (hayTecnicosServicio()
  ? 'LEFT JOIN tecnicos_servicio ts ON ts.id = os.tecnico_id' : '');

// ─── Lectura ──────────────────────────────────────────────────────────────────

const findAll = async (sucursalId, negocioId, filtros = {}) => {
  const { estado, busqueda, tecnico } = filtros;
  const params = [];

  const filtroPrincipal = sucursalId
    ? `os.sucursal_id = $${params.push(sucursalId)}`
    : `os.negocio_id  = $${params.push(negocioId)}`;

  let where = filtroPrincipal;
  if (estado) where += ` AND os.estado = $${params.push(estado)}`;

  // Filtro por técnico interno: un id, o 'sin' = sin asignar. Un valor que no
  // se entiende no filtra (criterio de préstamos: lo que no se entiende no recorta).
  if (hayTecnicosServicio() && tecnico !== undefined && tecnico !== '') {
    if (tecnico === 'sin') where += ' AND os.tecnico_id IS NULL';
    else if (Number.isInteger(Number(tecnico)) && Number(tecnico) > 0) {
      where += ` AND os.tecnico_id = $${params.push(Number(tecnico))}`;
    }
  }

  if (busqueda) {
    const q = `%${busqueda.toLowerCase().slice(0, 100)}%`;
    const n = params.push(q);
    where += ` AND (
        LOWER(os.cliente_nombre)  LIKE $${n}
     OR LOWER(os.equipo_nombre)   LIKE $${n}
     OR os.cliente_cedula         LIKE $${n}
     OR CAST(os.id AS TEXT)       LIKE $${n}
    )`;
  }

  const { rows } = await pool.query(`
    SELECT
      os.id, os.numero, os.estado,
      os.cliente_nombre, os.cliente_telefono, os.cliente_cedula, os.cliente_id,
      os.equipo_tipo, os.equipo_nombre, os.equipo_serial,
      os.falla_reportada, os.notas_tecnico,
      os.costo_estimado, os.costo_real, os.precio_final, os.total_abonado,
      os.precio_garantia, os.costo_garantia,
      os.motivo_sin_reparar, os.garantia_cobrable, os.orden_origen_id,
      os.fecha_recepcion, os.fecha_entrega, os.sucursal_id, os.factura_id,
      ${COLS_CALCULADAS()},
      u.nombre AS usuario_nombre
      ${_colsTecnico()}
    FROM ordenes_servicio os
    LEFT JOIN usuarios u ON u.id = os.usuario_id
    ${_joinTecnico()}
    WHERE ${where}
    ORDER BY
      CASE os.estado
        WHEN 'Listo'           THEN 0
        WHEN 'Pendiente_pago'  THEN 1
        WHEN 'Garantia'        THEN 2
        WHEN 'En_reparacion'   THEN 3
        WHEN 'Recibido'        THEN 4
        WHEN 'Entregado'       THEN 5
        WHEN 'Sin_reparar'     THEN 6
      END,
      os.fecha_recepcion DESC
  `, params);
  return rows;
};

const findById = async (negocioId, id) => {
  const { rows } = await pool.query(`
    SELECT
      os.*,
      ${COLS_CALCULADAS()},
      u.nombre  AS usuario_nombre,
      su.nombre AS sucursal_nombre
      ${_colsTecnico()}
    FROM ordenes_servicio os
    LEFT JOIN usuarios   u  ON u.id  = os.usuario_id
    LEFT JOIN sucursales su ON su.id = os.sucursal_id
    ${_joinTecnico()}
    WHERE os.id = $1 AND os.negocio_id = $2
  `, [id, negocioId]);
  return rows[0] || null;
};

const getAbonos = async (negocioId, ordenId) => {
  const { rows } = await pool.query(`
    SELECT ab.*, u.nombre AS usuario_nombre
      ${hayServicioAbonosV2() ? ', ua.nombre AS anulado_por_nombre' : ''}
    FROM abonos_servicio ab
    JOIN  ordenes_servicio os ON os.id = ab.orden_id
    LEFT JOIN usuarios     u  ON u.id  = ab.usuario_id
    ${hayServicioAbonosV2() ? 'LEFT JOIN usuarios ua ON ua.id = ab.anulado_por' : ''}
    WHERE ab.orden_id = $1 AND os.negocio_id = $2
    ORDER BY ab.fecha ASC, ab.id ASC
  `, [ordenId, negocioId]);
  return rows;
};

// ─── Resumen del día ──────────────────────────────────────────────────────────

const getResumenHoy = async (sucursalId, negocioId) => {
  const param       = sucursalId ?? negocioId;
  const campoFiltro = sucursalId ? 'sucursal_id' : 'negocio_id';

  const { rows: r1 } = await pool.query(`
    SELECT COUNT(*) AS ordenes_hoy
    FROM ordenes_servicio
    WHERE ${campoFiltro} = $1
      AND ${fechaBogota('fecha_recepcion')} = ${HOY_BOGOTA}
  `, [param]);

  // Lo que entró hoy: abonos menos devoluciones, sin anulados.
  const { rows: r2 } = await pool.query(`
    SELECT COALESCE(SUM(${hayServicioAbonosV2()
    ? "CASE WHEN ab.tipo = 'devolucion' THEN -ab.valor ELSE ab.valor END" : 'ab.valor'}), 0) AS ingresos_hoy
    FROM abonos_servicio ab
    JOIN ordenes_servicio os ON os.id = ab.orden_id
    WHERE os.${campoFiltro} = $1
      AND ${fechaBogota('ab.fecha')} = ${HOY_BOGOTA}
      ${hayServicioAbonosV2() ? 'AND NOT ab.anulado' : ''}
  `, [param]);

  const { rows: r3 } = await pool.query(`
    SELECT COALESCE(SUM(
      COALESCE(precio_final, 0)    - COALESCE(costo_real, 0) +
      COALESCE(precio_garantia, 0) - COALESCE(costo_garantia, 0)
    ), 0) AS utilidad_hoy
    FROM ordenes_servicio
    WHERE ${campoFiltro} = $1
      AND estado IN ('Entregado', 'Sin_reparar')
      AND precio_final IS NOT NULL
      AND costo_real   IS NOT NULL
      AND ${fechaBogota('fecha_entrega')} = ${HOY_BOGOTA}
  `, [param]);

  const { rows: r4 } = await pool.query(`
    SELECT COALESCE(SUM(${SQL_SALDO('os')}), 0) AS pendiente_cobro
    FROM ordenes_servicio os
    WHERE os.${campoFiltro} = $1
      AND os.estado IN ('Listo', 'Pendiente_pago', 'Garantia')
  `, [param]);

  return {
    ordenes_hoy:     r1[0].ordenes_hoy,
    ingresos_hoy:    r2[0].ingresos_hoy,
    utilidad_hoy:    r3[0].utilidad_hoy,
    pendiente_cobro: r4[0].pendiente_cobro,
  };
};

// ─── Escritura ────────────────────────────────────────────────────────────────

/**
 * Crea la orden y, si viene, su abono inicial y su técnico — TODO en una
 * transacción: o quedan la orden y el abono, o ninguno.
 */
const create = async (negocioId, sucursalId, usuarioId, datos) => {
  const {
    cliente_nombre, cliente_telefono, cliente_cedula, cliente_id,
    equipo_tipo, equipo_nombre, equipo_serial,
    falla_reportada, contrasena_equipo, notas_tecnico,
    costo_estimado, checklist_equipo, patron_desbloqueo,
    abono_inicial, tecnico_id,
  } = datos;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`
      INSERT INTO ordenes_servicio (
        negocio_id, sucursal_id, usuario_id,
        cliente_nombre, cliente_telefono, cliente_cedula, cliente_id,
        equipo_tipo, equipo_nombre, equipo_serial,
        falla_reportada, contrasena_equipo, notas_tecnico,
        costo_estimado, checklist_equipo, patron_desbloqueo
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb)
      RETURNING *
    `, [
      negocioId, sucursalId, usuarioId,
      cliente_nombre.trim(),
      cliente_telefono || null,
      cliente_cedula   || null,
      cliente_id       || null,
      equipo_tipo      || null,
      equipo_nombre    || null,
      equipo_serial    || null,
      falla_reportada.trim(),
      contrasena_equipo || null,
      notas_tecnico     || null,
      costo_estimado    || null,
      checklist_equipo  ? JSON.stringify(checklist_equipo)  : null,
      patron_desbloqueo ? JSON.stringify(patron_desbloqueo) : null,
    ]);
    const orden = rows[0];
    orden.numero = await asignarNumeroDocumento(client, {
      tipo: 'orden_servicio', docId: orden.id, negocioId,
    });

    if (tecnico_id !== undefined && tecnico_id !== null && tecnico_id !== '') {
      if (await tecnicosSrv.activos(negocioId, client)) {
        const tId = await tecnicosSrv.validarAsignable(client, negocioId, tecnico_id, sucursalId);
        await client.query('UPDATE ordenes_servicio SET tecnico_id = $2 WHERE id = $1', [orden.id, tId]);
        orden.tecnico_id = tId;
      }
    }

    const valorInicial = Number(abono_inicial?.valor || 0);
    if (valorInicial > 0) {
      if (!hayServicioAbonosV2()) {
        throw { status: 503, message: 'Falta la actualización de la base para recibir abonos antes de terminar la reparación' };
      }
      // El recibo que se imprime enseguida lista el abono: viaja con la orden.
      orden.abonos = [await _insertarMovimiento(client, {
        ordenId: orden.id, usuarioId, valor: valorInicial,
        metodo: abono_inicial.metodo, notas: abono_inicial.notas || 'Abono al recibir el equipo',
        orden: { estado: 'Recibido', ciclo: 0 },
      })];
      const { rows: [act] } = await client.query(
        'UPDATE ordenes_servicio SET total_abonado = $2 WHERE id = $1 RETURNING total_abonado',
        [orden.id, valorInicial]);
      orden.total_abonado = act.total_abonado;
    }

    await client.query('COMMIT');
    return orden;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const marcarEnReparacion = async (negocioId, id, { tecnico_id } = {}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`
      UPDATE ordenes_servicio
      SET estado = 'En_reparacion'
      WHERE id = $1 AND negocio_id = $2 AND estado = 'Recibido'
      RETURNING id, estado, sucursal_id
    `, [id, negocioId]);
    if (rows[0] && tecnico_id !== undefined && tecnico_id !== null && tecnico_id !== ''
        && await tecnicosSrv.activos(negocioId, client)) {
      const tId = await tecnicosSrv.validarAsignable(client, negocioId, tecnico_id, rows[0].sucursal_id);
      await client.query('UPDATE ordenes_servicio SET tecnico_id = $2 WHERE id = $1', [id, tId]);
      rows[0].tecnico_id = tId;
    }
    await client.query('COMMIT');
    return rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/** Asigna o cambia el técnico interno (null lo quita). Sirve en cualquier estado. */
const asignarTecnico = async (negocioId, id, tecnicoId) => {
  if (!(await tecnicosSrv.activos(negocioId))) {
    throw { status: 404, message: 'La lista de técnicos no está encendida en este negocio' };
  }
  const { rows: o } = await pool.query(
    'SELECT sucursal_id FROM ordenes_servicio WHERE id = $1 AND negocio_id = $2', [id, negocioId]);
  if (!o.length) throw { status: 404, message: 'Orden no encontrada' };
  const tId = await tecnicosSrv.validarAsignable(pool, negocioId, tecnicoId, o[0].sucursal_id);
  const { rows } = await pool.query(
    'UPDATE ordenes_servicio SET tecnico_id = $3 WHERE id = $1 AND negocio_id = $2 RETURNING id, tecnico_id',
    [id, negocioId, tId]);
  return rows[0];
};

/**
 * El precio nuevo quedó por debajo de lo abonado en este ciclo: hay que
 * devolver la diferencia. Sin `devolucion` en la petición responde 409 con las
 * cifras, para que la pantalla pregunte cómo se devuelve.
 */
const _devolverExcedente = async (client, o, precioNuevo, devolucion, usuarioId, motivo) => {
  const abonado = Number(o.total_abonado || 0);
  if (!hayServicioAbonosV2() || abonado <= precioNuevo + 0.005) return abonado;
  const diferencia = Math.round((abonado - precioNuevo) * 100) / 100;
  if (!devolucion) {
    throw {
      status: 409, code: 'ABONADO_MAYOR_A_PRECIO',
      message: `El cliente ya abonó ${_cop(abonado)} y el precio queda en ${_cop(precioNuevo)}: hay que devolverle ${_cop(diferencia)}.`,
      detalle: { abonado, precio: precioNuevo, devolver: diferencia },
    };
  }
  await _insertarMovimiento(client, {
    ordenId: o.id, usuarioId, valor: diferencia, metodo: devolucion.metodo || 'Efectivo',
    notas: devolucion.notas || motivo, tipo: 'devolucion', orden: o,
  });
  return precioNuevo;
};

/** Con la lista de técnicos encendida, quién lo reparó es obligatorio al marcar listo. */
const _tecnicoAlTerminar = async (client, negocioId, o, tecnicoPedido) => {
  if (!(await tecnicosSrv.activos(negocioId, client))) return undefined;
  if (tecnicoPedido !== undefined && tecnicoPedido !== null && tecnicoPedido !== '') {
    return tecnicosSrv.validarAsignable(client, negocioId, tecnicoPedido, o.sucursal_id);
  }
  if (o.tecnico_id) return o.tecnico_id;
  // Si lo reparó un técnico EXTERNO, eso ya responde quién fue.
  const { rows } = await client.query(`SELECT ${tecnicosSrv.sqlTecnicoExterno('os')} AS externo
    FROM ordenes_servicio os WHERE os.id = $1`, [o.id]);
  if (rows[0]?.externo) return undefined;
  throw { status: 400, code: 'TECNICO_REQUERIDO', message: 'Indica qué técnico reparó el equipo' };
};

const marcarListo = async (negocioId, id, datos) => {
  const {
    costo_real, precio_final, notas_tecnico, precio_garantia, costo_garantia,
    esGarantia, esGarantiaGratis, devolucion, tecnico_id, usuarioId,
  } = datos;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const condicion = esGarantiaGratis
      ? "estado = 'Garantia' AND garantia_cobrable = false"
      : esGarantia
        ? "estado = 'Garantia' AND garantia_cobrable = true"
        : "estado IN ('Recibido','En_reparacion')";
    const { rows: bloq } = await client.query(`
      SELECT ${_colsOrdenBloqueo()} FROM ordenes_servicio
      WHERE id = $1 AND negocio_id = $2 AND ${condicion}
      FOR UPDATE
    `, [id, negocioId]);
    if (!bloq.length) { await client.query('ROLLBACK'); return null; }
    const o = bloq[0];

    const tecnico = await _tecnicoAlTerminar(client, negocioId, o, tecnico_id);
    const setTecnico = tecnico !== undefined ? ', tecnico_id = $7' : '';

    let query; let params;
    if (esGarantiaGratis) {
      query = `
        UPDATE ordenes_servicio
        SET estado = 'Listo', precio_garantia = 0, costo_garantia = 0,
            notas_tecnico = COALESCE($3, notas_tecnico)
            ${setTecnico.replace('$7', '$4')}
        WHERE id = $1 AND negocio_id = $2
        RETURNING *`;
      params = [id, negocioId, notas_tecnico || null];
      if (tecnico !== undefined) params.push(tecnico);
    } else {
      const precioNuevo = Number(esGarantia ? precio_garantia : precio_final);
      const total = await _devolverExcedente(client, o, precioNuevo, devolucion, usuarioId,
        `Devolución: el precio ${esGarantia ? 'de la garantía' : 'final'} quedó en ${_cop(precioNuevo)}`);
      if (esGarantia) {
        query = `
          UPDATE ordenes_servicio
          SET estado = 'Listo', precio_garantia = $3, costo_garantia = $4,
              notas_tecnico = COALESCE($5, notas_tecnico), total_abonado = $6
              ${setTecnico}
          WHERE id = $1 AND negocio_id = $2
          RETURNING *`;
        params = [id, negocioId, precio_garantia, costo_garantia || null, notas_tecnico || null, total];
      } else {
        query = `
          UPDATE ordenes_servicio
          SET estado = 'Listo', costo_real = $3, precio_final = $4,
              notas_tecnico = COALESCE($5, notas_tecnico), total_abonado = $6
              ${setTecnico}
          WHERE id = $1 AND negocio_id = $2
          RETURNING *`;
        params = [id, negocioId, costo_real || null, precio_final, notas_tecnico || null, total];
      }
      if (tecnico !== undefined) params.push(tecnico);
    }

    const { rows } = await client.query(query, params);
    await client.query('COMMIT');
    return rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const registrarAbono = async (negocioId, ordenId, { valor, metodo, notas, usuarioId, cajaId }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const estados = hayServicioAbonosV2() ? ESTADOS_ABONO_V2 : ESTADOS_ABONO_LEGADO;
    const { rows: orden } = await client.query(`
      SELECT ${_colsOrdenBloqueo()}
      FROM ordenes_servicio
      WHERE id = $1 AND negocio_id = $2
        AND estado = ANY($3::text[])
      FOR UPDATE
    `, [ordenId, negocioId, estados]);
    if (!orden.length) throw { status: 400, message: 'Orden no encontrada o no permite abonos en este estado' };

    const o = orden[0];
    if (enGarantia(o) && !o.garantia_cobrable && o.estado === 'Garantia') {
      throw { status: 400, code: 'GARANTIA_SIN_COSTO', message: 'Esta garantía no tiene costo para el cliente' };
    }
    const totalCobro = precioCiclo(o);

    // ── Contra el abono registrado dos veces ────────────────────────────────
    // El `FOR UPDATE` de arriba ya serializa dos peticiones simultáneas: la
    // segunda espera y lee la orden con el abono de la primera. Lo que faltaba
    // era RECHAZARLA. El tope del saldo vivía solo en la pantalla, así que un
    // reintento tras el corte de 30 s del navegador pasaba entero y la orden
    // quedaba cobrada de más (y la caja con plata que nunca entró). Es la misma
    // lección de préstamos: la regla de la plata va en el backend.
    // Sin precio todavía (recibido, en reparación, garantía sin cotizar) no hay
    // tope: el cliente deja lo que quiera y, si al final sobra, se le devuelve.
    if (totalCobro !== null) {
      const saldo = totalCobro - Number(o.total_abonado || 0);
      if (valor > saldo + 0.005) {
        throw {
          status: 400, code: 'ABONO_MAYOR_A_SALDO',
          message: saldo > 0
            ? `El abono no puede superar el saldo pendiente de ${_cop(saldo)}`
            : 'Esta orden ya está pagada',
        };
      }
    }
    const { rows: gemelo } = await client.query(`
      SELECT id FROM abonos_servicio
      WHERE orden_id = $1 AND valor = $2 AND COALESCE(metodo, '') = COALESCE($3, '')
        AND fecha > NOW() - ($4 || ' seconds')::interval
        ${hayServicioAbonosV2() ? "AND tipo = 'abono' AND NOT anulado" : ''}
      LIMIT 1
    `, [ordenId, valor, metodo || 'Efectivo', String(VENTANA_DUPLICADO_SEG)]);
    if (gemelo.length) {
      throw {
        status: 409, code: 'ABONO_DUPLICADO',
        message: 'Este mismo abono ya se registró hace un momento. Revisa la orden antes de volver a intentarlo.',
      };
    }

    await _insertarMovimiento(client, { ordenId, usuarioId, valor, metodo, notas, orden: o });

    const nuevoAbonado = Number(o.total_abonado) + valor;

    const nuevoEstado = (o.estado === 'Pendiente_pago' && totalCobro !== null && nuevoAbonado >= totalCobro)
      ? 'Entregado'
      : o.estado;

    const fechaEntrega = nuevoEstado === 'Entregado' ? 'now()' : 'fecha_entrega';

    const { rows: actualizada } = await client.query(`
      UPDATE ordenes_servicio
      SET total_abonado = $1,
          estado        = $2,
          fecha_entrega = ${fechaEntrega}
      WHERE id = $3
      RETURNING total_abonado, precio_final, precio_garantia, estado, fecha_entrega, sucursal_id
    `, [nuevoAbonado, nuevoEstado, ordenId]);

    if (nuevoEstado === 'Entregado' && !o.factura_id) {
      await _crearFacturaPorServicio(client, o, totalCobro);
    }

    if (cajaId) {
      await client.query(`
        INSERT INTO movimientos_caja
          (caja_id, usuario_id, tipo, concepto, valor, referencia_id, referencia_tipo)
        VALUES ($1, $2, 'Ingreso', $3, $4, $5, 'servicio')
      `, [cajaId, usuarioId || null, `Servicio técnico ${_numOS(o, ordenId)}`, valor, ordenId]);
    }

    await client.query('COMMIT');
    const estimado = Number(o.costo_estimado || 0);
    return {
      ...actualizada[0],
      // Informativo para la pantalla: sin precio todavía, ¿ya pasó el estimado?
      supera_estimado: totalCobro === null && estimado > 0 && nuevoAbonado > estimado,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Anula un abono mal hecho (solo admin, con motivo). No se borra: queda tachado.
 * Solo abonos —no devoluciones— del ciclo VIGENTE de una orden abierta: con la
 * orden entregada ya hay factura, y un abono de antes de la garantía ya no
 * cuenta en lo abonado.
 */
const anularAbono = async (negocioId, ordenId, abonoId, { motivo, usuarioId }) => {
  if (!hayServicioAbonosV2()) throw { status: 503, message: 'Falta la actualización de la base para anular abonos' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: ord } = await client.query(`
      SELECT ${_colsOrdenBloqueo()} FROM ordenes_servicio
      WHERE id = $1 AND negocio_id = $2 FOR UPDATE
    `, [ordenId, negocioId]);
    if (!ord.length) throw { status: 404, message: 'Orden no encontrada' };
    const o = ord[0];
    if (!ESTADOS_ABIERTOS.includes(o.estado)) {
      throw { status: 409, code: 'ORDEN_CERRADA', message: 'La orden ya se cerró: sus abonos no se pueden anular desde aquí' };
    }
    const { rows: ab } = await client.query(`
      SELECT * FROM abonos_servicio WHERE id = $1 AND orden_id = $2 FOR UPDATE
    `, [abonoId, ordenId]);
    if (!ab.length) throw { status: 404, message: 'Abono no encontrado' };
    const a = ab[0];
    if (a.anulado) throw { status: 409, code: 'YA_ANULADO', message: 'Ese abono ya está anulado' };
    if (a.tipo !== 'abono') throw { status: 409, message: 'Una devolución no se anula' };
    if (a.ciclo === null || Number(a.ciclo) !== Number(o.ciclo)) {
      throw { status: 409, code: 'ABONO_OTRO_CICLO', message: 'Ese abono es de antes y ya no cuenta en lo abonado de la orden' };
    }
    await client.query(`
      UPDATE abonos_servicio SET anulado = TRUE, anulado_motivo = $2, anulado_por = $3, anulado_en = NOW()
      WHERE id = $1
    `, [abonoId, motivo, usuarioId || null]);
    const { rows: act } = await client.query(`
      UPDATE ordenes_servicio SET total_abonado = GREATEST(total_abonado - $2, 0)
      WHERE id = $1 RETURNING id, total_abonado, estado, sucursal_id
    `, [ordenId, Number(a.valor)]);
    await client.query('COMMIT');
    return { orden: act[0], abono: { ...a, anulado: true, anulado_motivo: motivo } };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const marcarEntregado = async (negocioId, id) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`
      SELECT ${_colsOrdenBloqueo()}
      FROM ordenes_servicio
      WHERE id = $1 AND negocio_id = $2
        AND estado IN ('Listo','Garantia')
      FOR UPDATE
    `, [id, negocioId]);
    if (!rows.length) throw { status: 400, message: 'Orden no disponible para entrega' };

    const o = rows[0];
    const totalCobro = precioCiclo(o);
    if (totalCobro === null) {
      throw { status: 400, code: 'SIN_PRECIO', message: 'Primero marca la orden como lista con su precio' };
    }

    const saldo = totalCobro - Number(o.total_abonado);

    const nuevoEstado = saldo <= 0 ? 'Entregado' : 'Pendiente_pago';

    const { rows: updated } = await client.query(`
      UPDATE ordenes_servicio
      SET estado        = $2,
          fecha_entrega = now()
      WHERE id = $1
      RETURNING *
    `, [id, nuevoEstado]);

    // Una garantía gratis no factura nada: sería una factura de $0.
    if (nuevoEstado === 'Entregado' && !o.factura_id && totalCobro > 0) {
      await _crearFacturaPorServicio(client, o, totalCobro);
    }

    await client.query('COMMIT');
    return { ...updated[0], saldo_al_entregar: saldo > 0 ? saldo : 0 };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Cierra sin reparar. Con la migración: el diagnóstico se cobra CONTRA lo ya
 * abonado — si el cliente abonó más, se le devuelve el resto; si menos, se le
 * cobra la diferencia con el método elegido. Antes se sobrescribía lo abonado
 * con el diagnóstico (un anticipo desaparecía de la orden aunque la plata
 * siguiera en la caja) y el diagnóstico se registraba siempre en Efectivo.
 */
const marcarSinReparar = async (negocioId, id, { motivo, precio_diagnostico, usuarioId, metodo, metodo_devolucion }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`
      SELECT ${_colsOrdenBloqueo()} FROM ordenes_servicio
      WHERE id = $1 AND negocio_id = $2
        AND estado NOT IN ('Entregado','Sin_reparar','Pendiente_pago')
      FOR UPDATE
    `, [id, negocioId]);
    if (!rows.length) throw { status: 400, message: 'Orden no disponible para esta operación' };
    const o = rows[0];

    const pd = precio_diagnostico ? Number(precio_diagnostico) : null;
    const diag = pd || 0;

    if (hayServicioAbonosV2()) {
      // En una garantía gratis lo abonado es de la reparación original: no se
      // devuelve ni se descuenta del diagnóstico.
      const abonado = enGarantia(o) && !o.garantia_cobrable ? 0 : Number(o.total_abonado || 0);
      if (abonado > diag + 0.005) {
        await _insertarMovimiento(client, {
          ordenId: id, usuarioId, valor: Math.round((abonado - diag) * 100) / 100,
          metodo: metodo_devolucion || metodo || 'Efectivo', tipo: 'devolucion', orden: o,
          notas: `Devolución — sin reparar (${motivo || 'sin motivo'})${diag ? `, diagnóstico ${_cop(diag)}` : ''}`,
        });
      } else if (diag > abonado + 0.005) {
        await _insertarMovimiento(client, {
          ordenId: id, usuarioId, valor: Math.round((diag - abonado) * 100) / 100,
          metodo: metodo || 'Efectivo', orden: o,
          notas: `Diagnóstico — ${motivo || 'sin reparar'}`,
        });
      }
    } else if (pd && pd > 0) {
      // El cobro de diagnóstico es un ingreso real de servicio. Se registra como
      // abono de servicio para que la caja lo refleje (grupo "Servicio técnico",
      // leído desde abonos_servicio) igual que cualquier otro abono.
      await client.query(`
        INSERT INTO abonos_servicio(orden_id, usuario_id, valor, metodo, notas)
        VALUES ($1, $2, $3, 'Efectivo', $4)
      `, [id, usuarioId || null, pd, `Diagnóstico — ${motivo || 'sin reparar'}`]);
    }

    const { rows: updated } = await client.query(`
      UPDATE ordenes_servicio
      SET estado             = 'Sin_reparar',
          motivo_sin_reparar = $3,
          precio_final       = $4::numeric,
          total_abonado      = COALESCE($4::numeric, 0),
          fecha_entrega      = now()
      WHERE id = $1 AND negocio_id = $2::integer
      RETURNING *
    `, [id, negocioId, motivo || null, pd]);

    await client.query('COMMIT');
    return updated[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const abrirGarantia = async (negocioId, id, { cobrable, notas_tecnico }) => {
  const { rows } = await pool.query(`
    UPDATE ordenes_servicio
    SET estado            = 'Garantia',
        garantia_cobrable = $3,
        precio_garantia   = NULL,
        costo_garantia    = NULL,
        total_abonado     = CASE WHEN $3 THEN 0 ELSE total_abonado END,
        fecha_entrega     = NULL,
        notas_tecnico     = COALESCE($4, notas_tecnico)
        ${hayServicioAbonosV2() ? ', ciclo = ciclo + 1' : ''}
    WHERE id = $1 AND negocio_id = $2
      AND estado IN ('Entregado','Pendiente_pago')
    RETURNING *
  `, [id, negocioId, cobrable, notas_tecnico || null]);
  return rows[0] || null;
};

const actualizarNotas = async (negocioId, id, notas_tecnico) => {
  const { rows } = await pool.query(`
    UPDATE ordenes_servicio
    SET notas_tecnico = $3
    WHERE id = $1 AND negocio_id = $2
    RETURNING id, notas_tecnico
  `, [id, negocioId, notas_tecnico]);
  return rows[0] || null;
};

module.exports = {
  findAll, findById, getAbonos, getResumenHoy,
  create, marcarEnReparacion, marcarListo, asignarTecnico,
  registrarAbono, anularAbono, marcarEntregado, marcarSinReparar,
  abrirGarantia, actualizarNotas,
  // Reglas compartidas con reportes (una sola definición del precio del ciclo).
  SQL_EN_GARANTIA, SQL_PRECIO_CICLO, SQL_SALDO, enGarantia, precioCiclo, pagosNetos,
};
