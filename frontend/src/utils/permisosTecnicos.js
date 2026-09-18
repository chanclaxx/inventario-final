// ─────────────────────────────────────────────────────────────────────────────
// Permisos de técnicos externos — ESPEJO de backend/src/middlewares/role.middleware
// (`BASE_TECNICOS`, `puedeTecnicos`). Solo sirve para pintar la pantalla: quien
// manda es el backend. Si la base cambia allá, cambia aquí.
//
// `permisos_tecnicos` en null NO es "no puede": son los permisos base del rol.
// ─────────────────────────────────────────────────────────────────────────────

export const LLAVES_TECNICOS = [
  { id: 'mover',     label: 'Enviar y recibir equipos',      desc: 'Mandar equipos al técnico y recibirlos de vuelta' },
  { id: 'pagar',     label: 'Pagar y dar anticipos',         desc: 'Mueve la caja de la sucursal' },
  { id: 'anular',    label: 'Anular pagos',                  desc: 'Revierte un pago en caja y tesorería' },
  { id: 'gestionar', label: 'Crear y editar técnicos',       desc: 'La lista de técnicos del negocio' },
];

export const BASE_TECNICOS = {
  supervisor: { mover: true, pagar: true,  anular: false, gestionar: false },
  vendedor:   { mover: true, pagar: false, anular: false, gestionar: false },
};

export const puedeTecnicos = (usuario, accion) => {
  if (!usuario) return false;
  if (usuario.rol === 'admin_negocio') return true;
  const p = usuario.permisos_tecnicos;
  if (p && typeof p === 'object' && typeof p[accion] === 'boolean') return p[accion];
  return BASE_TECNICOS[usuario.rol]?.[accion] === true;
};

/** Los permisos efectivos de un usuario, como objeto completo (para Ajustes). */
export const permisosEfectivosTecnicos = (rol, guardados) =>
  Object.fromEntries(LLAVES_TECNICOS.map(({ id }) => [
    id,
    puedeTecnicos({ rol, permisos_tecnicos: guardados }, id),
  ]));
