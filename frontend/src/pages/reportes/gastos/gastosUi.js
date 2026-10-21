// Centro de gastos — piezas compartidas por las pantallas (sin React).
import {
  Home, Users, Zap, Wifi, Monitor, Briefcase, Truck, Megaphone, Wrench,
  ClipboardList, CreditCard, Landmark, Coffee, Tag, ShieldCheck, Car, Sparkles,
  Package, HeartPulse, GraduationCap,
} from 'lucide-react';

// Íconos por clave. Se leen por ACCESO A PROPIEDAD (`ICONOS_GASTO[x] ?? Tag`),
// nunca desde una función: el linter lo toma como crear un componente en cada
// render (react-hooks/static-components).
export const ICONOS_GASTO = {
  home: Home, users: Users, zap: Zap, wifi: Wifi, monitor: Monitor, briefcase: Briefcase,
  truck: Truck, megaphone: Megaphone, wrench: Wrench, clipboard: ClipboardList,
  'credit-card': CreditCard, landmark: Landmark, coffee: Coffee, tag: Tag,
  shield: ShieldCheck, car: Car, sparkles: Sparkles, package: Package,
  health: HeartPulse, education: GraduationCap,
};
export const ICONO_POR_DEFECTO = Tag;

export const PALETA = [
  '#6366F1', '#8B5CF6', '#0EA5E9', '#06B6D4', '#14B8A6', '#22C55E', '#84CC16',
  '#F59E0B', '#F97316', '#EF4444', '#EC4899', '#A16207', '#64748B', '#9CA3AF',
];

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export const hoyBogota = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
export const mesActual = () => hoyBogota().slice(0, 7);

export const sumarMes = (mes, n) => {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export const nombreMes = (mes, { conAnio = true } = {}) => {
  const [y, m] = mes.split('-').map(Number);
  const n = MESES[m - 1];
  const cap = n.charAt(0).toUpperCase() + n.slice(1);
  return conAnio ? `${cap} ${y}` : cap;
};
export const mesCorto = (mes) => nombreMes(mes, { conAnio: false }).slice(0, 3);

export const diasDelMes = (mes) => {
  const [y, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

// 'YYYY-MM-DD' → «lunes 13 de octubre»
export const fechaLarga = (f) => {
  const [y, m, d] = f.split('-').map(Number);
  const dia = DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dia} ${d} de ${MESES[m - 1]}`;
};

export const sumarDias = (f, n) => {
  const [y, m, d] = f.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

export const formatCompacto = (valor) => {
  const n = Number(valor) || 0;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace('.0', '')}M`;
  if (abs >= 1_000)     return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
};

const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

// Espejo de gastos.util.calcularValores del backend, solo para MOSTRAR el total
// mientras se escribe (el backend lo vuelve a calcular y es el que manda): con
// subtotal (o cantidad × unitario) el total se calcula; si no, el escrito.
export const totalCalculado = (d) => {
  let subtotal = num(d.subtotal);
  const cantidad = num(d.cantidad);
  const unitario = num(d.valor_unitario);
  if (subtotal === null && cantidad !== null && unitario !== null) subtotal = cantidad * unitario;
  if (subtotal === null) return { calculado: false, total: num(d.valor_total) };
  return { calculado: true, total: Math.round((subtotal + (num(d.iva) ?? 0) - (num(d.retenciones) ?? 0)) * 100) / 100 };
};

export const mensajeError = (e, porDefecto = 'No se pudo guardar. Intenta de nuevo.') =>
  e?.response?.data?.error || porDefecto;
