import api from './axios.config';

export const getGarantias = () => api.get('/garantias');
export const crearGarantia = (data) => api.post('/garantias', data);
export const actualizarGarantia = (id, data) => api.put(`/garantias/${id}`, data);
export const eliminarGarantia = (id) => api.delete(`/garantias/${id}`);