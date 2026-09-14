// Prueba en node puro del editor de variantes al CREAR un producto
// (`src/utils/variantesNuevas.js`). Lo que se vigila es el payload: tiene que
// tener la forma exacta que acepta `POST /productos-cantidad` → `variantes`, y
// no puede llevar un campo que la pantalla no mostró.
//
//   node scripts/prueba-variantes-nuevas.mjs
import {
  estadoVariantesVacio, agregarValores, hojasVariantes, armarVariantesPayload, errorVariantes, claveHoja,
} from '../src/utils/variantesNuevas.js';

let fallos = 0, pasados = 0;
const check = (nombre, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}${ok ? '' : `: ${JSON.stringify(real)} ← esperaba ${JSON.stringify(esperado)}`}`);
  ok ? pasados++ : fallos++;
};

console.log('\n1. Apagado: la clave ni viaja');
check('★ sin activar, no hay payload', armarVariantesPayload(estadoVariantesVacio()), undefined);
check('activado pero vacío tampoco', armarVariantesPayload({ ...estadoVariantesVacio(), activo: true }), undefined);
check('y la pantalla dice por qué no deja crear', typeof errorVariantes({ ...estadoVariantesVacio(), activo: true }), 'string');
check('apagado no bloquea nada', errorVariantes(estadoVariantesVacio()), null);

console.log('\n2. Agregar valores');
check('separa por coma y limpia', agregarValores([], ' Blanco, Verde ,,Rosado'), ['Blanco', 'Verde', 'Rosado']);
check('★ no repite sin distinguir mayúsculas (el backend lo rechazaría)', agregarValores(['Blanco'], 'blanco, BLANCO, Negro'), ['Blanco', 'Negro']);

console.log('\n3. Una característica');
const una = {
  activo: true,
  dims: [{ tipoId: '2', valores: ['Blanco', 'Verde'] }],
  filas: { [claveHoja('Blanco')]: { precio: '25000', costo: '12000', codigo: ' ab-1 ' } },
};
check('combinaciones', hojasVariantes(una).map((h) => h.label), ['Blanco', 'Verde']);
check('★ payload plano, con el tipo como número', armarVariantesPayload(una, { conCosto: true, conCodigo: true }), [
  { valor: 'Blanco', tipo_id: 2, precio: 25000, costo_unitario: 12000, codigo: 'AB-1' },
  { valor: 'Verde', tipo_id: 2 },
]);
check('★ sin permiso de costo, el costo no viaja; sin código activo, tampoco el código',
  armarVariantesPayload(una)[0], { valor: 'Blanco', tipo_id: 2, precio: 25000 });

console.log('\n4. Dos características (talla × color)');
const dos = {
  activo: true,
  dims: [{ tipoId: '1', valores: ['38MM', '42MM'] }, { tipoId: '', valores: ['Negro', 'Café'] }],
  filas: { [claveHoja('42MM', 'Café')]: { precio: '9000' } },
};
check('4 combinaciones en orden', hojasVariantes(dos).map((h) => h.label), ['38MM / Negro', '38MM / Café', '42MM / Negro', '42MM / Café']);
check('★ anidado: la talla contiene los colores y el precio va en la hoja', armarVariantesPayload(dos), [
  { valor: '38MM', tipo_id: 1, variantes: [{ valor: 'Negro', tipo_id: null }, { valor: 'Café', tipo_id: null }] },
  { valor: '42MM', tipo_id: 1, variantes: [{ valor: 'Negro', tipo_id: null }, { valor: 'Café', tipo_id: null, precio: 9000 }] },
]);
check('una segunda característica vacía se ignora',
  armarVariantesPayload({ ...una, dims: [una.dims[0], { tipoId: '', valores: [] }] }).length, 2);

console.log('\n5. Errores que la pantalla ataja antes de enviar');
const codDup = { ...una, filas: { [claveHoja('Blanco')]: { codigo: 'x1' }, [claveHoja('Verde')]: { codigo: 'X1' } } };
check('★ el mismo código en dos variantes', /repetido/.test(errorVariantes(codDup) || ''), true);
const muchas = { activo: true, dims: [{ tipoId: '', valores: Array.from({ length: 15 }, (_, i) => `T${i}`) }, { tipoId: '', valores: Array.from({ length: 14 }, (_, i) => `C${i}`) }], filas: {} };
check('más de 200 combinaciones', /200/.test(errorVariantes(muchas) || ''), true);

console.log(`\n${fallos ? `✗ ${fallos} FALLOS` : '✓ TODO OK'} — ${pasados} verificaciones`);
if (fallos) process.exit(1);
