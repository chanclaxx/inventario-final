import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/useAuth.js';

export function PrivateRoute({ children, rol }) {
  const { usuario, esAdminNegocio, esSupervisor } = useAuth();

  if (!usuario) return <Navigate to="/login" replace />;

  // Si la ruta requiere un rol específico, verificar jerarquía
  if (rol === 'admin_negocio' && !esAdminNegocio()) {
    return <Navigate to="/" replace />;
  }
  if (rol === 'supervisor' && !esSupervisor()) {
    return <Navigate to="/" replace />;
  }

  return children;
}