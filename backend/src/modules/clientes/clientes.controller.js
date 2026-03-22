const service = require('./clientes.service');

const getClientes = async (req, res, next) => {
  try {
    const data = await service.getClientes(req.user.negocio_id, req.query.filtro);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getClienteById = async (req, res, next) => {
  try {
    const data = await service.getClienteById(req.user.negocio_id, req.params.id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const buscarPorCedula = async (req, res, next) => {
  try {
    const data = await service.buscarPorCedula(req.user.negocio_id, req.params.cedula);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearCliente = async (req, res, next) => {
  try {
    const data = await service.crearCliente(req.user.negocio_id, req.body);
    res.status(201).json({ ok: true, data, message: 'Cliente creado correctamente' });
  } catch (err) { next(err); }
};

const actualizarCliente = async (req, res, next) => {
  try {
    const data = await service.actualizarCliente(req.user.negocio_id, req.params.id, req.body);
    res.json({ ok: true, data, message: 'Cliente actualizado correctamente' });
  } catch (err) { next(err); }
};
const getFrecuentes = async (req, res, next) => {
  try {
    const sucursalId = req.sucursal_id;
    if (!sucursalId) return res.status(400).json({ ok: false, error: 'Sucursal requerida' });
    const data = await service.getFrecuentes(sucursalId);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};
 
const agregarFrecuente = async (req, res, next) => {
  try {
    const sucursalId = req.sucursal_id;
    if (!sucursalId) return res.status(400).json({ ok: false, error: 'Sucursal requerida' });
    const data = await service.agregarFrecuente(req.user.negocio_id, sucursalId, Number(req.params.clienteId));
    res.status(201).json({ ok: true, data, message: 'Cliente agregado a frecuentes' });
  } catch (err) { next(err); }
};
 
const quitarFrecuente = async (req, res, next) => {
  try {
    const sucursalId = req.sucursal_id;
    if (!sucursalId) return res.status(400).json({ ok: false, error: 'Sucursal requerida' });
    await service.quitarFrecuente(sucursalId, Number(req.params.clienteId));
    res.json({ ok: true, message: 'Cliente eliminado de frecuentes' });
  } catch (err) { next(err); }
};

module.exports = { getClientes, getClienteById, buscarPorCedula, crearCliente, actualizarCliente,getFrecuentes,agregarFrecuente,quitarFrecuente };