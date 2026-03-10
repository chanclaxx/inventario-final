import api from './axios.config';

export const getConfig = () => api.get('/config');