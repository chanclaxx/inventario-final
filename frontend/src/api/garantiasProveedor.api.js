import api from './axios.config';

// Garantías con proveedores (Proveedores → Garantías).
// Ver backend/migrations/20261023_reclamos_garantia.sql.

export const getConfigGarantias   = ()             => api.get('/garantias-proveedor/config');
export const getEnGarantia        = ()             => api.get('/garantias-proveedor/en-inventario');
export const buscarCandidatos     = (params)       => api.get('/garantias-proveedor/candidatos', { params });

export const getGarantias         = (params)       => api.get('/garantias-proveedor', { params });
export const getGarantia          = (id)           => api.get(`/garantias-proveedor/${id}`);
export const crearGarantia        = (datos)        => api.post('/garantias-proveedor', datos);
export const anularGarantia       = (id, motivo)   => api.patch(`/garantias-proveedor/${id}/anular`, { motivo });

export const resolverCliente      = (lineaId, datos) => api.post(`/garantias-proveedor/lineas/${lineaId}/cliente`, datos);
export const resolverProveedor    = (lineaId, datos) => api.post(`/garantias-proveedor/lineas/${lineaId}/proveedor`, datos);
export const anularMovimiento     = (movId, motivo)  => api.patch(`/garantias-proveedor/movimientos/${movId}/anular`, { motivo });

export const crearEnvioGarantia   = (datos)        => api.post('/garantias-proveedor/envios', datos);
export const getEnvioGarantia     = (id)           => api.get(`/garantias-proveedor/envios/${id}`);
export const anularEnvioGarantia  = (id, motivo)   => api.patch(`/garantias-proveedor/envios/${id}/anular`, { motivo });

// Estado de cuenta de las garantías con un proveedor.
export const getEstadoCuentaGarantias = (proveedorId, params) => api.get(`/garantias-proveedor/proveedores/${proveedorId}/estado-cuenta`, { params });
export const rutaPdfEstadoCuentaGarantias = (proveedorId, { desde, hasta } = {}) => {
  const q = new URLSearchParams(Object.entries({ desde, hasta }).filter(([, v]) => v)).toString();
  return `/garantias-proveedor/proveedores/${proveedorId}/estado-cuenta/pdf${q ? `?${q}` : ''}`;
};

// Fotos del producto dañado (almacenamiento privado: se bajan como blob, con sesión).
export const adjuntarFotoGarantia = (reclamoId, archivo, nota) => {
  const datos = new FormData();
  datos.append('archivo', archivo);
  if (nota) datos.append('nota', nota);
  return api.post(`/garantias-proveedor/${reclamoId}/archivos`, datos, { timeout: 120000 });
};
export const bajarFotoGarantia  = (archivoId) => api.get(`/garantias-proveedor/archivos/${archivoId}/descargar`, { responseType: 'blob', timeout: 120000 });
export const anularFotoGarantia = (archivoId, motivo) => api.patch(`/garantias-proveedor/archivos/${archivoId}/anular`, { motivo });

// Las rutas de los PDF (las baja `useExportarPdfGarantia`).
export const rutaPdfGarantia      = (id)           => `/garantias-proveedor/${id}/pdf`;
export const rutaPdfEnvioGarantia = (id)           => `/garantias-proveedor/envios/${id}/pdf`;
