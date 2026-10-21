// ─────────────────────────────────────────────────────────────────────────────
// REPORTES COMPLETOS POR USUARIO — `permisos_reportes.ver_todo`
//
// Ajustes → Usuarios gana una casilla «Ver todos los reportes» que solo se ve
// con el módulo Reportes. Encendida, el supervisor o vendedor ve las pestañas
// que eran del admin (Resumen, Análisis, Proyección, Inventario) y las de
// supervisor, en SU sede. Apagada por defecto.
//
// Lo que hay que mirar primero es la sección 1: con el permiso ausente —que es
// lo que tienen TODOS los usuarios el día del despliegue— cada ruta responde
// exactamente lo de antes. La 3 es la otra baranda: el permiso solo LEE;
// corregir costos y editar gastos fijos siguen siendo del admin.
//
// No necesita base de datos: el permiso viaja en el JWT y los controladores van
// stubbeados para ver quién llega y quién no.
//
//   node scripts/pruebas-red-interna/81-permisos-reportes.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');
const FRONT = path.resolve(RAIZ, '../frontend/src');

let fallos = 0, pasados = 0;
const checkEq = (etiqueta, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (ok) { pasados++; console.log(`  ✓ ${etiqueta}`); }
  else    { fallos++;  console.log(`  ✗ ${etiqueta} — dio ${JSON.stringify(real)}, esperaba ${JSON.stringify(esperado)}`); }
};
const check = (etiqueta, cond) => checkEq(etiqueta, !!cond, true);

// ─── Rutas reales con los controladores stubbeados ──────────────────────────
// El pool se parcha ANTES de cargar el controlador: el alcance «negocio» del
// admin lee las sedes de la base.
const { pool } = require(path.join(RAIZ, 'src/config/db'));
pool.query = async () => ({ rows: [{ id: 1 }, { id: 2 }] });

const asesor = require(path.join(RAIZ, 'src/modules/reportes/asesor.service'));
let ultimoAsesor = null;
asesor.getAnalisisAsesor = async (negocioId, opts) => { ultimoAsesor = opts; return { ok: true }; };

const ctrl = require(path.join(RAIZ, 'src/modules/reportes/reportes.controller'));
const STUBS = [
  'getDashboard', 'getVentasRango', 'getAnalisis', 'exportarPdf', 'getProyeccion',
  'exportarProyeccionPdf', 'listarGastosFijos', 'crearGastoFijo', 'actualizarGastoFijo',
  'eliminarGastoFijo', 'getVentasPorVendedor', 'getProductosTop', 'getInventarioBajo',
  'actualizarCostoCompra', 'getValorInventario',
];
for (const n of STUBS) ctrl[n] = (req, res) => res.json({ llego: n });
// getAnalisisAsesor se deja REAL: es el que decide el alcance.

const router = require(path.join(RAIZ, 'src/modules/reportes/reportes.routes'));
const express = require('express');

let usuarioActual = null;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = usuarioActual; req.sucursal_id = 7; next(); });
app.use('/reportes', router);
const server = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
const puerto = server.address().port;

const R = '?desde=2026-10-01&hasta=2026-10-19';
const pedir = async (user, metodo, ruta) => {
  usuarioActual = user;
  const r = await fetch(`http://127.0.0.1:${puerto}/reportes${ruta}`, {
    method: metodo, headers: { 'content-type': 'application/json' },
    body: metodo === 'GET' ? undefined : JSON.stringify({ nombre: 'Arriendo', valor: 100 }),
  });
  if (!r.ok) return r.status;
  const j = await r.json();
  return j.llego ?? 'asesor';
};

const LECTURAS = [
  ['/dashboard',              'getDashboard'],
  [`/ventas-rango${R}`,       'getVentasRango'],
  [`/analisis${R}`,           'getAnalisis'],
  [`/analisis/pdf${R}`,       'exportarPdf'],
  [`/analisis/asesor${R}`,    'asesor'],
  ['/proyeccion',             'getProyeccion'],
  ['/proyeccion/pdf',         'exportarProyeccionPdf'],
  ['/gastos-fijos',           'listarGastosFijos'],
  [`/ventas-vendedor${R}`,    'getVentasPorVendedor'],
  [`/productos-top${R}`,      'getProductosTop'],
  ['/inventario-bajo',        'getInventarioBajo'],
  ['/inventario/valor',       'getValorInventario'],
];
const DE_SUPERVISOR = new Set(['getVentasRango', 'getVentasPorVendedor', 'getProductosTop', 'getInventarioBajo']);

const CON_REPORTES = ['inventario', 'facturar', 'reportes'];
const SIN_REPORTES = ['inventario', 'facturar'];
const u = (rol, permisos_reportes, modulos = CON_REPORTES) => ({
  id: 9, rol, negocio_id: 1, sucursal_id: 7, modulos_permitidos: modulos,
  ...(permisos_reportes === undefined ? {} : { permisos_reportes }),
});
const ADMIN = { id: 1, rol: 'admin_negocio', negocio_id: 1, modulos_permitidos: null };

// ─── 1. Apagado = lo de siempre ─────────────────────────────────────────────
console.log('\n1. Sin el permiso (null, ausente o en false) todo responde como antes');
for (const permiso of [null, undefined, { ver_todo: false }]) {
  const nombre = permiso === undefined ? 'sin la clave (token viejo)' : JSON.stringify(permiso);
  for (const [ruta, ctl] of LECTURAS) {
    const sup = await pedir(u('supervisor', permiso), 'GET', ruta);
    checkEq(`supervisor ${nombre} ${ruta.split('?')[0]}`, sup, DE_SUPERVISOR.has(ctl) ? ctl : 403);
  }
  for (const [ruta, ctl] of LECTURAS) {
    const ven = await pedir(u('vendedor', permiso), 'GET', ruta);
    checkEq(`vendedor ${nombre} ${ruta.split('?')[0]}`, ven, ctl === 'getInventarioBajo' ? ctl : 403);
  }
}
for (const [ruta, ctl] of LECTURAS) {
  checkEq(`admin ${ruta.split('?')[0]}`, await pedir(ADMIN, 'GET', ruta), ctl);
}

// ─── 2. Encendido ───────────────────────────────────────────────────────────
console.log('\n2. Con «Ver todos los reportes» llega a TODAS las lecturas');
const VER = { ver_todo: true };
for (const rol of ['supervisor', 'vendedor']) {
  for (const [ruta, ctl] of LECTURAS) {
    checkEq(`★ ${rol} ${ruta.split('?')[0]}`, await pedir(u(rol, VER), 'GET', ruta), ctl);
  }
}
console.log('   … pero sin el módulo Reportes no abre nada');
for (const [ruta] of LECTURAS) {
  checkEq(`supervisor sin módulo ${ruta.split('?')[0]}`, await pedir(u('supervisor', VER, SIN_REPORTES), 'GET', ruta), 403);
}

// ─── 3. Solo lectura ────────────────────────────────────────────────────────
console.log('\n3. ★ El permiso no da ESCRITURA');
const ESCRITURAS = [
  ['POST',   '/gastos-fijos',   'crearGastoFijo'],
  ['PATCH',  '/gastos-fijos/3', 'actualizarGastoFijo'],
  ['DELETE', '/gastos-fijos/3', 'eliminarGastoFijo'],
  ['PATCH',  '/costo-compra',   'actualizarCostoCompra'],
];
for (const [m, ruta, ctl] of ESCRITURAS) {
  checkEq(`★ supervisor con permiso ${m} ${ruta}`, await pedir(u('supervisor', VER), m, ruta), 403);
  checkEq(`vendedor con permiso ${m} ${ruta}`,     await pedir(u('vendedor', VER), m, ruta), 403);
  checkEq(`admin ${m} ${ruta}`,                    await pedir(ADMIN, m, ruta), ctl);
}

// ─── 4. Alcance del análisis para asesoría ──────────────────────────────────
console.log('\n4. «Todo el negocio» sigue siendo del admin');
await pedir(u('supervisor', VER), 'GET', `/analisis/asesor${R}&alcance=negocio`);
checkEq('★ supervisor con permiso pide negocio → recibe su sede', ultimoAsesor, {
  sucursalIds: [7], desde: '2026-10-01', hasta: '2026-10-19', todoElNegocio: false });
await pedir(ADMIN, 'GET', `/analisis/asesor${R}&alcance=negocio`);
checkEq('admin pide negocio → todas las sedes', [ultimoAsesor.sucursalIds, ultimoAsesor.todoElNegocio], [[1, 2], true]);
await pedir(ADMIN, 'GET', `/analisis/asesor${R}`);
checkEq('admin sin alcance → la sede de la cabecera', ultimoAsesor.sucursalIds, [7]);

server.close();

// ─── 5. El middleware suelto ────────────────────────────────────────────────
console.log('\n5. puedeVerReportesCompletos');
const { puedeVerReportesCompletos, requireNivelOReportesCompletos } = require(path.join(RAIZ, 'src/middlewares/role.middleware'));
checkEq('admin siempre', puedeVerReportesCompletos(ADMIN), true);
checkEq('sin sesión', puedeVerReportesCompletos(undefined), false);
checkEq('supervisor null', puedeVerReportesCompletos(u('supervisor', null)), false);
checkEq('supervisor con permiso', puedeVerReportesCompletos(u('supervisor', VER)), true);
checkEq('vendedor con permiso y módulos base (sin Reportes)', puedeVerReportesCompletos(u('vendedor', VER, null)), false);
checkEq('supervisor con permiso y módulos base (con Reportes)', puedeVerReportesCompletos(u('supervisor', VER, null)), true);
checkEq('ver_todo "true" en texto no cuenta', puedeVerReportesCompletos(u('supervisor', { ver_todo: 'true' })), false);
let st = null;
requireNivelOReportesCompletos('admin_negocio')({ user: null }, { status: (c) => ({ json: () => { st = c; } }) }, () => { st = 'next'; });
checkEq('sin sesión → 401', st, 401);

// ─── 6. Lo que se guarda ────────────────────────────────────────────────────
console.log('\n6. Normalización al guardar el usuario');
const { _normalizarPermisosReportes: norm } = require(path.join(RAIZ, 'src/modules/usuarios/usuarios.service'));
checkEq('encendido con el módulo', norm({ ver_todo: true }, 'supervisor', CON_REPORTES), { ver_todo: true });
checkEq('encendido con módulos base del supervisor', norm({ ver_todo: true }, 'supervisor', null), { ver_todo: true });
checkEq('apagado se guarda NULL, no false', norm({ ver_todo: false }, 'supervisor', CON_REPORTES), null);
checkEq('null queda null', norm(null, 'supervisor', CON_REPORTES), null);
checkEq('sin el módulo no se guarda', norm({ ver_todo: true }, 'supervisor', SIN_REPORTES), null);
checkEq('vendedor con módulos base (sin Reportes) no se guarda', norm({ ver_todo: true }, 'vendedor', null), null);
checkEq('admin siempre NULL', norm({ ver_todo: true }, 'admin_negocio', null), null);
checkEq('llaves extra se descartan', norm({ ver_todo: true, otra: 1 }, 'vendedor', CON_REPORTES), { ver_todo: true });

// ─── 7. Espejos y migración ─────────────────────────────────────────────────
console.log('\n7. Migración, lectura tolerante y frontend');
const leer = (p) => fs.readFileSync(p, 'utf8');
const runner = leer(path.join(RAIZ, 'src/config/migrations.js'));
const sqlMig = leer(path.join(RAIZ, 'migrations/20261019_permisos_reportes.sql'));
check('el .sql agrega la columna', /ADD COLUMN IF NOT EXISTS permisos_reportes JSONB/.test(sqlMig));
check('el runner de arranque también', /ADD COLUMN IF NOT EXISTS permisos_reportes JSONB/.test(runner));
const authSvc = leer(path.join(RAIZ, 'src/modules/auth/auth.service.js'));
const repoUs  = leer(path.join(RAIZ, 'src/modules/usuarios/usuarios.repository.js'));
check('★ login la lee con to_jsonb (sin la columna no se cae)', authSvc.includes("to_jsonb(u) -> 'permisos_reportes'"));
check('★ el login NO la nombra directo', !/u\.permisos_reportes/.test(authSvc));
check('lista de usuarios la lee con to_jsonb', (repoUs.match(/to_jsonb\(u\) -> 'permisos_reportes'/g) || []).length === 2);
check('el token la lleva (null para el admin)', /permisos_reportes:\s+usuario\.rol === 'admin_negocio' \? null/.test(authSvc));
const ctx = leer(path.join(FRONT, 'context/AuthContext.jsx'));
check('AuthContext exige ver_todo === true', ctx.includes("permisos_reportes?.ver_todo !== true"));
check("AuthContext exige el módulo 'reportes'", ctx.includes("modulos.includes('reportes')"));
const pag = leer(path.join(FRONT, 'pages/reportes/ReportesPage.jsx'));
check('las pestañas de admin miran verTodo', pag.includes("['inventario', 'analisis', 'proyeccion'].includes(t.id)) return verTodo"));
check('★ corregir costo sigue con esAdmin', pag.includes('<FilaFactura key={factura.id} factura={factura} esAdmin={esAdmin}'));
// Desde 20-oct-2026 Proyección no edita gastos (los lee del centro de gastos,
// suite 82), así que ya no hay controles de escritura que esconder ahí.
check('★ Proyección no ofrece editar gastos', !/crearGastoFijo|actualizarGastoFijo|eliminarGastoFijo/
  .test(leer(path.join(FRONT, 'pages/reportes/PanelProyeccion.jsx'))));
const cfg = leer(path.join(FRONT, 'pages/configuracion/UsuariosConfig.jsx'));
check("la casilla solo aparece con el módulo 'reportes'", cfg.includes("modulosEfectivos.includes('reportes')") && cfg.includes('mostrarPermReportes && ('));
check('arranca apagada (FORM_INICIAL null)', /const FORM_INICIAL = \{[^}]*permisos_reportes:\s+null,/.test(cfg));
check('quitar el módulo la apaga', /if \(!\(modulos === null \|\| modulos\.includes\('reportes'\)\)\) \{?\s*set\('permisos_reportes', null\)/.test(cfg));

console.log(`\n${pasados} verificaciones pasaron, ${fallos} fallaron.`);
process.exit(fallos ? 1 : 0);
