const service = require('./redInterna.pedidos.service');
const audit   = require('../../utils/auditoria.util');

// ─────────────────────────────────────────────────────────────────────────────
// PEDIDOS INTERNOS — el local le pide a la bodega
//
// Una sola ruta de listado y una sola de ficha para los dos lados: el service
// decide qué puede ver cada quien según la sucursal activa, igual que el panel.
// La UI no elige la vista ni manda "soy la bodega".
// ─────────────────────────────────────────────────────────────────────────────

const listar = async (req, res, next) => {
  try {
    const data = await service.listar(req, {
      estado:   req.query.estado,
      sucursal: req.query.sucursal,
      abiertos: req.query.abiertos === '1',
      q:        req.query.q,
      limit:    req.query.limit,
    });
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getPedido = async (req, res, next) => {
  try {
    res.json({ ok: true, data: await service.getPedido(req, Number(req.params.id)) });
  } catch (err) { next(err); }
};

// Qué tiene la bodega, para armar el pedido. Sin costos: ver el service.
const catalogo = async (req, res, next) => {
  try {
    res.json({ ok: true, data: await service.catalogo(req, req.query.q || '') });
  } catch (err) { next(err); }
};

const crear = async (req, res, next) => {
  try {
    const { lineas, notas, prioridad, enviar, clave_idempotencia } = req.body;
    const data = await service.crear(req, {
      lineas, notas, prioridad, enviar, clave_idempotencia,
    });
    if (!data.repetido) {
      audit.registrar(req.user.negocio_id, req.user.id, 'Pedido a bodega', 'red_interna', data.id, {
        sucursal_id: Number(req.sucursal_id),
        lineas: (lineas || []).length,
        estado: data.estado,
      });
    }
    res.status(201).json({
      ok: true, data,
      message: data.estado === 'Enviado' ? 'Pedido enviado a la bodega' : 'Borrador guardado',
    });
  } catch (err) { next(err); }
};

const editar = async (req, res, next) => {
  try {
    const { lineas, notas, prioridad } = req.body;
    const data = await service.editar(req, Number(req.params.id), { lineas, notas, prioridad });
    res.json({ ok: true, data, message: 'Pedido actualizado' });
  } catch (err) { next(err); }
};

const enviar = async (req, res, next) => {
  try {
    const data = await service.enviar(req, Number(req.params.id));
    audit.registrar(req.user.negocio_id, req.user.id, 'Pedido enviado', 'red_interna', data.id, {
      sucursal_id: Number(req.sucursal_id),
    });
    res.json({ ok: true, data, message: 'Pedido enviado a la bodega' });
  } catch (err) { next(err); }
};

const anular = async (req, res, next) => {
  try {
    const data = await service.anular(req, Number(req.params.id), { motivo: req.body?.motivo });
    audit.registrar(req.user.negocio_id, req.user.id, 'Pedido anulado', 'red_interna', data.id, {
      sucursal_id: Number(req.sucursal_id), motivo: req.body?.motivo,
    });
    res.json({ ok: true, data, message: 'Pedido anulado' });
  } catch (err) { next(err); }
};

const cerrar = async (req, res, next) => {
  try {
    const data = await service.cerrar(req, Number(req.params.id), {
      respuesta: req.body?.respuesta,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Pedido cerrado', 'red_interna', data.id, {
      sucursal_id: Number(data.sucursal_id), respuesta: req.body?.respuesta,
    });
    res.json({ ok: true, data, message: 'Pedido cerrado' });
  } catch (err) { next(err); }
};

const reabrir = async (req, res, next) => {
  try {
    const data = await service.reabrir(req, Number(req.params.id));
    audit.registrar(req.user.negocio_id, req.user.id, 'Pedido reabierto', 'red_interna', data.id, {
      sucursal_id: Number(data.sucursal_id),
    });
    res.json({ ok: true, data, message: 'Pedido reabierto' });
  } catch (err) { next(err); }
};

module.exports = {
  listar, getPedido, catalogo,
  crear, editar, enviar, anular, cerrar, reabrir,
};
