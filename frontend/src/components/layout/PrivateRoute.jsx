import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/useAuth.js';

export function PrivateRoute({ children, rol }) {
  const { usuario, restaurando, esAdminNegocio, esSupervisor } = useAuth();

  // ── Esperar a saber si hay sesión, antes de decidir ───────────────────────
  //
  // Al abrir la PWA el usuario todavía no está en memoria (sessionStorage muere
  // con la pestaña) y AuthContext lo está recuperando de la cookie de refresco.
  // Sin esta espera, el primer render manda al login y se PIERDE la ruta a la
  // que se iba — que en una notificación es justamente lo que se venía a ver.
  //
  // Es una pantalla en blanco de milisegundos: poner un spinner aquí haría
  // parpadear un cargando en cada navegación protegida.
  if (restaurando) return null;

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