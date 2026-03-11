import api from './axios.config';

export const login = (email, password) =>
  api.post('/auth/login', { email, password });

export const loginConNegocio = (email, password, negocio_id) =>
  api.post('/auth/login', { email, password, negocio_id });

export const logout = () =>
  api.post('/auth/logout');

export const getMe = () =>
  api.get('/auth/me');