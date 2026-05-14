import api from './axios.config';

export const getTipos      = ()           => api.get('/tipos-caracteristica');
export const crearTipo     = (data)       => api.post('/tipos-caracteristica', data);
export const actualizarTipo = (id, data)  => api.put(`/tipos-caracteristica/${id}`, data);
export const eliminarTipo  = (id)         => api.delete(`/tipos-caracteristica/${id}`);
