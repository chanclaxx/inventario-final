const service    = require('./reportes.service');
const pdfService = require('./reportes.pdf');
const { pool }   = require('../../config/db');

const getDashboard = async (req, res, next) => {
  try {
    const data = await service.getDashboard(req.sucursal_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getVentasRango = async (req, res, next) => {
  try {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) {
      return res.status(400).json({ ok: false, error: 'Los parámetros desde y hasta son requeridos' });
    }
    const data = await service.getVentasRango(req.sucursal_id, desde, hasta);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getAnalisis = async (req, res, next) => {
  try {
    const { desde, hasta, agrupacion } = req.query;
    if (!desde || !hasta) {
      return res.status(400).json({ ok: false, error: 'Los parámetros desde y hasta son requeridos' });
    }
    const data = await service.getAnalisis(req.sucursal_id, desde, hasta, agrupacion);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const exportarPdf = async (req, res, next) => {
  try {
    const { desde, hasta, agrupacion, detalle } = req.query;
    if (!desde || !hasta) {
      return res.status(400).json({ ok: false, error: 'Los parámetros desde y hasta son requeridos' });
    }

    const [negocioRes, sucursalRes, logoRes] = await Promise.all([
      pool.query('SELECT nombre, nit, direccion, telefono FROM negocios WHERE id = $1', [req.user.negocio_id]),
      pool.query('SELECT nombre FROM sucursales WHERE id = $1', [req.sucursal_id]),
      pool.query(`SELECT valor FROM config_negocio WHERE negocio_id = $1 AND clave = 'logo_negocio'`, [req.user.negocio_id]),
    ]);

    const pdfStream = await pdfService.generarReporteContable({
      negocio:        negocioRes.rows[0] || null,
      sucursalNombre: sucursalRes.rows[0]?.nombre || null,
      sucursalId:     req.sucursal_id,
      desde,
      hasta,
      agrupacion,
      logo:            logoRes.rows[0]?.valor || null,
      detalleFacturas: detalle === 'completo',
    });

    const filename = `reporte-gestion-${desde}_a_${hasta}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    pdfStream.pipe(res);
  } catch (err) { next(err); }
};

const getProyeccion = async (req, res, next) => {
  try {
    const meses = req.query.meses ? Number(req.query.meses) : 6;
    const data = await service.getProyeccion(req.sucursal_id, meses);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const exportarProyeccionPdf = async (req, res, next) => {
  try {
    const meses = req.query.meses ? Number(req.query.meses) : 6;

    const [negocioRes, sucursalRes, logoRes] = await Promise.all([
      pool.query('SELECT nombre, nit, direccion, telefono FROM negocios WHERE id = $1', [req.user.negocio_id]),
      pool.query('SELECT nombre FROM sucursales WHERE id = $1', [req.sucursal_id]),
      pool.query(`SELECT valor FROM config_negocio WHERE negocio_id = $1 AND clave = 'logo_negocio'`, [req.user.negocio_id]),
    ]);

    const pdfStream = await pdfService.generarReporteProyeccion({
      negocio:        negocioRes.rows[0] || null,
      sucursalNombre: sucursalRes.rows[0]?.nombre || null,
      sucursalId:     req.sucursal_id,
      meses,
      logo:           logoRes.rows[0]?.valor || null,
    });

    const filename = `proyeccion-${req.sucursal_id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    pdfStream.pipe(res);
  } catch (err) { next(err); }
};

// ── Gastos fijos (por sucursal) ──────────────────────────────────────────────
const listarGastosFijos = async (req, res, next) => {
  try {
    const data = await service.listarGastosFijos(req.sucursal_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearGastoFijo = async (req, res, next) => {
  try {
    const { nombre, valor } = req.body;
    const data = await service.crearGastoFijo(req.sucursal_id, nombre, Number(valor));
    res.status(201).json({ ok: true, data });
  } catch (err) { next(err); }
};

const actualizarGastoFijo = async (req, res, next) => {
  try {
    const { nombre, valor } = req.body;
    const data = await service.actualizarGastoFijo(req.sucursal_id, Number(req.params.id), nombre, Number(valor));
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const eliminarGastoFijo = async (req, res, next) => {
  try {
    const data = await service.eliminarGastoFijo(req.sucursal_id, Number(req.params.id));
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getVentasPorVendedor = async (req, res, next) => {
  try {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) {
      return res.status(400).json({ ok: false, error: 'Los parámetros desde y hasta son requeridos' });
    }
    const data = await service.getVentasPorVendedor(req.sucursal_id, desde, hasta);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getProductosTop = async (req, res, next) => {
  try {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) {
      return res.status(400).json({ ok: false, error: 'Los parámetros desde y hasta son requeridos' });
    }
    const data = await service.getProductosTop(req.sucursal_id, desde, hasta);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getInventarioBajo = async (req, res, next) => {
  try {
    const data = await service.getInventarioBajo(req.sucursal_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const actualizarCostoCompra = async (req, res, next) => {
  try {
    const { tipo, imei, nombre_producto, nuevo_costo, producto_id, variante_id, atributo_id } = req.body;

    if (!tipo || nuevo_costo === undefined || nuevo_costo === null) {
      return res.status(400).json({
        ok: false,
        error: 'Los campos tipo y nuevo_costo son requeridos',
      });
    }

    if (Number(nuevo_costo) < 0) {
      return res.status(400).json({
        ok: false,
        error: 'El costo de compra no puede ser negativo',
      });
    }

    if (tipo === 'serial' && !imei) {
      return res.status(400).json({
        ok: false,
        error: 'El campo imei es requerido para productos de tipo serial',
      });
    }

    if (tipo === 'cantidad' && !nombre_producto && !producto_id && !variante_id && !atributo_id) {
      return res.status(400).json({
        ok: false,
        error: 'Se requiere nombre_producto, producto_id, variante_id o atributo_id',
      });
    }

    const data = await service.actualizarCostoCompra(
      req.sucursal_id,
      tipo,
      imei         ?? null,
      nombre_producto ?? null,
      Number(nuevo_costo),
      producto_id  ? Number(producto_id)  : null,
      variante_id  ? Number(variante_id)  : null,
      atributo_id  ? Number(atributo_id)  : null,
    );

    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
};

// CAMBIO: ahora usa req.sucursal_id en vez de req.user.negocio_id
// para que el inventario se filtre por sucursal, no por todo el negocio
const getValorInventario = async (req, res, next) => {
  try {
    const data = await service.getValorInventario(req.sucursal_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

module.exports = {
  getDashboard, getVentasRango, getAnalisis, exportarPdf, getVentasPorVendedor, getProductosTop,
  getInventarioBajo, actualizarCostoCompra, getValorInventario,
  getProyeccion, exportarProyeccionPdf, listarGastosFijos, crearGastoFijo, actualizarGastoFijo, eliminarGastoFijo,
};