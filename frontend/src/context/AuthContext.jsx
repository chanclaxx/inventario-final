import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AuthContext } from './AuthContext.js';
import { login as loginApi, logout as logoutApi, restaurarSesion } from '../api/auth.api';
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
  // ── Por qué hace falta un estado de "todavía no sé" ────────────────────────
  //
  // Sin él, el primer render sale con `usuario = null` y `PrivateRoute` manda al
  // login ANTES de que la restauración termine. El usuario vería el login por un
  // instante y perdería la ruta a la que iba —justo la de la notificación que
  // acaba de tocar—, que es el problema que esto viene a resolver.
  //
  // Arranca en `true` solo cuando NO hay usuario guardado: si la pestaña sigue
  // viva no hay nada que restaurar y la app no tiene por qué esperar.
  const [restaurando, setRestaurando] = useState(() => getUsuarioInicial() === null);
  const queryClient = useQueryClient();

  // ── Cerrar la PWA ya no es cerrar sesión ──────────────────────────────────
  //
  // `sessionStorage` muere con la pestaña; la cookie de refresco (httpOnly, 7
  // días) no. Al abrir sin usuario en memoria se cambia esa cookie por una
  // sesión nueva, sin pedir la contraseña.
  //
  // Un 401 aquí es el caso NORMAL —nadie ha entrado nunca en este navegador, o
  // la cookie caducó— y por eso no se trata como error ni se registra: solo deja
  // el login a la vista, que es lo que corresponde.
  //
  // Cerrar sesión a propósito SÍ borra la cookie en el servidor
  // (`POST /auth/logout` hace `clearCookie`), así que esto no resucita una
  // sesión que el usuario cerró.
  useEffect(() => {
    if (!restaurando) return;
    let vigente = true;

    (async () => {
      try {
        const { data } = await restaurarSesion();
        if (!vigente || !data?.accessToken || !data?.usuario) return;

        sessionStorage.setItem('accessToken', data.accessToken);
        sessionStorage.setItem('usuario', JSON.stringify(data.usuario));

        // Las sucursales van ANTES de `setUsuario`, igual que en el login: si el
        // store queda vacío, el interceptor manda las peticiones sin
        // `sucursal_id` y el admin ve el inventario de la nada.
        if (Array.isArray(data.sucursales) && data.sucursales.length > 0) {
          useSucursalStore.getState().setSucursales(data.sucursales, data.usuario.negocio_id);
        }
        setUsuario(data.usuario);
      } catch {
        // Sin sesión que restaurar. Es lo esperado la primera vez.
      } finally {
        if (vigente) setRestaurando(false);
      }
    })();

    return () => { vigente = false; };
  }, [restaurando]);

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
    // Cerrar sesión a propósito no puede quedar esperando una restauración: la
    // cookie ya no existe y el único destino correcto es el login.
    setRestaurando(false);
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
      restaurando,
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