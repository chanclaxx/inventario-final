const service    = require('./creditos.service');
const pdfService = require('./creditos.pdf.service');
const audit      = require('../../utils/auditoria.util');
const { pool }   = require('../../config/db');

// La clave del cliente es `cedula` o, si no tiene, su nombre: la misma con la
// que la pantalla agrupa las tarjetas.
const _clave = (req) => String(req.query.clave ?? '').trim();

const _getLogoNegocio = async (negocioId) => {
  const { rows } = await pool.query(
    `SELECT valor FROM config_negocio WHERE negocio_id = $1 AND clave = 'logo_negocio'`,
    [negocioId]
  );
  return rows[0]?.valor || null;
};

const getCreditos = async (req, res, next) => {
  try {
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.getCreditos(sucursalId, req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getCreditoById = async (req, res, next) => {
  try {
    const data = await service.getCreditoById(req.user.negocio_id, Number(req.params.id));
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const registrarAbono = async (req, res, next) => {
  try {
    const data = await service.registrarAbono(req.user.negocio_id, Number(req.params.id), {
      ...req.body,
      usuario_id: req.user.id,
      // El aislamiento se decide en el backend con la sucursal ya resuelta por
      // el middleware, nunca con lo que mande el cliente.
      sucursal_id: req.sucursal_id,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Abono a crédito', 'creditos', Number(req.params.id), {
      sucursal_id: data.sucursal_id ?? null,
      monto:       Number(req.body.monto ?? 0),
      saldo_nuevo: Number(data.saldo    ?? 0),
    });
    res.json({ ok: true, data, message: 'Abono registrado correctamente' });
  } catch (err) { next(err); }
};

const saldarCredito = async (req, res, next) => {
  try {
    await service.saldarCredito(req.user.negocio_id, Number(req.params.id));
    res.json({ ok: true, message: 'Crédito saldado correctamente' });
  } catch (err) { next(err); }
};

const cancelarCredito = async (req, res, next) => {
  try {
    await service.cancelarCredito(req.user.negocio_id, Number(req.params.id));
    res.json({ ok: true, message: 'Crédito cancelado correctamente' });
  } catch (err) { next(err); }
};

// ── Estado de cuenta ─────────────────────────────────────────────────────────

const getEstadoCuenta = async (req, res, next) => {
  try {
    const clave = _clave(req);
    if (!clave) return res.status(400).json({ ok: false, error: 'Falta la cédula o el nombre del cliente' });

    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.getEstadoCuenta(req.user.negocio_id, clave, sucursalId);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const exportarPdfEstadoCuenta = async (req, res, next) => {
  try {
    const clave = _clave(req);
    if (!clave) return res.status(400).json({ ok: false, error: 'Falta la cédula o el nombre del cliente' });

    const sucursalId  = req.todasSucursales ? null : req.sucursal_id;
    const logoNegocio = await _getLogoNegocio(req.user.negocio_id);

    const pdfStream = await pdfService.generarPdfEstadoCuenta({
      clave,
      negocioId:     req.user.negocio_id,
      negocioNombre: req.user?.negocio_nombre || '',
      logoNegocio,
      sucursalId,
    });

    const filename = `estado-cuenta-credito-${Date.now()}.pdf`;
    res.setHeader('Content-Type',        'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    pdfStream.pipe(res);
  } catch (err) { next(err); }
};

// ── Documentos por crédito ───────────────────────────────────────────────────

/** Datos para imprimir en POS: el MISMO resumen que usa el PDF. */
const getDocumento = async (req, res, next) => {
  try {
    const data = await service.getDocumento(req.user.negocio_id, Number(req.params.id));
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const _enviarPdf = (res, pdfStream, filename) => {
  res.setHeader('Content-Type',        'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  pdfStream.pipe(res);
};

const exportarPdfAvisoMora = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const pdfStream = await pdfService.generarPdfAvisoMora({
      creditoId: id, negocioId: req.user.negocio_id,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Aviso de mora emitido', 'creditos', id, {});
    _enviarPdf(res, pdfStream, `aviso-mora-${id}.pdf`);
  } catch (err) { next(err); }
};

const exportarPdfPazYSalvo = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const pdfStream = await pdfService.generarPdfPazYSalvo({
      creditoId: id, negocioId: req.user.negocio_id,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Paz y salvo emitido', 'creditos', id, {});
    _enviarPdf(res, pdfStream, `paz-y-salvo-${id}.pdf`);
  } catch (err) { next(err); }
};

// ── Mora ─────────────────────────────────────────────────────────────────────

const fijarPlazo = async (req, res, next) => {
  try {
    const data = await service.fijarPlazo(req.user.negocio_id, Number(req.params.id), {
      fecha_limite: req.body.fecha_limite ?? null,
      condicion_id: req.body.condicion_id,
      rol:          req.user.rol,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Plazo de pago de crédito', 'creditos', Number(req.params.id), {
      fecha_limite: data.fecha_limite,
    });
    res.json({ ok: true, data, message: data.fecha_limite ? 'Plazo actualizado' : 'Plazo eliminado' });
  } catch (err) { next(err); }
};

/** Fija, cambia o quita el plan de interés corriente. */
const fijarInteres = async (req, res, next) => {
  try {
    const data = await service.fijarInteres(req.user.negocio_id, Number(req.params.id), {
      plan_id: req.body.plan_id ?? null,
      desde:   req.body.desde,
      rol:     req.user.rol,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Interés de crédito', 'creditos', Number(req.params.id), {
      plan: data.interes_condicion?.nombre ?? null,
    });
    res.json({
      ok: true, data,
      message: data.interes_condicion ? 'Interés actualizado' : 'Interés eliminado',
    });
  } catch (err) { next(err); }
};

// Sirve para los DOS cargos: `concepto` llega en el body y por defecto es mora,
// así los clientes que ya existían no cambian de conducta.
const condonarMora = async (req, res, next) => {
  try {
    const concepto = req.body.concepto === 'interes' ? 'interes' : 'mora';
    const data = await service.condonarMora(req.user.negocio_id, Number(req.params.id), {
      valor:      req.body.valor,
      motivo:     req.body.motivo,
      pin:        req.body.pin,
      concepto,
      quitar_plazo:   req.body.quitar_plazo   === true,
      quitar_interes: req.body.quitar_interes === true,
      usuario_id: req.user.id,
      rol:        req.user.rol,
    });
    const etiqueta = concepto === 'interes' ? 'interés' : 'mora';
    audit.registrar(req.user.negocio_id, req.user.id, `Condonación de ${etiqueta}`, 'creditos', Number(req.params.id), {
      valor:  Number(data.movimiento?.valor ?? 0),
      motivo: req.body.motivo,
      concepto,
    });
    res.json({ ok: true, data, message: concepto === 'interes' ? 'Interés condonado' : 'Mora condonada' });
  } catch (err) { next(err); }
};

const cobrarMora = async (req, res, next) => {
  try {
    const concepto = req.body.concepto === 'interes' ? 'interes' : 'mora';
    const data = await service.cobrarMora(req.user.negocio_id, Number(req.params.id), {
      valor:      req.body.valor,
      metodo:     req.body.metodo,
      concepto,
      usuario_id: req.user.id,
    });
    res.json({ ok: true, data, message: concepto === 'interes' ? 'Interés cobrado' : 'Mora cobrada' });
  } catch (err) { next(err); }
};


// ── Pago total: un pago repartido entre los créditos del cliente ────────────
const registrarAbonoTotal = async (req, res, next) => {
  try {
    const { cliente_id, valor_total, metodo, descripcion } = req.body;
    const sucursal_id = req.todasSucursales ? req.body.sucursal_id : req.sucursal_id;
    if (!sucursal_id) {
      return res.status(400).json({ ok: false, error: 'Debes indicar la sucursal del pago' });
    }
    const data = await service.registrarAbonoTotalCredito(
      req.user.negocio_id, Number(cliente_id), valor_total, metodo, req.user.id, sucursal_id,
      { descripcion },
    );
    audit.registrar(req.user.negocio_id, req.user.id, 'Pago total a créditos', 'creditos',
      data.abono_total_id, {
        sucursal_id,
        cliente_id: Number(cliente_id),
        valor:      data.valor_total,
        creditos:   data.distribucion.map((d) => d.credito_id),
        descripcion: descripcion || null,
      });
    res.status(201).json({ ok: true, data, message: 'Pago registrado y repartido' });
  } catch (err) { next(err); }
};

// ── Anular un abono ─────────────────────────────────────────────────────────
// Mueve plata: queda en auditoría con el motivo que escribió la persona.
const anularAbono = async (req, res, next) => {
  try {
    const data = await service.anularAbonoCredito(req.user.negocio_id, Number(req.params.abonoId), {
      motivo: req.body?.motivo, usuario_id: req.user.id, sucursal_id: req.sucursal_id,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Abono de crédito anulado', 'creditos',
      data.credito_id, {
        abono_id: data.abono_id, valor: data.valor, motivo: data.motivo,
        credito_reabierto: data.reabierto, mora_anulada: data.mora_anulada,
      });
    res.json({
      ok: true, data,
      message: data.reabierto
        ? 'Abono anulado. El crédito volvió a quedar activo.'
        : 'Abono anulado',
    });
  } catch (err) { next(err); }
};



// ── Anular un pago total completo ───────────────────────────────────────────
// Un pedazo suelto no se puede anular; el pago entero sí. Es la salida cuando
// alguien se equivoca digitando el monto o lo registra en la persona que no era.
const anularAbonoTotal = async (req, res, next) => {
  try {
    const data = await service.anularAbonoTotalCredito(
      req.user.negocio_id, Number(req.params.abonoTotalId),
      { motivo: req.body?.motivo, usuario_id: req.user.id, sucursal_id: req.sucursal_id },
    );
    audit.registrar(req.user.negocio_id, req.user.id, 'Pago total a créditos anulado', 'creditos',
      data.abono_total_id, {
        valor: data.valor, motivo: data.motivo,
        pedazos: data.pedazos, creditos_reabiertos: data.reabiertos,
      });
    res.json({
      ok: true, data,
      message: data.reabiertos > 0
        ? `Pago total anulado. ${data.reabiertos} crédito(s) volvieron a quedar activos.`
        : 'Pago total anulado',
    });
  } catch (err) { next(err); }
};

module.exports = {
  registrarAbonoTotal, anularAbono, anularAbonoTotal,
  getCreditos, getCreditoById, registrarAbono, saldarCredito, cancelarCredito,
  getEstadoCuenta, exportarPdfEstadoCuenta,
  getDocumento, exportarPdfAvisoMora, exportarPdfPazYSalvo,
  fijarPlazo, fijarInteres, condonarMora, cobrarMora,
};