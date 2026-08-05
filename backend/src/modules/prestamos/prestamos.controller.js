const service = require('./prestamos.service');
const pdfService = require('./prestamos.pdf.service');
const { pool }   = require('../../config/db');
const audit      = require('../../utils/auditoria.util');

// Detalle estándar de auditoría para un préstamo ya creado/cargado
const _detallePrestamo = (p, extra = {}) => ({
  sucursal_id: p?.sucursal_id      ?? null,
  prestatario: p?.prestatario      ?? null,
  producto:    p?.nombre_producto  ?? null,
  imei:        p?.imei             ?? null,
  ...extra,
});

const _getLogoNegocio = async (negocioId) => {
  const { rows } = await pool.query(
    `SELECT valor FROM config_negocio WHERE negocio_id = $1 AND clave = 'logo_negocio'`,
    [negocioId]
  );
  return rows[0]?.valor || null;
};

const getPrestamos = async (req, res, next) => {
  try {
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.getPrestamos(sucursalId, req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getPrestamoById = async (req, res, next) => {
  try {
    const data = await service.getPrestamoById(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

// Crea un único préstamo (compatibilidad hacia atrás)
const crearPrestamo = async (req, res, next) => {
  try {
    const sucursal_id = req.todasSucursales ? req.body.sucursal_id : req.sucursal_id;
    if (!sucursal_id) {
      return res.status(400).json({
        ok: false,
        error: 'Debes indicar la sucursal donde se registra el préstamo',
      });
    }
    const data = await service.crearPrestamo({
      ...req.body,
      sucursal_id,
      usuario_id: req.user.id,
      negocio_id: req.user.negocio_id,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Préstamo registrado', 'prestamos', data.id,
      _detallePrestamo(data, {
        valor:    Number(data.valor_prestamo ?? 0),
        cantidad: data.cantidad_prestada != null ? Number(data.cantidad_prestada) : null,
      }));
    res.status(201).json({ ok: true, data, message: 'Préstamo registrado correctamente' });
  } catch (err) { next(err); }
};

// Crea múltiples préstamos desde el carrito (un préstamo por ítem)
const crearPrestamos = async (req, res, next) => {
  try {
    const sucursal_id = req.todasSucursales ? req.body.sucursal_id : req.sucursal_id;
    if (!sucursal_id) {
      return res.status(400).json({
        ok: false,
        error: 'Debes indicar la sucursal donde se registra el préstamo',
      });
    }
    const data = await service.crearPrestamos({
      ...req.body,
      sucursal_id,
      usuario_id: req.user.id,
      negocio_id: req.user.negocio_id,
    });
    for (const p of data) {
      audit.registrar(req.user.negocio_id, req.user.id, 'Préstamo registrado', 'prestamos', p.id,
        _detallePrestamo(p, {
          valor:    Number(p.valor_prestamo ?? 0),
          cantidad: p.cantidad_prestada != null ? Number(p.cantidad_prestada) : null,
        }));
    }
    res.status(201).json({ ok: true, data, message: `${data.length} préstamo(s) registrado(s) correctamente` });
  } catch (err) { next(err); }
};
const exportarPdfPrestamoIndividual = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) {
      return res.status(400).json({ ok: false, error: 'ID de préstamo inválido' });
    }
 
    const negocioNombre = req.user?.negocio_nombre || '';
    const logoNegocio   = await _getLogoNegocio(req.user.negocio_id);

    const pdfStream = await pdfService.generarPdfPrestamoIndividual({
      prestamoId:   id,
      negocioId:    req.user.negocio_id,
      negocioNombre,
      logoNegocio,
    });
 
    const filename = `prestamo-${id}-${Date.now()}.pdf`;
    res.setHeader('Content-Type',        'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    pdfStream.pipe(res);
  } catch (err) {
    next(err);
  }
};
const registrarAbono = async (req, res, next) => {
  try {
    const { valor, metodo, color, modo, valor_mora, valor_interes } = req.body;
    if (!valor || valor <= 0) {
      return res.status(400).json({ ok: false, error: 'El valor del abono debe ser mayor a 0' });
    }
    const data = await service.registrarAbono(
      req.user.negocio_id, req.params.id, valor, metodo, req.user.id, color || null,
      {
        modo: modo || 'mora_capital',
        valorMora:    valor_mora    || 0,
        valorInteres: valor_interes || 0,
      },
    );
    audit.registrar(req.user.negocio_id, req.user.id, data.saldado ? 'Préstamo saldado con abono' : 'Abono a préstamo', 'prestamos', Number(req.params.id),
      _detallePrestamo(data, {
        monto:  Number(valor),
        metodo: metodo ?? null,
      }));
    res.json({ ok: true, data, message: 'Abono registrado correctamente' });
  } catch (err) { next(err); }
};

const devolverPrestamo = async (req, res, next) => {
  try {
    const data = await service.devolverPrestamo(req.user.negocio_id, req.params.id);
    audit.registrar(req.user.negocio_id, req.user.id, 'Préstamo devuelto', 'prestamos', Number(req.params.id),
      _detallePrestamo(data, {
        valor:    Number(data?.valor_prestamo ?? 0),
        cantidad: data?.cantidad != null ? Number(data.cantidad) : null,
      }));
    res.json({ ok: true, message: 'Préstamo marcado como devuelto' });
  } catch (err) { next(err); }
};

// Devolución parcial: recibe { cantidad_devuelta } en el body
const devolverParcial = async (req, res, next) => {
  try {
    const { cantidad_devuelta } = req.body;
    if (!cantidad_devuelta || cantidad_devuelta < 1) {
      return res.status(400).json({ ok: false, error: 'La cantidad a devolver debe ser mayor a 0' });
    }
    const data = await service.devolverParcial(
      req.user.negocio_id,
      req.params.id,
      Number(cantidad_devuelta),
    );
    audit.registrar(req.user.negocio_id, req.user.id, 'Devolución parcial de préstamo', 'prestamos', Number(req.params.id),
      _detallePrestamo(data, {
        cantidad_devuelta:  Number(data.devuelto  ?? cantidad_devuelta),
        cantidad_pendiente: Number(data.pendiente ?? 0),
      }));
    res.json({ ok: true, data, message: 'Devolución registrada correctamente' });
  } catch (err) { next(err); }
};
const exportarPdfPorPersona = async (req, res, next) => {
  try {
    const { tipo, personaId } = req.params;
 
    if (!['prestatario', 'cliente'].includes(tipo)) {
      return res.status(400).json({
        ok:    false,
        error: "El parámetro 'tipo' debe ser 'prestatario' o 'cliente'",
      });
    }
 
    const id = parseInt(personaId, 10);
    if (isNaN(id) || id < 1) {
      return res.status(400).json({ ok: false, error: 'ID de persona inválido' });
    }
 
    // negocio_nombre puede venir del middleware de autenticación
    // Si tu middleware popula req.user.negocio_nombre úsalo;
    // de lo contrario deja cadena vacía y el PDF usará 'Mi Negocio'.
    const negocioNombre = req.user?.negocio_nombre || '';
    const logoNegocio   = await _getLogoNegocio(req.user.negocio_id);

    const pdfStream = await pdfService.generarPdfPrestamosActivos({
      tipo,
      personaId:    id,
      negocioId:    req.user.negocio_id,
      negocioNombre,
      logoNegocio,
    });
 
    // Nombre de archivo sugerido para el navegador
    const filename = `prestamos-activos-${tipo}-${id}-${Date.now()}.pdf`;
 
    res.setHeader('Content-Type',        'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
 
    pdfStream.pipe(res);
  } catch (err) {
    next(err);
  }
};

const exportarPdfEstadoCuenta = async (req, res, next) => {
  try {
    const { tipo, personaId } = req.params;
    if (!['prestatario', 'cliente'].includes(tipo)) {
      return res.status(400).json({ ok: false, error: "tipo debe ser 'prestatario' o 'cliente'" });
    }
    const id = parseInt(personaId, 10);
    if (isNaN(id) || id < 1) {
      return res.status(400).json({ ok: false, error: 'ID de persona inválido' });
    }
    const negocioNombre = req.user?.negocio_nombre || '';
    const logoNegocio   = await _getLogoNegocio(req.user.negocio_id);
    const sucursalId    = req.todasSucursales ? null : req.sucursal_id;
    const pdfStream = await pdfService.generarPdfEstadoCuenta({
      tipo,
      personaId:    id,
      negocioId:    req.user.negocio_id,
      negocioNombre,
      logoNegocio,
      sucursalId,
    });
    const filename = `estado-cuenta-${tipo}-${id}-${Date.now()}.pdf`;
    res.setHeader('Content-Type',        'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    pdfStream.pipe(res);
  } catch (err) {
    next(err);
  }
};

const registrarSaldoAFavor = async (req, res, next) => {
  try {
    const { tipo, id } = req.params;
    const { monto }    = req.body;

    if (!['prestatario', 'cliente'].includes(tipo)) {
      return res.status(400).json({ ok: false, error: "El tipo debe ser 'prestatario' o 'cliente'" });
    }

    const sucursalId = req.todasSucursales ? (req.body.sucursal_id || req.sucursal_id) : req.sucursal_id;

    const data = await service.registrarSaldoAFavor(
      req.user.negocio_id,
      tipo,
      Number(id),
      Number(monto),
      sucursalId || null,
      req.user.id,
    );
    audit.registrar(req.user.negocio_id, req.user.id, 'Saldo a favor actualizado', 'prestamos', Number(id) || null, {
      sucursal_id: sucursalId ?? null,
      monto:       Number(monto ?? 0),
    });
    res.json({ ok: true, data, message: 'Saldo a favor actualizado correctamente' });
  } catch (err) { next(err); }
};

const getSaldoSucursal = async (req, res, next) => {
  try {
    const { tipo, id } = req.params;
    if (!['prestatario', 'cliente'].includes(tipo)) {
      return res.status(400).json({ ok: false, error: "tipo debe ser 'prestatario' o 'cliente'" });
    }
    const sucursalId = req.sucursal_id;
    if (!sucursalId) return res.status(400).json({ ok: false, error: 'Sucursal no identificada' });
    const data = await service.getSaldoSucursalPersona(req.user.negocio_id, tipo, Number(id), sucursalId);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getHistorialSaldoSucursal = async (req, res, next) => {
  try {
    const { tipo, id } = req.params;
    if (!['prestatario', 'cliente'].includes(tipo)) {
      return res.status(400).json({ ok: false, error: "tipo debe ser 'prestatario' o 'cliente'" });
    }
    const sucursalId = req.sucursal_id;
    if (!sucursalId) return res.status(400).json({ ok: false, error: 'Sucursal no identificada' });
    const data = await service.getHistorialSaldoSucursalPersona(req.user.negocio_id, tipo, Number(id), sucursalId);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const intercambiarPrestamo = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const {
      tipo_retoma, imei_retoma, producto_serial_id, color_retoma, caracteristicas_retoma,
      producto_cantidad_id, cantidad_retoma,
      valor_retoma, descripcion, ingreso_inventario,
    } = req.body;

    const data = await service.intercambiarPrestamo(
      req.user.negocio_id,
      id,
      {
        usuario_id:             req.user.id,
        tipo_retoma,
        imei_retoma:            imei_retoma          || null,
        producto_serial_id:     producto_serial_id   ? Number(producto_serial_id)   : null,
        color_retoma:           color_retoma         || null,
        caracteristicas_retoma: caracteristicas_retoma || null,
        producto_cantidad_id:   producto_cantidad_id ? Number(producto_cantidad_id) : null,
        cantidad_retoma:        Number(cantidad_retoma || 1),
        valor_retoma:           Number(valor_retoma),
        descripcion:            descripcion          || null,
        ingreso_inventario:     ingreso_inventario !== false,
      },
    );
    audit.registrar(req.user.negocio_id, req.user.id, 'Retoma aplicada a préstamo (intercambio)', 'prestamos', id, {
      sucursal_id: data?.sucursal_id ?? null,
      valor:       Number(valor_retoma ?? 0),
      imei:        imei_retoma ?? null,
      tipo:        tipo_retoma ?? 'serial',
      descripcion: descripcion ?? null,
    });
    res.json({ ok: true, data, message: 'Intercambio registrado correctamente' });
  } catch (err) { next(err); }
};

const retomaDirecta = async (req, res, next) => {
  try {
    const sucursal_id = req.todasSucursales ? req.body.sucursal_id : req.sucursal_id;
    if (!sucursal_id) {
      return res.status(400).json({ ok: false, error: 'Debes indicar la sucursal' });
    }
    const {
      tipo, persona_id,
      tipo_retoma, imei_retoma, producto_serial_id, color_retoma, caracteristicas_retoma,
      producto_cantidad_id, cantidad_retoma,
      valor_retoma, descripcion, ingreso_inventario,
    } = req.body;

    if (!['prestatario', 'cliente'].includes(tipo)) {
      return res.status(400).json({ ok: false, error: "tipo debe ser 'prestatario' o 'cliente'" });
    }

    const data = await service.retomaDirecta(req.user.negocio_id, {
      sucursal_id,
      usuario_id:             req.user.id,
      tipo,
      persona_id:             Number(persona_id),
      tipo_retoma:            tipo_retoma || 'serial',
      imei_retoma:            imei_retoma          || null,
      producto_serial_id:     producto_serial_id   ? Number(producto_serial_id)   : null,
      color_retoma:           color_retoma         || null,
      caracteristicas_retoma: caracteristicas_retoma || null,
      producto_cantidad_id:   producto_cantidad_id ? Number(producto_cantidad_id) : null,
      cantidad_retoma:        Number(cantidad_retoma || 1),
      valor_retoma:           Number(valor_retoma),
      descripcion:            descripcion          || null,
      ingreso_inventario:     ingreso_inventario !== false,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Retoma directa registrada', 'prestamos', data?.id ?? null, {
      sucursal_id: sucursal_id ?? null,
      valor:       Number(valor_retoma ?? 0),
      imei:        imei_retoma ?? null,
      tipo:        tipo_retoma || 'serial',
      descripcion: descripcion ?? null,
    });
    res.json({ ok: true, data, message: 'Retoma registrada. Saldo a favor acreditado.' });
  } catch (err) { next(err); }
};

const aplicarSaldoAPrestamos = async (req, res, next) => {
  try {
    const { tipo, id } = req.params;
    if (!['prestatario', 'cliente'].includes(tipo)) {
      return res.status(400).json({ ok: false, error: "tipo debe ser 'prestatario' o 'cliente'" });
    }
    const data = await service.aplicarSaldoAPrestamos(
      req.user.negocio_id, tipo, Number(id)
    );
    audit.registrar(req.user.negocio_id, req.user.id, 'Saldo a favor aplicado a préstamos', 'prestamos', Number(id) || null, {});
    res.json({ ok: true, data, message: 'Saldo a favor aplicado a los préstamos activos' });
  } catch (err) { next(err); }
};

const getResumenCartera = async (req, res, next) => {
  try {
    const { tipo, id } = req.params;
    if (!['prestatario', 'cliente'].includes(tipo)) {
      return res.status(400).json({ ok: false, error: "tipo debe ser 'prestatario' o 'cliente'" });
    }
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.getResumenCartera(
      req.user.negocio_id, tipo, Number(id), sucursalId
    );
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const anularAbono = async (req, res, next) => {
  try {
    const prestamoId = parseInt(req.params.id, 10);
    const abonoId    = parseInt(req.params.abonoId, 10);
    const retomaId   = req.body.retoma_id ? Number(req.body.retoma_id) : null;

    if (isNaN(prestamoId) || isNaN(abonoId)) {
      return res.status(400).json({ ok: false, error: 'IDs inválidos' });
    }

    const data = await service.anularAbono(req.user.negocio_id, prestamoId, abonoId, retomaId);
    audit.registrar(req.user.negocio_id, req.user.id, 'Abono de préstamo anulado', 'prestamos', prestamoId, {
      abono_id:  abonoId,
      retoma_id: retomaId,
    });
    res.json({ ok: true, data, message: 'Abono anulado correctamente' });
  } catch (err) { next(err); }
};

const getRetomasDirectas = async (req, res, next) => {
  try {
    const { tipo, id } = req.params;
    if (!['prestatario', 'cliente'].includes(tipo)) {
      return res.status(400).json({ ok: false, error: "tipo debe ser 'prestatario' o 'cliente'" });
    }
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.getRetomasDirectas(req.user.negocio_id, tipo, Number(id), sucursalId);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const anularRetomaDirecta = async (req, res, next) => {
  try {
    const retomaId = parseInt(req.params.retomaId, 10);
    if (isNaN(retomaId)) {
      return res.status(400).json({ ok: false, error: 'ID de retoma inválido' });
    }
    await service.anularRetomaDirecta(req.user.negocio_id, retomaId);
    audit.registrar(req.user.negocio_id, req.user.id, 'Retoma directa anulada', 'prestamos', retomaId, {});
    res.json({ ok: true, message: 'Retoma anulada correctamente' });
  } catch (err) { next(err); }
};

// ── Documentos de la obligación (mismos que en facturas a crédito) ───────────

const getDocumentoPrestamo = async (req, res, next) => {
  try {
    const data = await pdfService._documentoPrestamo(Number(req.params.id), req.user.negocio_id);
    // La config del negocio no viaja aquí: la impresión POS ya la tiene cargada.
    const { config, ...resto } = data;
    res.json({ ok: true, data: resto });
  } catch (err) { next(err); }
};

const _enviarPdf = (res, pdfStream, filename) => {
  res.setHeader('Content-Type',        'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  pdfStream.pipe(res);
};

const exportarPdfAvisoMoraPrestamo = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const pdfStream = await pdfService.generarPdfAvisoMoraPrestamo({
      prestamoId: id, negocioId: req.user.negocio_id,
    });
    _enviarPdf(res, pdfStream, `aviso-mora-prestamo-${id}.pdf`);
  } catch (err) { next(err); }
};

const exportarPdfPazYSalvoPrestamo = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const pdfStream = await pdfService.generarPdfPazYSalvoPrestamo({
      prestamoId: id, negocioId: req.user.negocio_id,
    });
    _enviarPdf(res, pdfStream, `paz-y-salvo-prestamo-${id}.pdf`);
  } catch (err) { next(err); }
};

const getEstadoCuenta = async (req, res, next) => {
  try {
    const { tipo, id } = req.params;
    if (!['prestatario', 'cliente'].includes(tipo)) {
      return res.status(400).json({ ok: false, error: "tipo debe ser 'prestatario' o 'cliente'" });
    }
    const sucursalId = req.todasSucursales ? null : req.sucursal_id;
    const data = await service.getEstadoCuenta(req.user.negocio_id, tipo, Number(id), sucursalId);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const aplicarSaldoAPrestamo = async (req, res, next) => {
  try {
    const data = await service.aplicarSaldoAPrestamo(req.user.negocio_id, Number(req.params.id));
    audit.registrar(req.user.negocio_id, req.user.id, 'Saldo a favor aplicado a préstamo', 'prestamos', Number(req.params.id), {});
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const editarValorPrestamo = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { valor_prestamo } = req.body;
    if (!valor_prestamo || Number(valor_prestamo) <= 0) {
      return res.status(400).json({ ok: false, error: 'El valor debe ser mayor a 0' });
    }
    const data = await service.editarValorPrestamo(
      req.user.negocio_id,
      id,
      Number(valor_prestamo)
    );
    audit.registrar(req.user.negocio_id, req.user.id, 'Valor de préstamo editado', 'prestamos', id,
      _detallePrestamo(data, { valor: Number(valor_prestamo) }));
    res.json({ ok: true, data, message: 'Valor del préstamo actualizado correctamente' });
  } catch (err) { next(err); }
};

const crearAjusteDeuda = async (req, res, next) => {
  try {
    const sucursal_id = req.todasSucursales ? req.body.sucursal_id : req.sucursal_id;
    if (!sucursal_id) return res.status(400).json({ ok: false, error: 'Debes indicar la sucursal' });
    const data = await service.crearAjusteDeuda(req.user.negocio_id, {
      ...req.body,
      sucursal_id,
      usuario_id: req.user.id,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Ajuste de deuda registrado', 'prestamos', data?.id ?? null, {
      sucursal_id: sucursal_id ?? null,
      valor:       Number(req.body.valor ?? 0),
      descripcion: req.body.descripcion ?? null,
    });
    res.status(201).json({ ok: true, data, message: 'Ajuste registrado correctamente' });
  } catch (err) { next(err); }
};

const registrarAbonoTotal = async (req, res, next) => {
  try {
    const { tipo, id } = req.params;
    const { valor_total, metodo } = req.body;
    if (!valor_total || valor_total <= 0) {
      return res.status(400).json({ ok: false, error: 'El valor total debe ser mayor a 0' });
    }
    const sucursal_id = req.todasSucursales ? req.body.sucursal_id : req.sucursal_id;
    if (!sucursal_id) {
      return res.status(400).json({ ok: false, error: 'Debes indicar la sucursal' });
    }
    const data = await service.registrarAbonoTotal(
      req.user.negocio_id, tipo, id, Number(valor_total), metodo, req.user.id, sucursal_id
    );
    audit.registrar(req.user.negocio_id, req.user.id, 'Abono total a préstamos', 'prestamos', Number(id) || null, {
      sucursal_id: sucursal_id ?? null,
      monto:       Number(valor_total),
      metodo:      metodo ?? null,
    });
    res.json({ ok: true, data, message: 'Abono total registrado correctamente' });
  } catch (err) { next(err); }
};

const modificarAbonoTotal = async (req, res, next) => {
  try {
    const { abonoTotalId } = req.params;
    const { valor_total, metodo } = req.body;
    if (!valor_total || valor_total <= 0) {
      return res.status(400).json({ ok: false, error: 'El valor total debe ser mayor a 0' });
    }
    const data = await service.modificarAbonoTotal(
      req.user.negocio_id, abonoTotalId, Number(valor_total), metodo
    );
    audit.registrar(req.user.negocio_id, req.user.id, 'Abono total modificado', 'prestamos', Number(abonoTotalId) || null, {
      monto:  Number(valor_total),
      metodo: metodo ?? null,
    });
    res.json({ ok: true, data, message: 'Abono total modificado correctamente' });
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
    audit.registrar(req.user.negocio_id, req.user.id, 'Plazo de pago de préstamo', 'prestamos', Number(req.params.id), {
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
    audit.registrar(req.user.negocio_id, req.user.id, 'Interés de préstamo', 'prestamos', Number(req.params.id), {
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
    audit.registrar(req.user.negocio_id, req.user.id, `Condonación de ${etiqueta}`, 'prestamos', Number(req.params.id), {
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

module.exports = {
  getPrestamos, getPrestamoById,
  crearPrestamo, crearPrestamos,
  registrarAbono,
  fijarPlazo, fijarInteres, condonarMora, cobrarMora,
  devolverPrestamo, devolverParcial,
  exportarPdfPorPersona, exportarPdfPrestamoIndividual, exportarPdfEstadoCuenta,
  getDocumentoPrestamo, exportarPdfAvisoMoraPrestamo, exportarPdfPazYSalvoPrestamo,
  registrarSaldoAFavor,
  intercambiarPrestamo,
  retomaDirecta, aplicarSaldoAPrestamos, aplicarSaldoAPrestamo, getResumenCartera,
  anularAbono, getRetomasDirectas, anularRetomaDirecta,
  getEstadoCuenta, crearAjusteDeuda, editarValorPrestamo,
  getSaldoSucursal, getHistorialSaldoSucursal,
  registrarAbonoTotal, modificarAbonoTotal,
};