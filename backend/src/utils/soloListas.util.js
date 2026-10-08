// ─────────────────────────────────────────────────────────────────────────────
// VENDER SOLO CON LISTAS — una sede deja de usar el precio predeterminado de
// sus productos POR CANTIDAD y todo se cobra por las listas de precios.
//
// Pedido de Tesla (7-oct-2026): en sus locales el «precio de venta» de cada
// producto ya casi no existe (30 de 1.956 lo tenían) y sin lista elegida el
// carrito caía a $0 — o al COSTO, por el respaldo `precio || costo_unitario`.
//
// Opt-in y POR SEDE (`listas_precios_solo_sucursales`, arreglo JSON de ids de
// sucursal; **ausente o vacío = ninguna**): la bodega y los otros locales del
// mismo negocio siguen con su precio de siempre, y los demás negocios no se
// enteran. Exige las listas activas y una **lista principal**
// (`listas_precios_principal`), que ocupa el lugar del precio predeterminado
// donde solo cabe un número: la etiqueta, el carrito sin lista elegida, el
// producto que la lista elegida no menciona.
//
// Qué NO cambia:
//   · los equipos con IMEI (decisión del usuario): conservan su precio normal,
//     el de la referencia y el de cada unidad;
//   · las columnas `precio`: no se borran ni se reescriben. Apagar la sede en
//     Ajustes devuelve todo a como estaba.
//
// La regla tiene UNA lectura (`leerDeMapa`) y la usan el guardado de Ajustes,
// el precio mínimo, las etiquetas y la plantilla de precios. La copia del
// navegador es `leerConfigSoloListas` en `frontend/src/utils/listasPrecios.js`;
// la suite 76 corre las dos sobre los mismos casos.
// ─────────────────────────────────────────────────────────────────────────────
const { parsearListas } = require('./listasPrecios.util');

const CLAVE_SEDES     = 'listas_precios_solo_sucursales';
const CLAVE_PRINCIPAL = 'listas_precios_principal';
const CLAVES = [CLAVE_SEDES, CLAVE_PRINCIPAL, 'listas_precios_activo', 'listas_precios_lista'];

/** Tope defensivo de sedes en la lista. */
const MAX_SEDES = 200;

/** Ids de sucursal del JSON guardado. Nunca lanza: lo corrupto degrada a []. */
const parsearSedes = (raw) => {
  let lista = raw;
  if (typeof lista === 'string') {
    try { lista = JSON.parse(lista || '[]'); } catch { return []; }
  }
  if (!Array.isArray(lista)) return [];
  const ids = new Set();
  for (const v of lista) {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0) ids.add(n);
    if (ids.size >= MAX_SEDES) break;
  }
  return [...ids];
};

/**
 * La regla del negocio a partir de su mapa de config, o null si no aplica en
 * ninguna sede. Cualquier pieza que falte la APAGA —listas apagadas, lista
 * principal borrada, arreglo vacío—: a medio configurar se vende como siempre,
 * nunca a un precio que nadie eligió.
 */
const leerDeMapa = (cfg) => {
  const c = cfg || {};
  if (c.listas_precios_activo !== '1') return null;
  const sedes = parsearSedes(c[CLAVE_SEDES]);
  if (!sedes.length) return null;
  const principal = String(c[CLAVE_PRINCIPAL] || '').trim();
  if (!principal) return null;
  if (!parsearListas(c.listas_precios_lista).some((l) => l.id === principal)) return null;
  return { sedes: new Set(sedes), principal };
};

/** Lee la regla de la base. `db` es el pool o el client de la transacción. */
const leer = async (db, negocioId) => {
  const { rows } = await db.query(
    `SELECT clave, valor FROM config_negocio
     WHERE negocio_id = $1 AND clave = ANY($2::text[])`,
    [negocioId, CLAVES]
  );
  return leerDeMapa(Object.fromEntries(rows.map((r) => [r.clave, r.valor])));
};

/** ¿Esta sede vende sus productos por cantidad solo con listas? */
const aplica = (regla, sucursalId) => !!regla && regla.sedes.has(Number(sucursalId));

/**
 * Valida lo que llega de Ajustes y devuelve las claves normalizadas que hay que
 * guardar (solo las que venían). `actual` es el mapa ya guardado: `saveConfig`
 * recibe cambios parciales, así que el estado final se arma con los dos.
 *
 * `sucursalesDelNegocio` = ids válidos: una sede de otro negocio no puede
 * quedar escrita aquí, aunque no hiciera nada.
 */
const validarGuardado = (datos, actual, sucursalesDelNegocio) => {
  const tocaAlgo = CLAVES.some((k) => datos[k] !== undefined);
  if (!tocaAlgo) return {};

  const salida = {};
  const final = { ...actual };
  for (const k of CLAVES) if (datos[k] !== undefined) final[k] = datos[k];

  if (datos[CLAVE_SEDES] !== undefined) {
    let cruda = datos[CLAVE_SEDES];
    if (typeof cruda === 'string') {
      try { cruda = JSON.parse(cruda || '[]'); } catch {
        throw { status: 400, message: 'La lista de sedes que venden solo con listas no es válida' };
      }
    }
    if (!Array.isArray(cruda)) {
      throw { status: 400, message: 'La lista de sedes que venden solo con listas no es válida' };
    }
    const validas = new Set((sucursalesDelNegocio || []).map(Number));
    const ids = parsearSedes(cruda);
    if (ids.length !== cruda.length || ids.some((id) => !validas.has(id))) {
      throw { status: 400, message: 'Una de las sedes elegidas no es de este negocio' };
    }
    salida[CLAVE_SEDES] = JSON.stringify(ids);
    final[CLAVE_SEDES]  = salida[CLAVE_SEDES];
  }
  if (datos[CLAVE_PRINCIPAL] !== undefined) {
    salida[CLAVE_PRINCIPAL] = String(datos[CLAVE_PRINCIPAL] ?? '').trim();
    final[CLAVE_PRINCIPAL]  = salida[CLAVE_PRINCIPAL];
  }

  // Sin sedes elegidas no hay nada que exigir: la lista principal puede quedar
  // escrita o vacía, y las listas se pueden apagar como siempre.
  const sedes = parsearSedes(final[CLAVE_SEDES]);
  if (!sedes.length) return salida;

  if (final.listas_precios_activo !== '1') {
    throw {
      status: 400,
      message: 'Hay sedes que venden solo con listas de precios: quítalas primero '
        + '(Ajustes → Precios) antes de apagar las listas, o se quedarían sin precio.',
    };
  }
  const listas = parsearListas(final.listas_precios_lista);
  const principal = String(final[CLAVE_PRINCIPAL] || '').trim();
  if (!principal) {
    throw {
      status: 400,
      message: 'Elige la lista principal: es el precio que se usa cuando no se ha '
        + 'escogido otra lista y el que sale en las etiquetas.',
    };
  }
  if (!listas.some((l) => l.id === principal)) {
    throw {
      status: 400,
      message: 'La lista principal ya no existe. Elige otra antes de guardar: '
        + 'las sedes que venden solo con listas dependen de ella.',
    };
  }
  return salida;
};

module.exports = {
  CLAVE_SEDES, CLAVE_PRINCIPAL, CLAVES, MAX_SEDES,
  parsearSedes, leerDeMapa, leer, aplica, validarGuardado,
};
