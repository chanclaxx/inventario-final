import api from './axios.config';

// ─────────────────────────────────────────────────────────────────────────────
// Borradores de venta (carritos guardados con reserva blanda).
//
// Igual que el resto de la capa de API: este archivo es el ÚNICO lugar que arma
// las URLs de borradores. Los componentes y hooks no llaman a axios directamente.
//
// El interceptor inyecta `sucursal_id` automáticamente, así que todas estas
// rutas operan sobre la sucursal activa — que es exactamente el alcance de los
// borradores: los de Sansur no existen para Principal. Al cambiar de sucursal,
// SucursalSelector invalida todas las queries y la lista se recarga sola.
//
// Si el negocio no encendió la feature, el backend responde 404 a todo esto.
// ─────────────────────────────────────────────────────────────────────────────

// Lista de la sucursal activa, con sus ítems y el total ya derivado.
// Alimenta a la vez la lista bajo el carrito y el índice de reservas.
export const getBorradores = () => api.get('/borradores');

// Trae el borrador REVALIDADO contra el inventario de hoy:
//   data.items          → lo que todavía se puede vender (con `stock` fresco)
//   data.no_disponibles → lo que ya no, cada uno con su `motivo`
// Un ítem con menos stock del apalabrado llega en `items` con la cantidad
// ajustada y un `aviso`.
export const getBorrador = (id) => api.get(`/borradores/${id}`);

// `items` es el carrito tal cual: el backend traduce `precioFinal` → `precio_final`.
// { titulo, destino: 'factura'|'prestamo'|'indefinido', nota, items }
export const crearBorrador = (datos) => api.post('/borradores', datos);

// Solo cabecera (titulo / destino / nota). Los ítems no se editan aquí: para
// cambiarlos se carga el borrador al carrito y se vuelve a guardar.
export const editarBorrador = (id, datos) => api.patch(`/borradores/${id}`, datos);

// Renueva la vigencia. Se llama al cargar el borrador al carrito: el que se
// sigue trabajando no debería vencerse por el camino.
export const renovarBorrador = (id) => api.patch(`/borradores/${id}/renovar`);

export const eliminarBorrador = (id) => api.delete(`/borradores/${id}`);

// El "robo": el producto estaba apalabrado en otro borrador y el vendedor
// decide llevárselo a este carrito. Si el borrador queda vacío, el backend lo
// descarta y lo informa en `data.borrador_eliminado`.
export const quitarItemBorrador = (borradorId, itemId) =>
  api.delete(`/borradores/${borradorId}/items/${itemId}`);
