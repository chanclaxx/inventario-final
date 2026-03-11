import { useState } from 'react';
import { AuthContext } from './AuthContext.js';
import { login as loginApi, logout as logoutApi } from '../api/auth.api';

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
    setUsuario(null);
  };

  // admin_negocio es el único con acceso total al negocio
  const esAdminNegocio = () => usuario?.rol === 'admin_negocio';

  // supervisor y admin_negocio pueden gestionar su sucursal
  const esSupervisor = () => ['admin_negocio', 'supervisor'].includes(usuario?.rol);

  // Cualquier usuario autenticado puede vender
  const esVendedor = () => !!usuario;

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