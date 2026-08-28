// ─────────────────────────────────────────────────────────────────────────────
// PERMISO POR USUARIO PARA EDITAR Y CANCELAR FACTURAS EMITIDAS
//
// Hasta ahora las tres rutas que tocan una factura ya emitida —editarla,
// cancelarla y devolverle líneas— eran `requireNivel('supervisor')` a secas. Eso
// dejaba dos casos sin salida: el vendedor de confianza que solo necesita
// corregir la cédula de su propia venta, y el supervisor al que el dueño no
// quiere dejarle CANCELAR (que revierte stock, caja y crédito) sin quitarle todo
// lo demás.
//
// Lo que esta prueba cuida es el detalle que hace la feature aditiva:
// **`permisos_facturas` en null NO significa "no puede"**, significa "permisos
// base del rol". Si algún día alguien lo cambia por un `=== true` a secas, el
// despliegue le quita el botón de cancelar a TODOS los supervisores del sistema
// sin que nadie lo haya pedido. Las secciones 1, 2 y 4 fallan si eso pasa.
//
// No necesita base de datos: el permiso se decide con el JWT, y los
// controladores van stubbeados para ver quién llega y quién no.
//
//   node scripts/pruebas-red-interna/30-permisos-facturas.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAIZ = path.resolve(AQUI, '../..');

let fallos = 0, pasados = 0;
const checkEq = (etiqueta, real, esperado) => {
  const ok = real === esperado;
  if (ok) { pasados++; console.log(`  ✓ ${etiqueta}`); }
  else    { fallos++;  console.log(`  ✗ ${etiqueta} — dio ${JSON.stringify(real)}, esperaba ${JSON.stringify(esperado)}`); }
};

// ─── 1. El middleware suelto ────────────────────────────────────────────────
const { requirePermisoFacturas } = require(path.join(RAIZ, 'src/middlewares/role.middleware'));

// Devuelve 'next' si dejó pasar, o el código de estado si cortó.
const correrMw = (user, accion) => {
  let salida = null;
  const res = { status: (c) => ({ json: () => { salida = c; } }) };
  requirePermisoFacturas(accion)({ user }, res, () => { salida = 'next'; });
  return salida;
};

console.log('\n1. Sin permiso explícito manda el ROL — o sea, lo de siempre');
checkEq('admin_negocio edita',                    correrMw({ rol: 'admin_negocio' }, 'editar'),   'next');
checkEq('admin_negocio cancela',                  correrMw({ rol: 'admin_negocio' }, 'cancelar'), 'next');
checkEq('★ supervisor con null SIGUE editando',   correrMw({ rol: 'supervisor', permisos_facturas: null }, 'editar'),   'next');
checkEq('★ supervisor con null SIGUE cancelando', correrMw({ rol: 'supervisor', permisos_facturas: null }, 'cancelar'), 'next');
checkEq('vendedor con null no edita',             correrMw({ rol: 'vendedor',   permisos_facturas: null }, 'editar'),   403);
checkEq('vendedor con null no cancela',           correrMw({ rol: 'vendedor',   permisos_facturas: null }, 'cancelar'), 403);

console.log('\n2. Token emitido ANTES del despliegue (la clave ni existe)');
// El access token dura 8h: durante ese rato los tokens vivos no traen la clave.
// Si esto fallara, un despliegue en horario laboral tumbaría a los supervisores.
checkEq('★ supervisor sin la clave cancela', correrMw({ rol: 'supervisor' }, 'cancelar'), 'next');
checkEq('vendedor sin la clave no cancela',  correrMw({ rol: 'vendedor' },   'cancelar'), 403);

console.log('\n3. Con el permiso puesto manda el OBJETO, no el rol');
const soloEdita = { puede_editar: true, puede_cancelar: false };
checkEq('vendedor autorizado edita',         correrMw({ rol: 'vendedor',   permisos_facturas: soloEdita }, 'editar'),   'next');
checkEq('pero no cancela',                   correrMw({ rol: 'vendedor',   permisos_facturas: soloEdita }, 'cancelar'), 403);
checkEq('★ supervisor recortado NO cancela', correrMw({ rol: 'supervisor', permisos_facturas: soloEdita }, 'cancelar'), 403);
checkEq('y sí sigue editando',               correrMw({ rol: 'supervisor', permisos_facturas: soloEdita }, 'editar'),   'next');
checkEq('supervisor sin ninguna de las dos',
  correrMw({ rol: 'supervisor', permisos_facturas: { puede_editar: false, puede_cancelar: false } }, 'editar'), 403);
checkEq('vendedor con las dos cancela',
  correrMw({ rol: 'vendedor', permisos_facturas: { puede_editar: true, puede_cancelar: true } }, 'cancelar'), 'next');
// El admin no se lee nunca: su columna se guarda en null, pero si alguien le
// metiera un objeto restrictivo a mano tampoco puede quedar fuera de su negocio.
checkEq('admin pasa aunque el objeto diga que no',
  correrMw({ rol: 'admin_negocio', permisos_facturas: { puede_editar: false, puede_cancelar: false } }, 'cancelar'), 'next');
checkEq('sin sesión → 401', correrMw(undefined, 'editar'), 401);

// ─── 4. Las rutas reales, con los controladores stubbeados ──────────────────
//
// El middleware puede estar perfecto y la ruta no usarlo. Esto monta el router
// de verdad y mira quién llega al controlador.
const express = require('express');
const ctrl = require(path.join(RAIZ, 'src/modules/facturas/facturas.controller'));
ctrl.editarFactura         = (req, res) => res.json({ llego: 'editar' });
ctrl.cancelarFactura       = (req, res) => res.json({ llego: 'cancelar' });
ctrl.devolverLineasCredito = (req, res) => res.json({ llego: 'devolucion' });

// El router se requiere DESPUÉS del stub: express captura el handler al definir
// la ruta, así que parcharlo más tarde no serviría de nada.
const router = require(path.join(RAIZ, 'src/modules/facturas/facturas.routes'));

let usuarioActual = null;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = usuarioActual; next(); });
app.use('/facturas', router);

const server = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
const puerto = server.address().port;

// Devuelve 'editar' | 'cancelar' | 'devolucion' si llegó al controlador, o el
// código de estado si algún middleware lo cortó antes.
const pedir = async (user, ruta) => {
  usuarioActual = user;
  const r = await fetch(`http://127.0.0.1:${puerto}/facturas/${ruta}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  if (!r.ok) return r.status;
  return (await r.json()).llego;
};

// Módulo 'facturar' incluido: `requireModulo` corre antes y taparía el resultado.
const MODULOS = ['inventario', 'facturar', 'servicios', 'prestamos'];
const usuario = (rol, permisos_facturas) => ({
  rol, modulos_permitidos: MODULOS, negocio_id: 1, sucursal_id: 1, permisos_facturas,
});

console.log('\n4. Las rutas reales — lo que ya funcionaba sigue funcionando');
checkEq('★ supervisor sin tocar nada edita',   await pedir(usuario('supervisor', null), '7'),                    'editar');
checkEq('★ supervisor sin tocar nada cancela', await pedir(usuario('supervisor', null), '7/cancelar'),           'cancelar');
checkEq('★ y devuelve líneas',                 await pedir(usuario('supervisor', null), '7/devolucion-parcial'), 'devolucion');
checkEq('admin_negocio cancela',               await pedir(usuario('admin_negocio', null), '7/cancelar'),        'cancelar');
checkEq('vendedor sin permiso no edita',       await pedir(usuario('vendedor', null), '7'),                      403);
checkEq('vendedor sin permiso no cancela',     await pedir(usuario('vendedor', null), '7/cancelar'),             403);

console.log('\n5. Las rutas reales — lo que la feature agrega');
checkEq('vendedor autorizado edita',           await pedir(usuario('vendedor', soloEdita), '7'),                 'editar');
checkEq('y sigue sin poder cancelar',          await pedir(usuario('vendedor', soloEdita), '7/cancelar'),        403);
checkEq('★ supervisor recortado no cancela',   await pedir(usuario('supervisor', soloEdita), '7/cancelar'),      403);
// "Devolver" quita líneas de una factura: devuelve stock y baja el crédito. Es
// una cancelación parcial, así que cuelga de `puede_cancelar` y no de `editar` —
// si colgara de `editar`, quien solo corrige datos podría revertir mercancía.
checkEq('★ devolución parcial cuelga de CANCELAR, no de editar',
  await pedir(usuario('vendedor', soloEdita), '7/devolucion-parcial'), 403);
checkEq('y con puede_cancelar sí pasa',
  await pedir(usuario('vendedor', { puede_editar: false, puede_cancelar: true }), '7/devolucion-parcial'), 'devolucion');

// Crear una factura no lo toca este permiso: el 400 lo pone el validador de
// cuerpo, que corre DESPUÉS de los permisos — o sea que los pasó.
usuarioActual = usuario('vendedor', { puede_editar: false, puede_cancelar: false });
const rCrear = await fetch(`http://127.0.0.1:${puerto}/facturas/`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
});
checkEq('crear factura no lo toca el permiso nuevo', rCrear.status, 400);

console.log('\n6. El módulo manda sobre el permiso');
checkEq('sin el módulo "facturar" no entra ni con permiso',
  await pedir({ rol: 'vendedor', modulos_permitidos: ['inventario'], negocio_id: 1,
                permisos_facturas: { puede_editar: true, puede_cancelar: true } }, '7'), 403);

server.close();

console.log('\n' + '─'.repeat(62));
if (fallos) { console.log(`✗ ${fallos} FALLO(S) de ${fallos + pasados}`); process.exit(1); }
console.log(`✓ TODO OK — ${pasados} verificaciones`);
