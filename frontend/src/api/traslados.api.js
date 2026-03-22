import api from './axios.config';

export const buscarEquivalentes = (data) =>
  api.post('/traslados/buscar-equivalentes', data);

export const ejecutarTraslado = (data) =>
  api.post('/traslados', data);

export const getTraslados = () =>
  api.get('/traslados');

export const getTrasladoById = (id) =>
  api.get(`/traslados/${id}`);