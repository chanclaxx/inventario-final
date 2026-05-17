import api from './axios.config';

export const getUsuarios = () => api.get('/usuarios');

export const getActividadUsuarios = (params = {}) =>
  api.get('/usuarios/actividad', { params });
