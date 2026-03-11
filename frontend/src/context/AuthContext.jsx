import { useState } from 'react';
import { AuthContext } from './AuthContext.js';
import { login as loginApi, loginConNegocio as loginConNegocioApi, logout as logoutApi } from '../api/auth.api';

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

  /**
   * Paso 1 — sin negocio_id.
   * Retorna { usuario } si el login fue directo,
   * o { requiere_seleccion: true, negocios: [...] } si hay que elegir negocio.
   */
  const login = async (email, password) => {
    const { data } = await loginApi(email, password);

    if (data.requiere_seleccion) {
      // Devolvemos la lista al componente que llama; no guardamos nada todavía
      return { requiere_seleccion: true, negocios: data.negocios };
    }

    sessionStorage.setItem('accessToken', data.accessToken);
    sessionStorage.setItem('usuario', JSON.stringify(data.usuario));
    setUsuario(data.usuario);
    return { requiere_seleccion: false, usuario: data.usuario };
  };

  /**
   * Paso 2 — con negocio_id elegido por el usuario.
   * Solo se llama cuando el paso 1 devolvió requiere_seleccion: true.
   */
  const loginNegocio = async (email, password, negocio_id) => {
    const { data } = await loginConNegocioApi(email, password, negocio_id);
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

  const esAdminNegocio = () => usuario?.rol === 'admin_negocio';
  const esSupervisor   = () => ['admin_negocio', 'supervisor'].includes(usuario?.rol);
  const esVendedor     = () => !!usuario;

  return (
    <AuthContext.Provider value={{
      usuario,
      login,
      loginNegocio,
      logout,
      esAdminNegocio,
      esSupervisor,
      esVendedor,
    }}>
      {children}
    </AuthContext.Provider>
  );
}