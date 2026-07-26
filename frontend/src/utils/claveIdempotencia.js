/**
 * Clave de idempotencia para operaciones que mueven plata o inventario.
 *
 * El backend guarda esta clave con UNIQUE: si el usuario toca el botón dos
 * veces, se le va la señal a mitad del POST o el navegador reintenta, la
 * segunda petición devuelve la MISMA operación en vez de crear otra.
 *
 * Se genera de forma perezosa desde un manejador de evento (nunca durante el
 * render) para no romper la pureza de los componentes.
 *
 * Uso:
 *   const clave = useClaveIdempotencia();
 *   ...
 *   mutationFn: () => api.post('/x', { clave_idempotencia: clave() })
 */
import { useRef, useCallback } from 'react';

const generar = () => {
  // crypto.randomUUID solo existe en contextos seguros (https/localhost).
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const aleatorio = typeof crypto !== 'undefined' && crypto.getRandomValues
    ? crypto.getRandomValues(new Uint32Array(2)).join('')
    : String(Date.now());
  return `k-${Date.now().toString(36)}-${aleatorio}`;
};

export function useClaveIdempotencia() {
  const ref = useRef(null);
  // Estable entre renders: mientras el modal siga abierto, la clave es la misma.
  return useCallback(() => {
    if (ref.current === null) ref.current = generar();
    return ref.current;
  }, []);
}
