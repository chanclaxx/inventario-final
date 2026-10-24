// ─────────────────────────────────────────────────────────────────────────────
// Permisos de garantías con proveedores — ESPEJO de
// backend/src/middlewares/role.middleware (`BASE_GARANTIAS`, `puedeGarantias`).
// Solo sirve para pintar la pantalla: quien manda es el backend. Si la base
// cambia allá, cambia aquí.
//
// `permisos_garantias` en null NO es "no puede": son los permisos base del rol.
// ─────────────────────────────────────────────────────────────────────────────

export const LLAVES_GARANTIAS = [
  { id: 'ver',        label: 'Ver las garantías',               desc: 'La pestaña Proveedores → Garantías y el detalle de cada caso' },
  { id: 'recibir',    label: 'Recibir productos en garantía',   desc: 'Abrir un caso desde una factura, un préstamo o el inventario' },
  { id: 'cliente',    label: 'Entregar otra unidad al cliente', desc: 'Sale del stock vendible' },
  { id: 'reembolsar', label: 'Devolver dinero al cliente',      desc: 'Deshace la venta de la línea y sale de la caja' },
  { id: 'enviar',     label: 'Enviar al proveedor',             desc: 'Armar y anular los envíos de garantía' },
  { id: 'resolver',   label: 'Registrar la respuesta del proveedor', desc: 'Repone, repara, nota crédito, devuelve dinero o no lo cubre' },
  { id: 'anular',     label: 'Anular casos y movimientos',      desc: 'Revierte inventario, caja y la cuenta del proveedor' },
];

export const BASE_GARANTIAS = {
  supervisor: { ver: true, recibir: true, cliente: true, reembolsar: true,  enviar: true,  resolver: true,  anular: false },
  vendedor:   { ver: true, recibir: true, cliente: true, reembolsar: false, enviar: false, resolver: false, anular: false },
};

export const puedeGarantias = (usuario, accion) => {
  if (!usuario) return false;
  if (usuario.rol === 'admin_negocio') return true;
  const p = usuario.permisos_garantias;
  if (p && typeof p === 'object' && typeof p[accion] === 'boolean') return p[accion];
  return BASE_GARANTIAS[usuario.rol]?.[accion] === true;
};

/** Los permisos efectivos de un usuario, como objeto completo (para Ajustes). */
export const permisosEfectivosGarantias = (rol, guardados) =>
  Object.fromEntries(LLAVES_GARANTIAS.map(({ id }) => [
    id,
    puedeGarantias({ rol, permisos_garantias: guardados }, id),
  ]));
