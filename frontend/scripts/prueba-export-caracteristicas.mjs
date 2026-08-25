// ─────────────────────────────────────────────────────────────────────────────
// Exportación de inventario — características, con y sin la opción.
//
// Genera el Excel de verdad (ExcelJS) sobre datos de ejemplo y le lee las celdas
// de vuelta. Lo que protege es que la opción sea ADITIVA: apagada, el archivo
// tiene que salir exactamente como salía antes; encendida, aparecen las
// características que no están en la lista de Ajustes y la hoja con el desglose
// por variante.
//
// Corre en node puro (ExcelJS no necesita navegador; el `descargar()` del módulo
// sí, y por eso se le pone un stub mínimo de Blob/URL/document).
//
//   node scripts/prueba-export-caracteristicas.mjs
// ─────────────────────────────────────────────────────────────────────────────
import ExcelJS from 'exceljs';

// ── Stub del navegador: el módulo llama a descargar() al final ──────────────
let ultimoBuffer = null;
globalThis.Blob = class { constructor(partes) { ultimoBuffer = partes[0]; } };
globalThis.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
globalThis.document = { createElement: () => ({ click() {}, set href(_) {}, set download(_) {} }) };

const { exportarInventarioExcel } = await import('../src/utils/exportarInventarioExcel.js');

// ── Datos de ejemplo ───────────────────────────────────────────────────────
const porProducto = {
  'iPhone 13': [
    {
      imei: 'IMEI-1', vendido: false, prestado: false, color: 'Azul',
      // "Batería" está en la lista de Ajustes; "Accesorios" NO — entró por una
      // importación o quedó de una configuración anterior.
      caracteristicas: { 'Batería': '89%', 'Accesorios': 'Cargador + caja' },
      fecha_entrada: '2026-06-01',
    },
    {
      imei: 'IMEI-2', vendido: true, prestado: false, color: '',
      caracteristicas: { 'Batería': '100%' },
      fecha_entrada: '2026-06-02',
    },
  ],
};

const cantidad = [
  {
    id: 1, nombre: 'Camiseta', stock: 12, stock_minimo: 2, unidad_medida: 'unidad',
    atributos: [
      {
        id: 10, tipo_nombre: 'Talla', valor: 'M', stock: 7, stock_minimo: 1, precio: 30000, codigo: 'CAM-M',
        variantes: [
          { id: 100, tipo_nombre: 'Color', valor: 'Rojo',  stock: 4, stock_minimo: 1, precio: null, codigo: 'CAM-M-R' },
          { id: 101, tipo_nombre: 'Color', valor: 'Negro', stock: 3, stock_minimo: 1, precio: 32000, codigo: 'CAM-M-N' },
        ],
      },
      { id: 11, tipo_nombre: 'Talla', valor: 'L', stock: 5, stock_minimo: 1, precio: 30000, codigo: 'CAM-L', variantes: [] },
    ],
  },
  { id: 2, nombre: 'Cargador', stock: 40, stock_minimo: 5, unidad_medida: 'unidad', atributos: [] },
];

const configMap = {
  caracteristicas_serial_activo: '1',
  caracteristicas_serial_lista: JSON.stringify(['Batería']),
  colores_serial_activo: '1',
  codigo_producto_activo: '1',
};

// ── Helpers ────────────────────────────────────────────────────────────────
const generar = async (opciones) => {
  await exportarInventarioExcel(porProducto, cantidad, configMap, opciones);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(ultimoBuffer);
  return wb;
};
const encabezados = (ws, fila) => {
  const out = [];
  ws.getRow(fila).eachCell((c) => out.push(String(c.value ?? '')));
  return out;
};

let ok = 0, fallos = 0;
const check = (nombre, real, esperado) => {
  const bien = JSON.stringify(real) === JSON.stringify(esperado);
  console.log(`  ${bien ? '✓' : '✗'} ${nombre}: ${JSON.stringify(real)}`
    + (bien ? '' : `\n      ← esperaba ${JSON.stringify(esperado)}`));
  bien ? ok++ : fallos++;
};

// ── 1. Opción APAGADA: el archivo de siempre ───────────────────────────────
console.log('\n═══ 1. Con la opción apagada nada cambia ═══');
let wb = await generar({});
let hoja = wb.getWorksheet('iPhone 13');
check('★ Solo la característica configurada en Ajustes',
  encabezados(hoja, 2), ['IMEI / Serial', 'Estado', 'Color', 'Batería',
    'Prestamista', 'Fecha Entrada', 'Fecha Salida', 'Cliente Venta', 'Cédula Venta', 'Cliente Origen']);
check('★ No se agrega la hoja de características',
  wb.worksheets.map((w) => w.name), ['iPhone 13', 'Por Cantidad']);

// ── 2. Opción ENCENDIDA ────────────────────────────────────────────────────
console.log('\n═══ 2. Con la opción encendida salen todas ═══');
wb = await generar({ caracteristicas: true });
hoja = wb.getWorksheet('iPhone 13');
check('★ "Accesorios" ya no se pierde, aunque no esté en Ajustes',
  encabezados(hoja, 2), ['IMEI / Serial', 'Estado', 'Color', 'Batería', 'Accesorios',
    'Prestamista', 'Fecha Entrada', 'Fecha Salida', 'Cliente Venta', 'Cédula Venta', 'Cliente Origen']);
check('   y su valor viaja en la fila', hoja.getRow(3).getCell(5).value, 'Cargador + caja');
check('   la configurada sigue en su sitio', hoja.getRow(3).getCell(4).value, '89%');

console.log('\n═══ 3. La hoja con el desglose por variante ═══');
const wsCar = wb.getWorksheet('Características');
check('★ La hoja existe', !!wsCar, true);
check('   con sus columnas', encabezados(wsCar, 1),
  ['Producto', 'Característica', 'Valor', 'Sub-característica', 'Sub-valor',
   'Stock', 'Stock Mínimo', 'Precio', 'Código']);
check('★ Una fila por nodo HOJA (2 colores de la M + la L), no por producto',
  wsCar.rowCount - 1, 3);
check('   la talla M / Rojo con SU stock, no el del producto',
  [wsCar.getRow(2).getCell(3).value, wsCar.getRow(2).getCell(5).value, wsCar.getRow(2).getCell(6).value],
  ['M', 'Rojo', 4]);
check('★ Conserva el orden del backend (M antes que L, no alfabético)',
  [wsCar.getRow(2).getCell(3).value, wsCar.getRow(3).getCell(3).value, wsCar.getRow(4).getCell(3).value],
  ['M', 'M', 'L']);
check('   un atributo sin sub-variantes sale solo',
  [wsCar.getRow(4).getCell(3).value, wsCar.getRow(4).getCell(5).value, wsCar.getRow(4).getCell(6).value],
  ['L', '', 5]);
check('   el precio cae al del atributo cuando la variante no tiene',
  wsCar.getRow(2).getCell(8).value, 30000);
check('   el código va como TEXTO (preserva ceros a la izquierda)',
  typeof wsCar.getRow(2).getCell(9).value, 'string');

console.log('\n═══ 4. Un negocio sin variantes no gana una hoja vacía ═══');
ultimoBuffer = null;
await exportarInventarioExcel(porProducto, [cantidad[1]], configMap, { caracteristicas: true });
const wb2 = new ExcelJS.Workbook();
await wb2.xlsx.load(ultimoBuffer);
check('★ Sin árbol de variantes, la hoja no se crea',
  wb2.worksheets.map((w) => w.name).includes('Características'), false);

console.log(`\n${'═'.repeat(72)}`);
console.log(`  ${ok} verificaciones pasaron · ${fallos} fallaron`);
console.log('═'.repeat(72));
process.exit(fallos ? 1 : 0);
