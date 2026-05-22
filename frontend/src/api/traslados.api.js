import api from './axios.config';

export const buscarEquivalentes = (data) =>
  api.post('/traslados/buscar-equivalentes', data);

export const ejecutarTraslado = (data) =>
  api.post('/traslados', data);

export const getTraslados = () =>
  api.get('/traslados');

export const getTrasladoById = (id) =>
  api.get(`/traslados/${id}`);

export const revertirTraslado = (id) =>
  api.post(`/traslados/${id}/revertir`);

export const buscarProductosEnSucursal = (sucursalId, tipo, q) =>
  api.get(`/traslados/sucursal/${sucursalId}/productos`, { params: { tipo, q } });

export const getCatalogoSucursal = (sucursalId, tipo, q) =>
  api.get(`/traslados/sucursal/${sucursalId}/catalogo`, { params: { tipo, q: q || '' } });

export const buscarSerialesProducto = (sucursalId, productoSerialId) =>
  api.get(`/traslados/sucursal/${sucursalId}/seriales-producto/${productoSerialId}`);