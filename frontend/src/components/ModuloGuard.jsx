// src/components/ModuloGuard.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Guard de ruta que redirige al usuario si no tiene acceso al módulo.
// Envuelve las rutas protegidas en el router principal.
//
// Uso en App.jsx / router:
//   <ModuloGuard modulo="caja">
//     <CajaPage />
//   </ModuloGuard>
// ─────────────────────────────────────────────────────────────────────────────

import { Navigate } from 'react-router-dom';
import { usePermisos } from '../hooks/usePermisos';

/**
 * @param {{ modulo: string, children: React.ReactNode }} props
 */
export function ModuloGuard({ modulo, children }) {
  const { puedeVer } = usePermisos();

  if (!puedeVer(modulo)) {
    return <Navigate to="/sin-acceso" replace />;
  }

  return children;
}