// src/config/modulos.js
// ─────────────────────────────────────────────────────────────────────────────
// Fuente única de verdad para módulos del sistema.
// Usado en backend (middleware, servicio) y exportado para el frontend.
//
// IMPORTANTE: las claves deben coincidir exactamente con las rutas del Navbar.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Definición de todos los módulos disponibles en el sistema.
 * El campo `label` es solo para mostrar en la UI de admin.
 */
const MODULOS = [
  { key: 'inventario',  label: 'Inventario'  },
  { key: 'facturar',    label: 'Facturas'    },
  { key: 'servicios',   label: 'Servicios'   },
  { key: 'proveedores', label: 'Proveedores' },
  { key: 'prestamos',   label: 'Préstamos'   },
  { key: 'caja',        label: 'Caja'        },
  { key: 'traslados',   label: 'Traslados'   },
  { key: 'reportes',    label: 'Reportes'    },
  { key: 'acreedores',  label: 'Acreedores'  },
  // 'config' y 'inicio' (dashboard) NO aparecen aquí:
  //   - config:  solo admin_negocio, siempre, sin excepción
  //   - inicio:  solo admin_negocio, siempre, sin excepción
];

/**
 * Permisos base por rol.
 * El admin puede modificar estos defaults al crear/editar un usuario.
 * admin_negocio siempre tiene acceso total — este objeto no aplica para él.
 */
const PERMISOS_BASE = {
  supervisor: [
    'inventario',
    'facturar',
    'servicios',
    'proveedores',
    'prestamos',
    'caja',
    'traslados',
    'reportes',
    'acreedores',
  ],
  vendedor: [
    'inventario',
    'facturar',
    'servicios',
    'prestamos',
  ],
};

/**
 * Dado un rol y opcionalmente un array de módulos guardados en BD,
 * retorna el array efectivo de módulos permitidos.
 *
 * - Si modulosGuardados es NULL → usar permisos base del rol.
 * - Si modulosGuardados es un array → usar ese array (personalizado).
 * - Si rol es admin_negocio → siempre retorna null (acceso total).
 *
 * @param {string}        rol
 * @param {string[]|null} modulosGuardados
 * @returns {string[]|null} null = acceso total
 */
function resolverModulos(rol, modulosGuardados) {
  if (rol === 'admin_negocio') return null; // acceso total
  if (modulosGuardados !== null && modulosGuardados !== undefined) {
    return modulosGuardados;
  }
  return PERMISOS_BASE[rol] || [];
}

/**
 * Verifica si un usuario tiene acceso a un módulo específico.
 *
 * @param {object} usuario  - Debe tener { rol, modulos_permitidos }
 * @param {string} modulo   - Clave del módulo a verificar
 * @returns {boolean}
 */
function tieneAcceso(usuario, modulo) {
  if (!usuario) return false;
  if (usuario.rol === 'admin_negocio') return true;
  const efectivos = resolverModulos(usuario.rol, usuario.modulos_permitidos);
  if (efectivos === null) return true;
  return efectivos.includes(modulo);
}

module.exports = { MODULOS, PERMISOS_BASE, resolverModulos, tieneAcceso };