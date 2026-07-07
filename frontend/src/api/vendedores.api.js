import api from './axios.config';

// ── Vendedores ────────────────────────────────────────────────────────────────

// Gestión del admin: todos los vendedores del negocio (opcional: por sucursal).
export const getVendedores = (params = {}) =>
  api.get('/vendedores', { params });

// Para el desplegable de facturación: solo activos de la sucursal activa.
// La sucursal se resuelve en el backend (req.sucursal_id).
export const getVendedoresActivos = () =>
  api.get('/vendedores/activos');

export const crearVendedor = (datos) =>
  api.post('/vendedores', datos);

export const actualizarVendedor = (id, datos) =>
  api.patch(`/vendedores/${id}`, datos);
