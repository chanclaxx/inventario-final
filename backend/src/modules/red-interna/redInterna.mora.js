const { pool } = require('../../config/db');
const { hayMoraEnvios } = require('../../config/columnas');
const {
  leerConfigMora, resolverEstadoMora, normalizarCondicion, describirCondicion, hoyBogota,
} = require('../../utils/mora.util');
const { sumarDias, diasEntre, aFecha } = require('../../utils/devengo.util');

// ─────────────────────────────────────────────────────────────────────────────
// MORA DE LOS ENVÍOS — el envío gana plazo, igual que un crédito de un cliente
//
// Desde agosto de 2026 cada envío es un documento de deuda: el local paga todo
// lo que recibe, envío por envío. Le faltaba lo que tiene cualquier crédito: un
// PLAZO. Sin él, un envío de hace seis meses y uno de ayer se veían iguales.
//
// ── Qué se reusa y qué es propio ────────────────────────────────────────────
// El CÁLCULO es el de créditos y préstamos, sin una línea nueva: `mora.util`
// (condiciones, días de gracia, tope, solo aviso) sobre `devengo.util` (tramos
// de saldo constante entre abonos). Lo único propio de la red es:
//   · el ANCLA: la fecha límite nace al RECIBIR el envío (fecha de recepción +
//     el plazo que la bodega pactó al despachar), porque ahí nace la deuda;
//   · la CONFIGURACIÓN: claves `red_interna_mora_*`, separadas de las de
//     clientes — lo que se le cobra a un cliente no es lo que la bodega le
//     cobra a su propio local, y encender una no puede encender la otra;
//   · el REGISTRO: `mora_envios`, con las mismas reglas de vigencia que
//     `abonos_remision` (una remesa en tránsito reserva pero no cuenta).
//
// ── Reglas, en orden de importancia ─────────────────────────────────────────
//   1. La mora NUNCA entra en `abonos_remision`. Los reportes suman esos
//      abonos como lo cobrado del envío para medir la utilidad de la bodega
//      (cobrado − costo): la mora ahí sería margen comercial inventado.
//   2. `fecha_limite IS NULL` ⇒ el envío no tiene mora. Jamás. Todo lo que ya
//      existe queda así, y un negocio sin `red_interna_mora_activa` no escribe
//      una sola fila.
//   3. Lo PENDIENTE se deriva (causada − cobrada − condonada). Solo se escribe
//      lo que decide una persona: la parte de un pago que fue a mora, o lo que
//      la bodega perdonó.
//   4. La deuda de CAPITAL (`deuda_total`, `saldo_por_liquidar`) no cambia de
//      significado: la mora se suma aparte (`mora_pendiente`) y juntas dan
//      `total_a_pagar`. La identidad Σ saldo de documentos = deuda_total sigue
//      intacta — la mora es otra cubeta, como en créditos.
// ─────────────────────────────────────────────────────────────────────────────

const _num = (v) => Number(v || 0);

/** ¿La migración está instalada? Todo lo de este archivo depende de eso. */
const disponible = () => hayMoraEnvios();

// ── Configuración ────────────────────────────────────────────────────────────

/**
 * Config de mora de la red a partir del mapa de `config_negocio`.
 *
 * Reusa `leerConfigMora` (la de créditos) traduciendo las claves: así la
 * validación, el default y la regla "encendida sin condiciones = apagada" son
 * exactamente las mismas en los dos mundos.
 */
const leerConfigMoraRed = (map = {}) => {
  const base = leerConfigMora({
    mora_activa:             map.red_interna_mora_activa,
    mora_lista:              map.red_interna_mora_lista,
    mora_default_id:         map.red_interna_mora_default_id,
    mora_plazo_default_dias: map.red_interna_mora_plazo_default_dias,
    mora_tope_tasa_mensual:  map.red_interna_mora_tope_tasa_mensual,
  });
  const aviso = Number(map.red_interna_mora_aviso_previo_dias);
  const instalada = hayMoraEnvios();
  return {
    ...base,
    // Sin la migración no hay dónde pactar el plazo: apagada aunque la clave
    // diga '1'. Es la misma regla que la ubicación con su columna.
    activa:    base.activa && instalada,
    instalada,
    aviso_previo_dias: Number.isInteger(aviso) && aviso >= 1 && aviso <= 30 ? aviso : 3,
  };
};

/**
 * Qué plazo lleva un envío que se está DESPACHANDO.
 *
 *   `entrada` ausente (undefined) → decide el negocio: si tiene condición y
 *     plazo por defecto, el envío sale con ellos. Es lo que hace que un
 *     despacho desde el carrito o el escáner no se salte la política.
 *   `null`, `false` o plazo 0 → sin plazo, a propósito.
 *   `{ plazo_dias, condicion_id }` → lo que eligió la bodega.
 *
 * Devuelve `{ plazo_dias, condicion }` listo para guardar, o null.
 */
const plazoParaDespacho = (configMora, entrada) => {
  if (!configMora?.activa) {
    // Pedir un plazo explícito con la feature apagada es un error de quien
    // llama; no mandarlo es el caso normal y no molesta a nadie.
    if (entrada && typeof entrada === 'object' && Number(entrada.plazo_dias) > 0) {
      throw { status: 400, message: 'El plazo de pago de los envíos no está activado en Ajustes → Red interna' };
    }
    return null;
  }

  if (entrada === undefined) {
    const cond = configMora.condiciones.find((c) => c.id === configMora.default_id);
    if (!cond || !configMora.plazo_default) return null;
    return { plazo_dias: configMora.plazo_default, condicion: normalizarCondicion(cond) };
  }
  if (!entrada || typeof entrada !== 'object') return null;

  const dias = Number(entrada.plazo_dias);
  if (!dias) return null;
  if (!Number.isInteger(dias) || dias < 1 || dias > 365) {
    throw { status: 400, message: 'El plazo del envío debe ser un número entero de días entre 1 y 365' };
  }
  const cond = _condicion(configMora, entrada.condicion_id);
  if (!cond) throw { status: 400, message: 'Elige la condición de mora del envío' };
  return { plazo_dias: dias, condicion: cond };
};

const _condicion = (configMora, condicionId) => {
  const elegida = condicionId
    ? configMora.condiciones.find((c) => c.id === condicionId)
    : configMora.condiciones.find((c) => c.id === configMora.default_id);
  return normalizarCondicion(elegida || null);
};

/**
 * La fecha límite de un envío que se está RECIBIENDO: hoy (Bogotá) + el plazo
 * pactado. Null si el envío salió sin plazo.
 */
const fechaLimiteAlRecibir = (remision) => {
  if (!disponible()) return null;
  const dias = Number(remision?.mora_plazo_dias);
  if (!dias || !remision?.mora_condicion) return null;
  return sumarDias(hoyBogota(), dias);
};

// ── Lectura: el estado de mora de cada envío ────────────────────────────────

/**
 * Carga lo que hace falta para calcular la mora de los envíos con plazo de un
 * local (o de todos los locales con `sucursalId = null`).
 *
 * Tres consultas en lote, nunca una por envío. Cuando nadie tiene plazo, la
 * primera vuelve vacía (índice parcial) y las otras dos no se hacen.
 *
 * `ejecutor` permite leer DENTRO de la transacción de un pago: el reparto
 * tiene que hacerse sobre lo que ya reservaron otros pagos en esa misma
 * transacción, no sobre una lectura de antes del bloqueo.
 *
 * @returns {Map<number, object>} remision_id → estado de mora
 */
const cargarEstados = async (ejecutor, negocioId, sucursalId = null, { remisionIds = null, hoy = null } = {}) => {
  const mapa = new Map();
  if (!disponible()) return mapa;
  const repo = require('./redInterna.repository');
  const db = ejecutor || pool;

  const { rows: envios } = await db.query(`
    WITH env AS (${repo.SQL_ENVIOS_CUENTA}),
         res AS (${repo.SQL_ENVIOS_RESERVA})
    SELECT r.id AS remision_id, r.numero, r.sucursal_destino_id AS sucursal_id,
           r.fecha_limite, r.mora_condicion, r.mora_plazo_dias,
           r.fecha_recepcion, r.estado,
           env.cargo, env.abonado, env.saldo, res.saldo AS saldo_reserva
    FROM remisiones r
    JOIN env ON env.remision_id = r.id
    JOIN res ON res.remision_id = r.id
    WHERE r.negocio_id = $1
      AND ($2::int IS NULL OR r.sucursal_destino_id = $2)
      AND r.fecha_limite IS NOT NULL AND r.mora_condicion IS NOT NULL
      AND r.estado IN ('Recibida', 'Parcial')
      AND ($3::bigint[] IS NULL OR r.id = ANY($3::bigint[]))
  `, [negocioId, sucursalId, remisionIds && remisionIds.length ? remisionIds : null]);
  if (!envios.length) return mapa;

  const ids = envios.map((e) => Number(e.remision_id));
  // Secuenciales: dentro de una transacción el client atiende una a la vez.
  const { rows: abonos } = await db.query(`
    SELECT a.remision_id, a.fecha, a.valor
    FROM (${repo.SQL_ABONOS_EFECTIVOS}) a
    WHERE a.remision_id = ANY($1::bigint[])
    ORDER BY a.fecha, a.id
  `, [ids]);
  const { rows: movs } = await db.query(`
    SELECT me.id, me.remision_id, me.tipo, me.origen, me.valor, me.fecha,
           me.remesa_id, me.movimiento_id, me.dias_mora, me.motivo,
           rm.numero AS remesa_numero, rm.estado AS remesa_estado,
           u.nombre  AS usuario_nombre,
           ((me.origen IS DISTINCT FROM 'remesa' OR rm.estado = 'Recibida')
             AND (me.movimiento_id IS NULL OR (mc.estado = 'Aprobado' AND NOT mc.anulado)))  AS efectivo,
           ((me.origen IS DISTINCT FROM 'remesa' OR rm.estado <> 'Anulada')
             AND (me.movimiento_id IS NULL OR (mc.estado <> 'Rechazado' AND NOT mc.anulado))) AS reservado
    FROM mora_envios me
    LEFT JOIN remesas rm                    ON rm.id = me.remesa_id
    LEFT JOIN movimientos_cuenta_interna mc ON mc.id = me.movimiento_id
    LEFT JOIN usuarios u                    ON u.id  = me.usuario_id
    WHERE me.remision_id = ANY($1::bigint[]) AND NOT me.anulado
    ORDER BY me.fecha, me.id
  `, [ids]);

  const agrupar = (filas) => {
    const m = new Map();
    for (const f of filas) {
      const k = Number(f.remision_id);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(f);
    }
    return m;
  };
  const abonosPor = agrupar(abonos);
  const movsPor   = agrupar(movs);

  for (const e of envios) {
    const k = Number(e.remision_id);
    mapa.set(k, _resolver(e, abonosPor.get(k) || [], movsPor.get(k) || [], hoy));
  }
  return mapa;
};

/**
 * El estado de mora de UN envío, a partir de sus filas.
 *
 * Es `resolverEstadoMora` de créditos con dos agregados de la red:
 *   · `pendiente_reserva` — lo que falta por cubrir contando también los pagos
 *     que van en camino. Es la cifra con la que se REPARTE un pago nuevo: sin
 *     ella, dos remesas seguidas sin confirmar pagarían dos veces la misma mora
 *     (la misma trampa que SQL_ABONOS_RESERVADOS evita con el capital).
 *   · `en_mora` — vencido Y con algo que deber. Un envío pagado a tiempo
 *     tiene la fecha pasada, pero no está en mora de nada.
 */
const _resolver = (e, abonos, movs, hoy) => {
  const saldo = Math.max(0, _num(e.cargo) - _num(e.abonado));
  const efectivos = movs.filter((m) => m.efectivo);
  const est = resolverEstadoMora({
    saldo,
    fecha_limite: e.fecha_limite,
    condicion:    e.mora_condicion,
    movimientos:  efectivos.map((m) => ({ tipo: m.tipo, valor: m.valor, anulado: false })),
    // La fecha de cada abono es la del PAGO, no la de la confirmación de la
    // bodega: la demora en confirmar es de la bodega, y cobrarle al local esos
    // días de mora sería cobrarle un atraso que no es suyo.
    abonos: abonos.map((a) => ({ fecha: a.fecha, valor: a.valor })),
    ...(hoy ? { hoy } : {}),
  });

  const reservado = movs.filter((m) => m.reservado).reduce((s, m) => s + _num(m.valor), 0);
  const enCamino  = movs.filter((m) => m.reservado && !m.efectivo && m.tipo === 'Cobro')
    .reduce((s, m) => s + _num(m.valor), 0);
  const hoyIso = aFecha(hoy) || hoyBogota();
  const diasParaVencer = est.fecha_limite ? diasEntre(hoyIso, est.fecha_limite) : null;

  return {
    ...est,
    remision_id:  Number(e.remision_id),
    numero:       e.numero,
    sucursal_id:  Number(e.sucursal_id),
    plazo_dias:   e.mora_plazo_dias != null ? Number(e.mora_plazo_dias) : null,
    fecha_recepcion: e.fecha_recepcion,
    saldo_reserva:   Math.max(0, _num(e.saldo_reserva)),
    pendiente_reserva: Math.max(0, est.causada - Math.round(reservado)),
    en_camino:    Math.round(enCamino),
    en_mora:      est.vencido && (est.saldo_capital > 0 || est.pendiente > 0),
    // Todavía no vence y queda capital: cuántos días le faltan. Null si ya
    // venció o no debe nada — no hay nada que recordarle.
    dias_para_vencer: !est.vencido && est.saldo_capital > 0 ? diasParaVencer : null,
    movimientos: movs.map((m) => ({
      id: Number(m.id), tipo: m.tipo, origen: m.origen, valor: _num(m.valor), fecha: m.fecha,
      remesa_id: m.remesa_id, remesa_numero: m.remesa_numero, remesa_estado: m.remesa_estado,
      movimiento_id: m.movimiento_id, dias_mora: m.dias_mora, motivo: m.motivo,
      usuario_nombre: m.usuario_nombre, efectivo: !!m.efectivo,
    })),
  };
};

/**
 * Los totales de mora de un conjunto de envíos (un local, o toda la red).
 * Nunca lanza y siempre devuelve la misma forma: un negocio sin la feature ve
 * ceros, no claves ausentes.
 */
const resumir = (mapa, { avisoPrevio = 3 } = {}) => {
  let pendiente = 0, causada = 0, cobrada = 0, condonada = 0, enCamino = 0;
  let vencidos = 0, diasMax = 0, porVencer = 0, conPlazo = 0, soloMora = 0;
  let proximo = null;
  let capitalVencido = 0;
  for (const m of mapa.values()) {
    conPlazo++;
    pendiente += m.pendiente;
    causada   += m.causada;
    cobrada   += m.cobrada;
    condonada += m.condonada;
    enCamino  += m.en_camino;
    // El producto ya está cubierto y queda la mora: el envío sigue abierto.
    if (m.saldo_capital <= 0 && m.pendiente > 0) soloMora++;
    if (m.en_mora) {
      vencidos++;
      capitalVencido += m.saldo_capital;
      diasMax = Math.max(diasMax, m.dias_vencidos);
    }
    if (m.dias_para_vencer != null) {
      if (m.dias_para_vencer <= avisoPrevio) porVencer++;
      if (!proximo || m.fecha_limite < proximo) proximo = m.fecha_limite;
    }
  }
  return {
    mora_pendiente:   Math.round(pendiente),
    mora_causada:     Math.round(causada),
    mora_cobrada:     Math.round(cobrada),
    mora_condonada:   Math.round(condonada),
    mora_en_camino:   Math.round(enCamino),
    envios_con_plazo: conPlazo,
    envios_vencidos:  vencidos,
    capital_vencido:  Math.round(capitalVencido),
    dias_max_vencido: diasMax,
    envios_por_vencer: porVencer,
    envios_solo_mora: soloMora,
    proximo_vencimiento: proximo,
  };
};

/** El estado que se le pega a un envío que NO tiene plazo: todo en cero. */
const SIN_PLAZO = Object.freeze({
  aplica: false, fecha_limite: null, condicion: null, descripcion: '',
  dias_vencidos: 0, dias_cobrables: 0, causada: 0, cobrada: 0, condonada: 0,
  pendiente: 0, pendiente_reserva: 0, en_camino: 0, vencido: false, en_mora: false,
  solo_aviso: false, dias_para_vencer: null, plazo_dias: null, movimientos: [],
});

/**
 * La mora de un envío para PINTAR: el estado completo si tiene plazo, o el de
 * "sin plazo" (con el plazo pactado si todavía va en camino, para que el local
 * sepa antes de recibirlo cuánto tiempo va a tener).
 */
const moraDeEnvio = (mapa, envio) => {
  const m = mapa.get(Number(envio.id ?? envio.remision_id));
  if (m) {
    // Lo interno del cálculo no viaja a la pantalla.
    const { saldo_reserva, pendiente_reserva, ...visible } = m;
    return visible;
  }
  const condicion = envio.mora_condicion ? normalizarCondicion(envio.mora_condicion) : null;
  return {
    ...SIN_PLAZO,
    plazo_dias:  envio.mora_plazo_dias != null ? Number(envio.mora_plazo_dias) : null,
    condicion,
    descripcion: condicion ? describirCondicion(condicion) : '',
  };
};

/**
 * Los cobros de mora de un LOCAL, para que la pestaña de pagos diga qué parte
 * de cada pago fue a mora (sin esto, un pago de $1.010.000 que cubrió
 * $1.000.000 de un envío parecería perder $10.000).
 */
const cobrosDeLocal = async (negocioId, sucursalId) => {
  if (!disponible()) return [];
  const { rows } = await pool.query(`
    SELECT me.id, me.remision_id, r.numero AS remision_numero, me.origen,
           me.remesa_id, me.movimiento_id, me.valor, me.fecha
    FROM mora_envios me JOIN remisiones r ON r.id = me.remision_id
    WHERE me.negocio_id = $1 AND me.sucursal_id = $2
      AND me.tipo = 'Cobro' AND NOT me.anulado
    ORDER BY me.fecha DESC
    LIMIT 300
  `, [negocioId, sucursalId]);
  return rows.map((m) => ({ ...m, id: Number(m.id), valor: _num(m.valor) }));
};

/**
 * Los cobros y condonaciones de UN envío, tenga o no plazo hoy. Un envío al que
 * le quitaron el plazo deja de causar, pero lo que se cobró sigue siendo parte
 * de su historia y la pantalla lo tiene que poder contar.
 */
const movimientosDeEnvio = async (negocioId, remisionId) => {
  if (!disponible()) return [];
  const { rows } = await pool.query(`
    SELECT me.id, me.tipo, me.origen, me.valor, me.fecha, me.remesa_id, me.movimiento_id,
           me.dias_mora, me.motivo,
           rm.numero AS remesa_numero, rm.estado AS remesa_estado,
           u.nombre  AS usuario_nombre,
           ((me.origen IS DISTINCT FROM 'remesa' OR rm.estado = 'Recibida')
             AND (me.movimiento_id IS NULL OR (mc.estado = 'Aprobado' AND NOT mc.anulado))) AS efectivo
    FROM mora_envios me
    LEFT JOIN remesas rm                    ON rm.id = me.remesa_id
    LEFT JOIN movimientos_cuenta_interna mc ON mc.id = me.movimiento_id
    LEFT JOIN usuarios u                    ON u.id  = me.usuario_id
    WHERE me.negocio_id = $1 AND me.remision_id = $2 AND NOT me.anulado
    ORDER BY me.fecha, me.id
  `, [negocioId, remisionId]);
  return rows.map((m) => ({ ...m, id: Number(m.id), valor: _num(m.valor), efectivo: !!m.efectivo }));
};

// ── Escritura ────────────────────────────────────────────────────────────────

/** Un cobro de mora, dentro de la transacción del pago que lo trae. */
const insertarCobro = async (client, {
  negocio_id, sucursal_id, remision_id, origen, remesa_id = null, movimiento_id = null,
  valor, dias_mora = null, saldo_base = null, condicion = null, usuario_id = null,
}) => {
  const { rows } = await client.query(`
    INSERT INTO mora_envios
      (negocio_id, sucursal_id, remision_id, tipo, origen, remesa_id, movimiento_id,
       valor, dias_mora, saldo_base, condicion, usuario_id)
    VALUES ($1,$2,$3,'Cobro',$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
    RETURNING *
  `, [negocio_id, sucursal_id, remision_id, origen, remesa_id, movimiento_id,
      valor, dias_mora, saldo_base, condicion ? JSON.stringify(condicion) : null, usuario_id]);
  return rows[0];
};

/**
 * Al anular una remesa, su mora se cae con ella — igual que sus abonos a
 * capital. Sin esto la mora quedaría "pagada" con una plata que se devolvió.
 */
const anularPorRemesa = async (client, remesaId) => {
  if (!disponible()) return 0;
  const { rowCount } = await client.query(
    `UPDATE mora_envios SET anulado = TRUE WHERE remesa_id = $1 AND NOT anulado`, [remesaId]
  );
  return rowCount;
};

/** Lo mismo al anular o rechazar un gasto o un ajuste. */
const anularPorMovimiento = async (client, movimientoId) => {
  if (!disponible()) return 0;
  const { rowCount } = await client.query(
    `UPDATE mora_envios SET anulado = TRUE WHERE movimiento_id = $1 AND NOT anulado`, [movimientoId]
  );
  return rowCount;
};

const _exigirInstalada = () => {
  if (!disponible()) {
    throw { status: 503, message: 'La mora de los envíos no está instalada en la base de datos' };
  }
};

const _cargarEnvio = async (client, negocioId, remisionId) => {
  const { rows } = await client.query(`
    SELECT r.*, sd.nombre AS sucursal_destino_nombre
    FROM remisiones r JOIN sucursales sd ON sd.id = r.sucursal_destino_id
    WHERE r.id = $1 AND r.negocio_id = $2
    FOR UPDATE OF r
  `, [remisionId, negocioId]);
  const r = rows[0];
  if (!r) throw { status: 404, message: 'Envío no encontrado' };
  if (r.tipo !== 'entrega') throw { status: 400, message: 'Solo los envíos de la bodega tienen plazo de pago' };
  if (r.estado === 'Anulada') throw { status: 409, message: 'Ese envío está anulado' };
  return r;
};

/**
 * CONDONAR la mora de un envío — total o parcial.
 *
 * Mismas llaves que la condonación de un crédito: solo el administrador, con
 * motivo y PIN. Además tiene que hacerlo DESDE la bodega: es la bodega la que
 * renuncia a cobrar, y un admin mirando desde un local no está en su papel.
 *
 * `quitar_plazo` apaga la mora hacia adelante: condonar no la detiene (el envío
 * sigue vencido y mañana vuelve a causarse).
 */
const condonar = async (req, remisionId, { valor, motivo, pin, quitar_plazo = false }) => {
  _exigirInstalada();
  if (!req.esBodega) throw { status: 403, message: 'La mora se condona desde la bodega' };
  if (req.user?.rol !== 'admin_negocio') {
    throw { status: 403, message: 'Solo el administrador del negocio puede condonar la mora' };
  }
  const motivoLimpio = String(motivo || '').trim();
  if (motivoLimpio.length < 3) {
    throw { status: 400, message: 'Escribe el motivo de la condonación (queda registrado)' };
  }
  const configService = require('../config/config.service');
  if (!(await configService.verificarPin(req.user.negocio_id, pin))) {
    throw { status: 403, message: 'PIN incorrecto' };
  }

  const negocioId = req.user.negocio_id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const envio = await _cargarEnvio(client, negocioId, remisionId);
    const estado = (await cargarEstados(client, negocioId, Number(envio.sucursal_destino_id), {
      remisionIds: [Number(remisionId)],
    })).get(Number(remisionId));
    if (!estado?.aplica) throw { status: 400, message: 'Este envío no tiene plazo ni mora pactada' };

    // Contra lo RESERVADO: si ya va un pago en camino que cubre la mora, no se
    // puede perdonar la misma plata que el local ya mandó.
    const disponibleCondonar = estado.pendiente_reserva;
    if (disponibleCondonar <= 0) {
      throw {
        status: 400,
        message: estado.en_camino > 0
          ? 'La mora de este envío ya la cubre un pago que va en camino'
          : 'Este envío no tiene mora pendiente',
      };
    }
    const aCondonar = valor == null || valor === '' ? disponibleCondonar : Math.round(Number(valor));
    if (!(aCondonar > 0)) throw { status: 400, message: 'El valor a condonar debe ser mayor a 0' };
    if (aCondonar > disponibleCondonar) {
      throw {
        status: 400,
        message: `No puedes condonar más de la mora pendiente ($${disponibleCondonar.toLocaleString('es-CO')})`,
      };
    }

    const { rows } = await client.query(`
      INSERT INTO mora_envios
        (negocio_id, sucursal_id, remision_id, tipo, valor, dias_mora, saldo_base,
         condicion, motivo, usuario_id)
      VALUES ($1,$2,$3,'Condonacion',$4,$5,$6,$7::jsonb,$8,$9)
      RETURNING *
    `, [negocioId, envio.sucursal_destino_id, remisionId, aCondonar, estado.dias_vencidos,
        estado.saldo_capital, JSON.stringify(estado.condicion), motivoLimpio, req.user.id]);

    if (quitar_plazo) {
      await client.query(
        `UPDATE remisiones SET fecha_limite = NULL, mora_condicion = NULL, mora_plazo_dias = NULL WHERE id = $1`,
        [remisionId]
      );
    }
    await client.query('COMMIT');

    require('./redInterna.avisos').avisar({
      negocioId, sucursalId: Number(envio.sucursal_destino_id),
      titulo: `La bodega te condonó mora del envío #${envio.numero ?? remisionId}`,
      cuerpo: `$${aCondonar.toLocaleString('es-CO')}${quitar_plazo ? ' · y le quitó el plazo' : ''}`,
    });
    return { movimiento: rows[0], condonado: aCondonar, plazo_quitado: !!quitar_plazo, envio };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Deshacer una condonación. Solo condonaciones: un COBRO se deshace anulando
 * el pago del que salió (la remesa o el gasto), que es donde está la plata.
 */
const anularCondonacion = async (req, movimientoId) => {
  _exigirInstalada();
  if (!req.esBodega || req.user?.rol !== 'admin_negocio') {
    throw { status: 403, message: 'Solo el administrador, desde la bodega, puede anular una condonación' };
  }
  const { rows } = await pool.query(
    `SELECT * FROM mora_envios WHERE id = $1 AND negocio_id = $2`,
    [movimientoId, req.user.negocio_id]
  );
  const mov = rows[0];
  if (!mov) throw { status: 404, message: 'Movimiento de mora no encontrado' };
  if (mov.anulado) throw { status: 409, message: 'Ese movimiento ya está anulado' };
  if (mov.tipo !== 'Condonacion') {
    throw {
      status: 400,
      message: 'Un cobro de mora se deshace anulando el pago con el que se hizo',
    };
  }
  const { rows: act } = await pool.query(
    `UPDATE mora_envios SET anulado = TRUE WHERE id = $1 AND NOT anulado RETURNING *`, [movimientoId]
  );
  return act[0];
};

/**
 * Poner, cambiar o quitar el plazo de un envío.
 *
 *   · EN TRÁNSITO → se cambia lo pactado (`plazo_dias` + condición): la fecha
 *     todavía no existe, nacerá al recibir.
 *   · YA RECIBIDO → se fija la `fecha_limite`. NUNCA en el pasado: ponerle hoy
 *     un plazo vencido a un envío viejo generaría de golpe una mora que nadie
 *     pactó (la mora solo corre de la fecha límite en adelante). Es lo que
 *     permite usar la feature con los envíos que ya existían.
 *
 * `quitar: true` quita el plazo y, con él, la mora
 * futura. Lo ya causado y no cobrado deja de existir con él, igual que en
 * créditos: por eso la pantalla ofrece condonar con motivo, que deja rastro.
 */
const fijarPlazo = async (req, remisionId, { fecha_limite, plazo_dias, condicion_id, quitar = false } = {}) => {
  _exigirInstalada();
  if (!req.esBodega) throw { status: 403, message: 'El plazo de un envío lo decide la bodega' };
  const conf = req.red?.mora;
  if (!quitar && !conf?.activa) {
    throw { status: 400, message: 'El plazo de pago de los envíos no está activado en Ajustes → Red interna' };
  }

  const negocioId = req.user.negocio_id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const envio = await _cargarEnvio(client, negocioId, remisionId);

    let actualizado;
    if (quitar) {
      ({ rows: [actualizado] } = await client.query(
        `UPDATE remisiones SET fecha_limite = NULL, mora_condicion = NULL, mora_plazo_dias = NULL
         WHERE id = $1 RETURNING id, numero, fecha_limite, mora_condicion, mora_plazo_dias`,
        [remisionId]
      ));
    } else {
      const cond = _condicion(conf, condicion_id);
      if (!cond) throw { status: 400, message: 'Elige la condición de mora del envío' };

      if (envio.estado === 'En transito') {
        const dias = Number(plazo_dias);
        if (!Number.isInteger(dias) || dias < 1 || dias > 365) {
          throw { status: 400, message: 'El plazo debe ser un número entero de días entre 1 y 365' };
        }
        ({ rows: [actualizado] } = await client.query(
          `UPDATE remisiones SET mora_plazo_dias = $2, mora_condicion = $3::jsonb
           WHERE id = $1 RETURNING id, numero, fecha_limite, mora_condicion, mora_plazo_dias`,
          [remisionId, dias, JSON.stringify(cond)]
        ));
      } else {
        const fecha = fecha_limite
          ? String(fecha_limite).slice(0, 10)
          : (Number(plazo_dias) > 0 ? sumarDias(hoyBogota(), Number(plazo_dias)) : null);
        if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
          throw { status: 400, message: 'La fecha límite debe tener el formato AAAA-MM-DD' };
        }
        if (fecha < hoyBogota()) {
          throw {
            status: 400,
            message: 'La fecha límite no puede ser anterior a hoy: generaría de golpe una mora que nadie pactó',
          };
        }
        ({ rows: [actualizado] } = await client.query(
          `UPDATE remisiones SET fecha_limite = $2, mora_condicion = $3::jsonb, mora_plazo_dias = NULL
           WHERE id = $1 RETURNING id, numero, fecha_limite, mora_condicion, mora_plazo_dias`,
          [remisionId, fecha, JSON.stringify(cond)]
        ));
      }
    }
    await client.query('COMMIT');

    require('./redInterna.avisos').avisar({
      negocioId, sucursalId: Number(envio.sucursal_destino_id),
      titulo: quitar
        ? `El envío #${envio.numero ?? remisionId} ya no tiene plazo`
        : `Plazo de pago del envío #${envio.numero ?? remisionId}`,
      cuerpo: quitar
        ? 'La bodega le quitó la fecha límite: no causa mora.'
        : (actualizado.fecha_limite
          ? `Vence el ${String(aFecha(actualizado.fecha_limite)).split('-').reverse().join('/')}`
          : `${actualizado.mora_plazo_dias} días desde que lo recibas`),
    });
    return { ...actualizado, fecha_limite: aFecha(actualizado.fecha_limite) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Poner plazo a TODOS los envíos abiertos de un local de una vez.
 *
 * Existe para el día en que se enciende la feature: los envíos que ya estaban
 * abiertos nacieron sin plazo, y ponérselo uno por uno es el trabajo que hace
 * que nadie lo haga. Por defecto solo toca los que NO tienen plazo — no pisa
 * lo que la bodega ya pactó envío por envío.
 */
const fijarPlazoLocal = async (req, { sucursal_id, fecha_limite, condicion_id, reemplazar = false }) => {
  _exigirInstalada();
  if (!req.esBodega) throw { status: 403, message: 'El plazo de los envíos lo decide la bodega' };
  const conf = req.red?.mora;
  if (!conf?.activa) {
    throw { status: 400, message: 'El plazo de pago de los envíos no está activado en Ajustes → Red interna' };
  }
  const negocioId  = req.user.negocio_id;
  const sucursalId = Number(sucursal_id);
  if (!sucursalId || sucursalId === Number(req.red.bodega_id)) {
    throw { status: 400, message: 'Elige el local' };
  }
  const fecha = String(fecha_limite || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw { status: 400, message: 'La fecha límite debe tener el formato AAAA-MM-DD' };
  }
  if (fecha < hoyBogota()) {
    throw { status: 400, message: 'La fecha límite no puede ser anterior a hoy' };
  }
  const cond = _condicion(conf, condicion_id);
  if (!cond) throw { status: 400, message: 'Elige la condición de mora' };

  const repo = require('./redInterna.repository');
  const { rows } = await pool.query(`
    WITH env AS (${repo.SQL_ENVIOS_CUENTA})
    UPDATE remisiones r
    SET fecha_limite = $3, mora_condicion = $4::jsonb, mora_plazo_dias = NULL
    FROM env
    WHERE env.remision_id = r.id
      AND r.negocio_id = $1 AND r.sucursal_destino_id = $2
      AND r.tipo = 'entrega' AND r.estado IN ('Recibida', 'Parcial')
      AND env.saldo > 0
      AND ($5::boolean OR r.fecha_limite IS NULL)
    RETURNING r.id, r.numero
  `, [negocioId, sucursalId, fecha, JSON.stringify(cond), !!reemplazar]);

  if (rows.length) {
    require('./redInterna.avisos').avisar({
      negocioId, sucursalId,
      titulo: `Plazo de pago para ${rows.length} envío(s)`,
      cuerpo: `Vencen el ${fecha.split('-').reverse().join('/')}`,
    });
  }
  return { actualizados: rows.length, envios: rows.map((r) => r.numero ?? r.id), fecha_limite: fecha };
};

module.exports = {
  disponible, leerConfigMoraRed, plazoParaDespacho, fechaLimiteAlRecibir,
  cargarEstados, resumir, moraDeEnvio, movimientosDeEnvio, cobrosDeLocal, SIN_PLAZO,
  insertarCobro, anularPorRemesa, anularPorMovimiento,
  condonar, anularCondonacion, fijarPlazo, fijarPlazoLocal,
};
