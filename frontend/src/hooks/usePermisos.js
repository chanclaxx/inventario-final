// src/hooks/usePermisos.js
// ─────────────────────────────────────────────────────────────────────────────
// Hook que expone los permisos del usuario autenticado.
// Lee directamente del contexto de auth — sin llamadas a la BD.
// ─────────────────────────────────────────────────────────────────────────────

import { useAuth } from '../context/useAuth';

/**
 * @returns {{
 *   puedeVer:        (modulo: string) => boolean,
 *   esAdmin:         boolean,
 *   modulosPermitidos: string[] | null,
 * }}
 */
export function usePermisos() {
  const { usuario } = useAuth();

  const esAdmin = usuario?.rol === 'admin_negocio';

  /**
   * Verifica si el usuario tiene acceso a un módulo.
   * admin_negocio siempre retorna true.
   *
   * @param {string} modulo - Clave del módulo (ej: 'facturar', 'caja')
   * @returns {boolean}
   */
  const puedeVer = (modulo) => {
    if (!usuario) return false;
    if (esAdmin)  return true;

    const modulos = usuario.modulos_permitidos;

    // null = usa permisos base del rol (el backend ya los resolvió en el token)
    if (modulos === null || modulos === undefined) return true;

    return Array.isArray(modulos) && modulos.includes(modulo);
  };

  return {
    puedeVer,
    esAdmin,
    modulosPermitidos: usuario?.modulos_permitidos ?? null,
  };
}