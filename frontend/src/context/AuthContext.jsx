import { useState } from 'react';
import { AuthContext } from './AuthContext.js';
import { login as loginApi, logout as logoutApi } from '../api/auth.api';
import useSucursalStore from '../store/sucursalStore';

function getUsuarioInicial() {
  try {
    const guardado = sessionStorage.getItem('usuario');
    return guardado ? JSON.parse(guardado) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(getUsuarioInicial);

  const login = async (email, password) => {
    // Limpiar sucursal persistida de sesiones anteriores antes de establecer
    // la nueva sesión — evita que el interceptor inyecte un sucursal_id
    // de otro negocio mientras se resuelve la nueva selección
    useSucursalStore.getState().reset();

    const { data } = await loginApi(email, password);
    sessionStorage.setItem('accessToken', data.accessToken);
    sessionStorage.setItem('usuario', JSON.stringify(data.usuario));
    setUsuario(data.usuario);
    return data.usuario;
  };

  const logout = async () => {
    try {
      await logoutApi();
    } catch (e) {
      console.error(e);
    }
    sessionStorage.removeItem('accessToken');
    sessionStorage.removeItem('usuario');
    useSucursalStore.getState().reset();
    setUsuario(null);
  };

  const esAdminNegocio = () => usuario?.rol === 'admin_negocio';
  const esSupervisor   = () => ['admin_negocio', 'supervisor'].includes(usuario?.rol);
  const esVendedor     = () => !!usuario;

  return (
    <AuthContext.Provider value={{
      usuario,
      login,
      logout,
      esAdminNegocio,
      esSupervisor,
      esVendedor,
    }}>
      {children}
    </AuthContext.Provider>
  );
}