// ─────────────────────────────────────────────────────────────────────────────
// INFORME DE IMPORTACIÓN
//
// La importación de inventario se corre prácticamente UNA vez por negocio,
// cuando arrancan. El usuario no tiene práctica y no va a repetirla para
// aprenderse sus manías. Por eso el diseño es **informativo, no correctivo**:
// el importador no arregla nombres, no fusiona productos y no adivina — dice
// exactamente qué va a pasar y deja que el usuario corrija su Excel.
//
// Dos categorías, y la diferencia importa:
//
//   · CONFLICTO → la fila NO se escribe. Algo la hace imposible o peligrosa
//     (un IMEI que ya está en otra sede, una unidad ya vendida, un código
//     tomado por otro producto). Se reporta con hoja, fila, columna y valor
//     para que se pueda encontrar en el Excel de un vistazo.
//
//   · AVISO → la fila SÍ se escribe, pero el resultado puede no ser el que el
//     usuario espera (se va a sumar stock a un producto que ya existía, el
//     producto queda sin costo, hay un nombre casi idéntico ya creado). Nunca
//     bloquea: hay negocios que a propósito no registran costos, y no somos
//     nosotros quienes imponemos esa política.
//
// Nada de esto modifica datos existentes. Los duplicados que ya viven en la
// base (`[11PRO]` y `[11Pro]` en la misma sucursal, nombres con espacios
// finales) se DETECTAN y se REPORTAN, jamás se tocan: son negocios reales
// operando y su historia de ventas cuelga de esas filas.
// ─────────────────────────────────────────────────────────────────────────────

// ── Tipos de conflicto (la fila se omite) ────────────────────────────────────
const CONFLICTO = {
  NOMBRE_REQUERIDO:   'nombre_requerido',
  IMEI_REQUERIDO:     'imei_requerido',
  IMEI_OTRA_SEDE:     'imei_otra_sede',
  IMEI_VENDIDO:       'imei_vendido',
  IMEI_PRESTADO:      'imei_prestado',
  IMEI_REPETIDO:      'imei_repetido_archivo',
  CODIGO_INVALIDO:    'codigo_invalido',
  CODIGO_EN_USO:      'codigo_en_uso',
  CODIGO_ARCHIVO:     'codigo_duplicado_archivo',
  ERROR_FILA:         'error_fila',
};

// ── Tipos de aviso (la fila se escribe igual) ────────────────────────────────
const AVISO = {
  STOCK_SE_SUMA:      'stock_se_suma',
  NOMBRE_SIMILAR:     'nombre_similar_existente',
  NOMBRE_ARCHIVO:     'nombre_repetido_archivo',
  VARIOS_COINCIDEN:   'varios_productos_coinciden',
  SIN_COSTO:          'sin_costo',
  SIN_COSTO_TARIFAS:  'sin_costo_con_tarifas',
  SIN_LINEA:          'sin_linea',
  FECHA_NO_LEIDA:     'fecha_no_reconocida',
  PROVEEDOR_NUEVO:    'proveedor_nuevo',
  LINEA_NUEVA:        'linea_nueva',
  HOJA_IGNORADA:      'hoja_ignorada',
  CODIGO_NO_APLICADO: 'codigo_no_aplicado',
  SERIAL_ACTUALIZADO: 'serial_actualizado',
};

const crearInforme = () => ({
  conflictos: [],
  avisos:     [],
  // Se acumulan aparte porque son resúmenes, no incidencias fila a fila:
  // "voy a crear estos 3 proveedores" se lee mucho mejor que 40 avisos sueltos.
  proveedores_nuevos: [],
  lineas_nuevas:      [],
  hojas_ignoradas:    [],
});

/**
 * Registra una incidencia. `fila` es el número de fila REAL del Excel
 * (1-indexado, contando las 3 filas de encabezado) para que el usuario pueda
 * saltar a ella directamente.
 */
const anotar = (lista, { hoja, fila, columna, valor, tipo, mensaje, sugerencia }) => {
  lista.push({
    hoja:       hoja ?? null,
    fila:       fila ?? null,
    columna:    columna ?? null,
    valor:      valor === undefined || valor === null || valor === '' ? null : String(valor).slice(0, 120),
    tipo,
    mensaje,
    sugerencia: sugerencia ?? null,
  });
};

const conflicto = (informe, datos) => anotar(informe.conflictos, datos);
const aviso     = (informe, datos) => anotar(informe.avisos,     datos);

/**
 * Deduplica avisos repetitivos: un producto sin costo con 40 seriales no debe
 * producir 40 avisos idénticos. La clave agrupa por tipo + hoja + valor.
 */
const avisoUnico = (informe, datos) => {
  const clave = `${datos.tipo}|${datos.hoja ?? ''}|${datos.valor ?? ''}`;
  if (informe._vistos?.has(clave)) return;
  if (!informe._vistos) informe._vistos = new Set();
  informe._vistos.add(clave);
  aviso(informe, datos);
};

/** Quita los campos internos antes de mandar el informe al frontend. */
const limpiar = (informe) => {
  const { _vistos, ...publico } = informe;
  return publico;
};

// ── Nombre de columna de una característica ──────────────────────────────────
//
// Vive aquí porque lo necesitan LOS DOS lados y tienen que coincidir: la
// plantilla para escribir la cabecera, y el service para buscar el valor en la
// fila. Si se separan, la característica se importa vacía y nadie se entera.
//
// Las características las escribe el negocio en Ajustes, así que una puede
// llamarse igual que una columna fija de la hoja. El caso real que lo destapó:
// un negocio con la característica «Color» y además los colores de serial
// activos — dos columnas «Color» en la misma hoja, que Excel colapsa.

const COLUMNAS_FIJAS_SERIAL = [
  'producto', 'imei', 'fecha_entrada', 'proveedor', 'marca', 'modelo', 'linea',
  'ubicacion', 'precio', 'costo_compra', 'cliente_origen', 'nota',
];

const SUFIJO_CARACTERISTICA = ' (caract.)';

const normalizarClave = (s) =>
  String(s ?? '').replace(/\s*\*\s*/g, '').trim().toLowerCase().replace(/\s+/g, '_');

/**
 * Nombre visible de la columna de una característica. Solo se desambigua cuando
 * de verdad choca, para no ensuciar la plantilla de los negocios que no tienen
 * el problema.
 */
const nombreColumnaCaracteristica = (nombre, coloresActivo) => {
  const reservadas = new Set(COLUMNAS_FIJAS_SERIAL);
  if (coloresActivo) reservadas.add('color');
  return reservadas.has(normalizarClave(nombre)) ? `${nombre}${SUFIJO_CARACTERISTICA}` : nombre;
};

/**
 * Claves bajo las que puede venir el valor de una característica en la fila
 * importada. Se devuelven las dos: la desambiguada y la simple. Así una
 * plantilla descargada ANTES de este cambio se sigue importando igual.
 */
const clavesCaracteristica = (nombre) => [
  normalizarClave(`${nombre}${SUFIJO_CARACTERISTICA}`),
  normalizarClave(nombre),
];

module.exports = {
  CONFLICTO, AVISO, crearInforme, conflicto, aviso, avisoUnico, limpiar,
  normalizarClave, nombreColumnaCaracteristica, clavesCaracteristica,
};
