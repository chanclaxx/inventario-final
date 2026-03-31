const service = require('./prestamos.service');
const pdfService = require('./prestamos.pdf.service');

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
    res.status(201).json({ ok: true, data, message: `${data.length} préstamo(s) registrado(s) correctamente` });
  } catch (err) { next(err); }
};

const registrarAbono = async (req, res, next) => {
  try {
    const { valor } = req.body;
    if (!valor || valor <= 0) {
      return res.status(400).json({ ok: false, error: 'El valor del abono debe ser mayor a 0' });
    }
    const data = await service.registrarAbono(req.user.negocio_id, req.params.id, valor);
    res.json({ ok: true, data, message: 'Abono registrado correctamente' });
  } catch (err) { next(err); }
};

const devolverPrestamo = async (req, res, next) => {
  try {
    await service.devolverPrestamo(req.user.negocio_id, req.params.id);
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
 
    const pdfStream = await pdfService.generarPdfPrestamosActivos({
      tipo,
      personaId:    id,
      negocioId:    req.user.negocio_id,
      negocioNombre,
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

module.exports = {
  getPrestamos, getPrestamoById,
  crearPrestamo, crearPrestamos,
  registrarAbono,
  devolverPrestamo, devolverParcial,exportarPdfPorPersona
};