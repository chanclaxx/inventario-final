import api from './axios.config';

// Ubicaciones ya usadas en la sucursal activa, con cuántos productos hay en
// cada una: [{ ubicacion: 'Estante A-3', productos: 12 }].
// Alimenta el autocompletado al escribir y el filtro del inventario.
// El catálogo se deriva de los productos — no hay ubicaciones que crear aparte.
export const getUbicaciones = () => api.get('/ubicaciones');
