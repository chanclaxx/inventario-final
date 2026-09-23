const repo   = require('./listasPrecios.repository');
const util   = require('../../utils/listasPrecios.util');
const config = require('../config/config.repository');
const { hayListasPrecios } = require('../../config/columnas');
const { generarPlantillaBuffer } = require('./listasPrecios.plantilla');
const { resolverLibro } = require('./listasPrecios.excel');

// ─────────────────────────────────────────────────────────────────────────────
// LISTAS DE PRECIOS — guardar los N precios de venta de uno o varios nodos.
//
// Por qué esto es un endpoint PROPIO y no un campo más del PUT del producto:
//
//   1. El PERMISO es otro. Editar el producto lo puede hacer un supervisor con
//      la casilla «Precio» —que viene encendida por defecto—; cambiar una lista
//      de precios es solo-admin salvo permiso explícito. Colgarlo del mismo PUT
//      obligaría a filtrar campo por campo dentro del update, que es justo el
//      chequeo que se olvida el día que alguien agregue otro campo.
//   2. El NODO es otro. Los precios se ponen en el producto, en la talla, en la
//      variante o en la referencia serial. Un endpoint que habla de nodos sirve
//      para los cuatro; si no, hay que tocar tres services de update distintos
//      y repetir la validación en cada uno — y separarlas es exactamente lo que
//      les pasó a las dos listas de módulos.
//   3. La edición es MASIVA por naturaleza. Un producto con 30 tallas × 3 listas
//      son 90 números que se guardan de una vez. Van en UNA transacción: dejar
//      la mitad escrita es peor que no escribir nada, porque nadie sabría cuál
//      mitad.
// ─────────────────────────────────────────────────────────────────────────────

/** Tope de nodos por petición: un producto con 30 tallas y sus variantes cabe. */
const MAX_NODOS = 500;

const _sinInfra = () => ({
  status: 503,
  message: 'Las listas de precios no están disponibles en esta base de datos todavía.',
});

/**
 * Las listas configuradas hoy por el negocio. Es lo que decide qué claves se
 * aceptan: un precio de una lista borrada no se guarda, o volver a crear una
 * lista con el mismo id resucitaría precios que nadie revisó.
 */
const _idsValidos = async (negocioId) => {
  const cfg = await config.getMap(negocioId);
  if (cfg.listas_precios_activo !== '1') {
    throw {
      status: 400,
      message: 'Las listas de precios no están activas. Actívalas en Ajustes → Precios.',
    };
  }
  const listas = util.parsearListas(cfg.listas_precios_lista);
  if (!listas.length) {
    throw {
      status: 400,
      message: 'Todavía no has creado ninguna lista de precios en Ajustes → Precios.',
    };
  }
  return listas.map((l) => l.id);
};

/**
 * Guarda los precios de un lote de nodos.
 *
 * `nodos` = [{ nivel, id, precios }]. `precios` puede venir con claves de más o
 * con basura: `sanearPrecios` se queda solo con las listas que existen hoy y
 * con los números utilizables, y devuelve null si no queda ninguno — eso
 * escribe NULL en la columna, que es "este producto no tiene precios de lista",
 * y no {} , que sería un objeto vacío indistinguible a simple vista.
 *
 * Un nodo que no existe o que es de OTRO negocio no revienta la petición: se
 * cuenta aparte y se devuelve. Al guardar 90 celdas de una pantalla, que una
 * talla se haya borrado en otra pestaña no puede tirar las otras 89.
 */
const guardarPrecios = async (nodos, negocioId) => {
  if (!hayListasPrecios()) throw _sinInfra();

  if (!Array.isArray(nodos) || nodos.length === 0) {
    throw { status: 400, message: 'No enviaste ningún precio que guardar' };
  }
  if (nodos.length > MAX_NODOS) {
    throw { status: 400, message: `No puedes guardar más de ${MAX_NODOS} nodos de una vez` };
  }

  const idsValidos = await _idsValidos(negocioId);

  // Un mismo nodo dos veces en la misma petición es un error de la pantalla, y
  // aceptarlo dejaría el resultado dependiendo del orden del arreglo.
  const vistos = new Set();
  const limpios = [];
  for (const crudo of nodos) {
    const nivel = String(crudo?.nivel || '');
    const id    = Number(crudo?.id);
    if (!repo.NIVELES.includes(nivel)) {
      throw { status: 400, message: `Nivel de producto desconocido: "${nivel}"` };
    }
    if (!Number.isInteger(id) || id <= 0) {
      throw { status: 400, message: 'Cada nodo tiene que traer su identificador' };
    }
    const clave = `${nivel}:${id}`;
    if (vistos.has(clave)) {
      throw { status: 400, message: 'Mandaste el mismo producto dos veces en la misma petición' };
    }
    vistos.add(clave);
    limpios.push({ nivel, id, precios: util.sanearPrecios(crudo.precios, idsValidos) });
  }

  const client = await repo.pool.connect();
  try {
    await client.query('BEGIN');
    let guardados = 0;
    const noEncontrados = [];
    for (const nodo of limpios) {
      const ok = await repo.escribirPrecios(client, nodo, negocioId);
      if (ok) guardados++;
      else noEncontrados.push(`${nodo.nivel}:${nodo.id}`);
    }
    await client.query('COMMIT');
    return { guardados, no_encontrados: noEncontrados };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/** Los precios actuales de todos los nodos de un producto por cantidad. */
const getPreciosProducto = async (productoId, negocioId) => {
  if (!hayListasPrecios()) throw _sinInfra();
  const id = Number(productoId);
  if (!Number.isInteger(id) || id <= 0) {
    throw { status: 400, message: 'Producto inválido' };
  }
  return repo.leerPreciosProductoCantidad(id, negocioId);
};

// ── Excel: el mismo archivo de ida y de vuelta ───────────────────────────────

/** Las listas configuradas, o un 400 que explica qué falta. Reusa la guarda. */
const _listas = async (negocioId) => {
  const ids = await _idsValidos(negocioId);
  const cfg = await config.getMap(negocioId);
  return util.parsearListas(cfg.listas_precios_lista).filter((l) => ids.includes(l.id));
};

/**
 * Las sucursales sobre las que opera la plantilla.
 *
 * Un supervisor solo puede tocar la suya: la lista de sucursales sale de la BD,
 * pero quién puede escribirlas lo decide esto, no la pantalla. Sin este filtro,
 * bastaría con mandar otro `sucursales` en la petición para tarifar la sede de
 * al lado.
 */
const _sucursalesPermitidas = async (usuario, pedidas) => {
  const todas = await repo.leerSucursales(usuario.negocio_id);
  const suyas = usuario.rol === 'admin_negocio'
    ? todas
    : todas.filter((s) => s.id === usuario.sucursal_id
        || (usuario.sucursales_vista || []).includes(s.id));

  if (!pedidas || !pedidas.length) return suyas;

  const permitidas = new Set(suyas.map((s) => s.id));
  const elegidas = pedidas.map(Number).filter((id) => permitidas.has(id));
  if (!elegidas.length) {
    throw { status: 403, message: 'No tienes acceso a las sucursales que pediste' };
  }
  return suyas.filter((s) => elegidas.includes(s.id));
};

/**
 * El .xlsx con los precios de hoy, listo para editar y volver a subir.
 *
 * **Las tallas entran por defecto si el negocio usa variantes.** Con
 * `variantes_activo` el precio vive en la HOJA y el producto es un contenedor:
 * una plantilla sin tallas no puede tarifar lo que de verdad se vende, y eso
 * fue justo lo que se reportó («descarga los productos pero no las variantes»).
 * `incluirVariantes` solo manda cuando la pantalla lo dice explícitamente —
 * `undefined` es «decide tú», que es lo que manda un frontend viejo.
 */
const generarPlantilla = async (usuario, { sucursales, incluirVariantes } = {}) => {
  if (!hayListasPrecios()) throw _sinInfra();
  const listas = await _listas(usuario.negocio_id);
  const sedes  = await _sucursalesPermitidas(usuario, sucursales);

  const cfg = await config.getMap(usuario.negocio_id);
  const conVariantes = incluirVariantes === undefined
    ? cfg.variantes_activo === '1'
    : !!incluirVariantes;

  const datos = [];
  for (const sucursal of sedes) {
    datos.push({
      sucursal,
      nodos: await repo.leerNodosSucursal(sucursal.id, usuario.negocio_id, {
        incluirVariantes: conVariantes,
      }),
    });
  }
  return { buffer: generarPlantillaBuffer(datos, listas), sedes };
};

/**
 * Lee el archivo y devuelve qué pasaría. NO escribe.
 *
 * Devuelve también las escrituras ya resueltas, y `aplicar` usa ESAS mismas:
 * un validador aparte se desincroniza del importador y acaba mintiendo.
 */
const _resolverArchivo = async (usuario, buffer, sucursales) => {
  if (!hayListasPrecios()) throw _sinInfra();
  if (!buffer || !buffer.length) throw { status: 400, message: 'No llegó ningún archivo' };

  const listas = await _listas(usuario.negocio_id);
  const sedes  = await _sucursalesPermitidas(usuario, sucursales);

  const porSucursal = new Map();
  for (const s of sedes) {
    porSucursal.set(s.id, {
      nombre: s.nombre,
      // Se leen SIEMPRE los tres niveles, aunque la plantilla se haya bajado
      // solo con productos: si el usuario agregó filas de talla a mano, tienen
      // que poder resolverse.
      nodos: await repo.leerNodosSucursal(s.id, usuario.negocio_id, { incluirVariantes: true }),
    });
  }
  return resolverLibro(buffer, { listas, porSucursal });
};

const analizarExcel = async (usuario, buffer, sucursales) => {
  const { informe } = await _resolverArchivo(usuario, buffer, sucursales);
  return informe;
};

/** Aplica el archivo. Todo en UNA transacción: media tabla escrita es peor. */
const importarExcel = async (usuario, buffer, sucursales) => {
  const { informe, escrituras } = await _resolverArchivo(usuario, buffer, sucursales);

  const client = await repo.pool.connect();
  try {
    await client.query('BEGIN');
    let guardados = 0;
    for (const e of escrituras) {
      const ok = await repo.escribirPrecios(client, e, usuario.negocio_id);
      if (ok) guardados++;
    }
    await client.query('COMMIT');
    return { ...informe, guardados };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  guardarPrecios, getPreciosProducto, MAX_NODOS,
  generarPlantilla, analizarExcel, importarExcel,
};
