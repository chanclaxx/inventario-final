import api from './axios.config';

export const getConfig     = ()       => api.get('/config');
export const saveConfig    = (datos)  => api.put('/config', datos);
export const verificarPin  = (pin)    => api.post('/config/verificar-pin', { pin });