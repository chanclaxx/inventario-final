import api from './axios.config';

export const getPrestatarios  = ()           => api.get('/prestatarios');
export const crearPrestatario = (datos)      => api.post('/prestatarios', datos);
export const getEmpleados     = (id)         => api.get(`/prestatarios/${id}/empleados`);
export const crearEmpleado    = (id, datos)  => api.post(`/prestatarios/${id}/empleados`, datos);