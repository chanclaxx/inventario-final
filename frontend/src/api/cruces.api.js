import api from './axios.config';

export const getCruces     = ()          => api.get('/cruces');
export const getCruceById  = (id)        => api.get(`/cruces/${id}`);
export const crearCruce    = (datos)     => api.post('/cruces', datos);