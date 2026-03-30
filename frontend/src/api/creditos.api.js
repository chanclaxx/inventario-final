import api from './axios.config';

export const getCreditos = () => api.get('/creditos');

export const getCreditoById = (id) => api.get(`/creditos/${id}`);

export const registrarAbonoCredito = (creditoId, datos) =>
  api.post(`/creditos/${creditoId}/abonos`, datos);

export const saldarCredito = (creditoId) =>
  api.patch(`/creditos/${creditoId}/saldar`);

export const cancelarCredito = (creditoId) =>
  api.patch(`/creditos/${creditoId}/cancelar`);