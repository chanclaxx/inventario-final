'use strict';

// ── Código del PROVEEDOR: NOMBRE-NIT-CIUDAD-consecutivo ──────────────────────
//
//   «Distribuidora Andina» · NIT 900.123.456-7 · Cali   →   DIS-900-CAL-001
//
// Viaja impreso en la etiqueta de la mercancía que se le compró (ver
// etiquetas.service `lineasCompra`), para que quien tiene la caja en la mano
// sepa de quién vino sin ir a buscar la factura.
//
// ── Las tres letras son las MISMAS del código de producto con patrón ─────────
// `tresLetras` se importa de codigoPatron.util, no se copia: sin tildes, sin
// espacios ni símbolos, las cifras cuentan y lo corto se rellena con X. Dos
// reglas distintas para "las tres primeras letras" en el mismo sistema acabarían
// dando ACC para un producto y ACX para un proveedor con el mismo nombre.
//
// ── El consecutivo es del NEGOCIO, no de la raíz ─────────────────────────────
// Al revés que el código de producto (que numera por CAT-PRO). Allá el número
// separa variantes de un mismo producto; aquí cada proveedor es uno solo, y
// «DIS-900-CAL-001» y «DIS-900-CAL-002» serían dos proveedores con casi el mismo
// nombre, NIT y ciudad — justo el duplicado que no se quiere ver dos veces. Con
// un contador por negocio el número dice «el proveedor N° 7» y la unicidad sale
// por construcción, sin depender de que las letras sean distintas.
//
// ── Un código NUNCA se reescribe ─────────────────────────────────────────────
// Ya está impreso en mercancía. Corregir el NIT o mudar al proveedor de ciudad
// no cambia la etiqueta pegada en la caja, así que tampoco cambia el código: el
// UPDATE vuelve a exigir `codigo IS NULL`.
//
// ── Sin NIT o sin ciudad NO se inventa ───────────────────────────────────────
// Un segmento «XXX» se leería como un dato y es una ausencia. El proveedor queda
// sin código y la pantalla dice qué le falta; en cuanto alguien completa el dato
// y guarda, el código nace solo.

const { pool } = require('../config/db');
const { hayCodigoProveedor } = require('../config/columnas');
const { tresLetras } = require('./codigoPatron.util');
const { reservarBloque } = require('./codigoAuto.util');

// Clave en config_negocio. Ausente = apagado: esto cambia lo que sale impreso.
const CLAVE_CONFIG = 'proveedor_codigo_activo';

// El `tipo` en `contadores_documento` (TEXT libre, sin migración).
const TIPO_CONTADOR = 'codigo_proveedor';

// Mínimo de cifras. Pasado 999 crece solo (1000…): la unicidad no depende del ancho.
const DIGITOS = 3;

// Lo que ya tiene forma de código de proveedor. Semilla del contador: un código
// que alguien haya escrito a mano con este formato hace que el siguiente siga
// por encima en vez de chocar contra el índice.
const REGEX_CODIGO = '^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}-[0-9]{1,9}$';

const activo = (config) => config?.[CLAVE_CONFIG] === '1';

/** Los tres segmentos, o null en el que no se pueda armar. */
const segmentos = ({ nombre, nit, ciudad } = {}) => ({
  nombre: tresLetras(nombre),
  nit:    tresLetras(nit),
  ciudad: tresLetras(ciudad),
});

/**
 * Qué le falta al proveedor para recibir código, en el orden del código.
 * Vacío = puede recibirlo. Es lo que la pantalla de proveedores muestra como
 * «no se pudo asignar: falta la ciudad».
 */
const faltantes = (p) => Object.entries(segmentos(p))
  .filter(([, v]) => !v)
  .map(([k]) => k);

/** El código completo, o null si falta algún segmento. */
const componer = (p, numero) => {
  const s = segmentos(p);
  if (!s.nombre || !s.nit || !s.ciudad) return null;
  return `${s.nombre}-${s.nit}-${s.ciudad}-${String(numero).padStart(DIGITOS, '0')}`;
};

// Ejemplo de la pantalla de Ajustes: sale de `componer`, así el texto de ayuda no
// puede prometer un formato distinto del que se genera.
const EJEMPLO = componer({ nombre: 'Distribuidora Andina', nit: '900.123.456-7', ciudad: 'Cali' }, 1);

const _semilla = async (client, negocioId) => {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(SUBSTRING(codigo FROM '([0-9]+)$')::bigint), 0) AS maximo
     FROM proveedores
     WHERE negocio_id = $1 AND UPPER(codigo) ~ $2`,
    [negocioId, REGEX_CODIGO]
  );
  return Number(rows[0]?.maximo || 0);
};

/**
 * Asigna código a los proveedores ACTIVOS del negocio que no lo tienen, dentro
 * de la transacción del llamador.
 *
 * `FOR UPDATE` serializa dos asignaciones simultáneas (activar la feature
 * mientras alguien crea un proveedor): la segunda relee la fila, ve que ya tiene
 * código y la deja fuera. Y se numera por `id`: los proveedores de siempre
 * reciben los números bajos.
 *
 * @param {object}   client    client de una transacción abierta
 * @param {number}   negocioId
 * @param {object}   [op]
 * @param {number[]} [op.ids]  solo estos proveedores (crear/editar); sin ids, todos
 * @returns {{ asignados: {id, nombre, codigo}[], pendientes: {id, nombre, faltantes}[] }}
 */
const asignarEnTransaccion = async (client, negocioId, { ids = null } = {}) => {
  if (!hayCodigoProveedor()) return { asignados: [], pendientes: [] };

  const { rows } = await client.query(
    `SELECT id, nombre, nit, ciudad
     FROM proveedores
     WHERE negocio_id = $1 AND activo = TRUE AND codigo IS NULL
       AND ($2::int[] IS NULL OR id = ANY($2::int[]))
     ORDER BY id
     FOR UPDATE`,
    [negocioId, ids && ids.length ? ids.map(Number) : null]
  );

  const completos  = rows.filter((p) => faltantes(p).length === 0);
  const pendientes = rows
    .filter((p) => faltantes(p).length > 0)
    .map((p) => ({ id: p.id, nombre: p.nombre, faltantes: faltantes(p) }));

  const asignados = [];
  if (completos.length) {
    const base   = await _semilla(client, negocioId);
    const primero = await reservarBloque(client, negocioId, base, completos.length, TIPO_CONTADOR);
    for (let i = 0; i < completos.length; i += 1) {
      const p = completos[i];
      const codigo = componer(p, primero + i);
      const { rowCount } = await client.query(
        'UPDATE proveedores SET codigo = $1 WHERE id = $2 AND codigo IS NULL',
        [codigo, p.id]
      );
      if (rowCount) asignados.push({ id: p.id, nombre: p.nombre, codigo });
    }
  }
  return { asignados, pendientes };
};

/**
 * Lo mismo, con su propia transacción. `tolerante` es para quien llama desde una
 * operación que ya terminó bien (guardar el proveedor, guardar Ajustes): un
 * código que no se pudo asignar se reporta, nunca deshace lo que el usuario
 * acaba de guardar. La generación manual desde la pantalla NO es tolerante: ahí
 * el error es la respuesta.
 */
const asignarCodigos = async (negocioId, { ids = null, tolerante = false } = {}) => {
  if (!hayCodigoProveedor()) return { asignados: [], pendientes: [] };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await asignarEnTransaccion(client, negocioId, { ids });
    await client.query('COMMIT');
    return r;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (!tolerante) throw err;
    console.error(`[codigoProveedor] No se pudieron asignar códigos (negocio ${negocioId}):`, err.message || err);
    return { asignados: [], pendientes: [], error: err.message || String(err) };
  } finally {
    client.release();
  }
};

module.exports = {
  CLAVE_CONFIG, TIPO_CONTADOR, DIGITOS, EJEMPLO,
  activo, segmentos, faltantes, componer,
  asignarEnTransaccion, asignarCodigos,
};
