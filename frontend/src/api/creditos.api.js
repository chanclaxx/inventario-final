import api from './axios.config';

export const getCreditos = () => api.get('/creditos');
export const getCreditoById = (id) => api.get(`/creditos/${id}`);
export const registrarAbonoCredito = (id, data) =>
  api.post(`/creditos/${id}/abonos`, data);
export const saldarCredito = (id) => api.patch(`/creditos/${id}/saldar`);