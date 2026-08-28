import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
  const queryClient = useQueryClient();

  const login = async (email, password) => {
    // Limpiar todo el caché de React Query — evita que datos de un negocio
    // anterior aparezcan al entrar a otro negocio sin recargar la página
    queryClient.clear();

    // Reset del store de sucursal — evita que sucursal_id de otra sesión
    // se inyecte en el interceptor mientras se resuelve la nueva selección
    useSucursalStore.getState().reset();

    const { data } = await loginApi(email, password);

    sessionStorage.setItem('accessToken', data.accessToken);
    sessionStorage.setItem('usuario', JSON.stringify(data.usuario));

    // Si el backend retorna sucursales (admin_negocio), las inyectamos
    // inmediatamente en el store — sucursalActiva queda válida antes de
    // que monte cualquier componente, sin necesidad de clic manual.
    if (Array.isArray(data.sucursales) && data.sucursales.length > 0) {
      useSucursalStore.getState().setSucursales(data.sucursales, data.usuario.negocio_id);
    }

    setUsuario(data.usuario);
    return data.usuario;
  };

  const logout = async () => {
    try {
      await logoutApi();
    } catch (e) {
      console.error(e);
    }
    // Limpiar caché al cerrar sesión — misma razón que en login
    queryClient.clear();
    sessionStorage.removeItem('accessToken');
    sessionStorage.removeItem('usuario');
    useSucursalStore.getState().reset();
    setUsuario(null);
  };

  const esAdminNegocio = () => usuario?.rol === 'admin_negocio';
  const esSupervisor   = () => ['admin_negocio', 'supervisor'].includes(usuario?.rol);
  const esVendedor     = () => !!usuario;

  // Devuelve true si sucursalId es una sucursal de solo lectura asignada al usuario
  const esSucursalVista = (sucursalId) => {
    if (!sucursalId || !Array.isArray(usuario?.sucursales_vista)) return false;
    return usuario.sucursales_vista.includes(sucursalId) && sucursalId !== usuario.sucursal_id;
  };

  // true si el usuario puede abrir los modales de edición de productos
  const puedeEditarProductos = () => {
    if (usuario?.rol === 'admin_negocio') return true;
    return usuario?.permisos_edicion_productos?.puede_editar === true;
  };

  // null = admin (todos los campos); array = campos permitidos para el usuario
  const camposEdicionProductos = () => {
    if (usuario?.rol === 'admin_negocio') return null;
    return usuario?.permisos_edicion_productos?.campos ?? [];
  };

  // ── Facturas ya emitidas: editar / cancelar ────────────────────────────────
  //
  // Espeja `requirePermisoFacturas` del backend, incluido su detalle importante:
  // `permisos_facturas` en null NO es "no puede", es "permisos base del rol",
  // que es como funcionaba antes de que existiera el permiso. Si esto dijera
  // `=== true` a secas, aplicar la feature le quitaría el botón a todos los
  // supervisores del sistema.
  //
  // Es solo para pintar la pantalla: quien manda es el backend.
  const _permisoFactura = (clave) => {
    if (usuario?.rol === 'admin_negocio') return true;
    const permisos = usuario?.permisos_facturas;
    if (permisos && typeof permisos === 'object') return permisos[clave] === true;
    return usuario?.rol === 'supervisor';
  };

  const puedeEditarFacturas   = () => _permisoFactura('puede_editar');
  const puedeCancelarFacturas = () => _permisoFactura('puede_cancelar');

  const puedeExportarInventario = () => {
    if (usuario?.rol === 'admin_negocio') return true;
    return usuario?.permisos_edicion_productos?.puede_exportar === true;
  };

  const puedeExportarInventarioGlobal = () => {
    if (usuario?.rol === 'admin_negocio') return true;
    return usuario?.permisos_edicion_productos?.puede_exportar_global === true;
  };

  return (
    <AuthContext.Provider value={{
      usuario,
      login,
      logout,
      esAdminNegocio,
      esSupervisor,
      esVendedor,
      esSucursalVista,
      puedeEditarProductos,
      camposEdicionProductos,
      puedeEditarFacturas,
      puedeCancelarFacturas,
      puedeExportarInventario,
      puedeExportarInventarioGlobal,
    }}>
      {children}
    </AuthContext.Provider>
  );
}