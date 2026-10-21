import api from './axios.config';

// Centro de gastos (Reportes → Gastos). Todas las claves de React Query de
// este módulo empiezan por 'gastos', que está en REPORT_QUERY_KEYS: cualquier
// mutación del sistema refresca la pestaña y Proyección.
export const getResumenGastos      = (mes)          => api.get('/gastos/resumen', { params: { mes } });
export const getGastos             = (mes, anulados) => api.get('/gastos', { params: { mes, anulados: anulados ? '1' : undefined } });
export const getEstadoResultados   = (mes)          => api.get('/gastos/estado-resultados', { params: { mes }, timeout: 120000 });
export const getGastosPeriodo      = (desde, hasta) => api.get('/gastos/periodo', { params: { desde, hasta } });
export const registrarGasto        = (datos)        => api.post('/gastos', datos);
export const editarGasto           = (id, datos)    => api.patch(`/gastos/${id}`, datos);
export const anularGasto           = (id, motivo)   => api.post(`/gastos/${id}/anular`, { motivo });

export const getCategoriasGasto    = (todas)        => api.get('/gastos/categorias', { params: { todas: todas ? '1' : undefined } });
export const crearCategoriaGasto   = (datos)        => api.post('/gastos/categorias', datos);
export const editarCategoriaGasto  = (id, datos)    => api.patch(`/gastos/categorias/${id}`, datos);

export const getRecurrentes        = (todos)        => api.get('/gastos/recurrentes', { params: { todos: todos ? '1' : undefined } });
export const crearRecurrente       = (datos)        => api.post('/gastos/recurrentes', datos);
export const editarRecurrente      = (id, datos)    => api.patch(`/gastos/recurrentes/${id}`, datos);
export const confirmarRecurrente   = (id, datos)    => api.post(`/gastos/recurrentes/${id}/confirmar`, datos);
