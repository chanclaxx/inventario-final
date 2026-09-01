const { pool } = require('../../config/db');
const { hayUbicaciones, hayMovimientosUbicacion } = require('../../config/columnas');
const { normalizarUbicacion } = require('../../utils/ubicacion.util');
const repo = require('./ubicaciones.repository');

// ─────────────────────────────────────────────────────────────────────────────
// Reglas del módulo de ubicaciones.
//
// Las tres que no son obvias y que sostienen todo lo demás:
//
//   · Una ubicación NO SE BORRA con cosas dentro. `ubicaciones_items` tiene
//     ON DELETE CASCADE, así que un DELETE desasignaría su contenido en
//     silencio: el bodeguero borra "Estante 3" y 60 productos se quedan sin
//     sitio sin que nadie lo diga. Se responde 409 y se manda a vaciarla.
//
//   · Nadie puede colgar de su propia hija. No es expresable como constraint
//     —haría falta un trigger recursivo—, así que la impone este archivo, igual
//     que la unicidad del código entre los tres niveles del árbol.
//
//   · Sin las tablas, 503 y ya. La feature se apaga sola y el inventario sigue
//     mostrando la ubicación de siempre desde las columnas TEXT, sin enterarse.
// ─────────────────────────────────────────────────────────────────────────────

// Bodega → Estante → Nivel → Bin. Cuatro niveles cubren cualquier bodega real y
// ponen un techo al zoom del mapa; sin tope, un ciclo roto o un cliente con un
// bug pueden armar una cadena que ninguna pantalla sabe dibujar.
const MAX_PROFUNDIDAD = 4;

const _err = (status, message, codigo) => {
  const e = new Error(message);
  e.status = status;
  if (codigo) e.codigo = codigo;
  return e;
};

const _exigirTablas = () => {
  if (!hayUbicaciones()) {
    throw _err(503, 'El módulo de ubicaciones no está disponible en este servidor', 'UBICACIONES_NO_DISPONIBLE');
  }
};

// ── Lectura ──────────────────────────────────────────────────────────────────

// Compatibilidad: [{ ubicacion, productos }] para el autocompletado y el filtro
// del inventario. No exige las tablas nuevas — con la feature apagada sigue
// respondiendo desde las columnas TEXT, que es justo lo que evita que las
// pantallas actuales se queden sin sugerencias el día del despliegue.
const getUbicaciones = (sucursalId, negocioId) =>
  repo.listarCatalogo(sucursalId, negocioId);

// Árbol + conteos. `items` es lo asignado directamente a la ubicación;
// `items_total` suma lo de sus descendientes, que es lo que tiene sentido
// pintar sobre una bodega en el mapa (una bodega en sí no guarda nada: guardan
// sus estantes).
const getArbol = async (sucursalId, negocioId) => {
  _exigirTablas();

  const planas = await repo.listarArbol(sucursalId, negocioId);
  const porId  = new Map(planas.map((u) => [Number(u.id), { ...u, id: Number(u.id), padre_id: u.padre_id === null ? null : Number(u.padre_id), hijas: [] }]));

  const raices = [];
  for (const u of porId.values()) {
    // Una hija cuyo padre no está en la lista (padre desactivado) sube a raíz en
    // vez de desaparecer del mapa con todo lo que tiene dentro.
    const padre = u.padre_id !== null ? porId.get(u.padre_id) : null;
    if (padre) padre.hijas.push(u);
    else raices.push(u);
  }

  const sumar = (nodo) => {
    nodo.items_total = nodo.items + nodo.hijas.reduce((acc, h) => acc + sumar(h), 0);
    return nodo.items_total;
  };
  raices.forEach(sumar);

  return raices;
};

const getDetalle = async (id, negocioId, opciones) => {
  _exigirTablas();

  const ubicacion = await repo.getById(id, negocioId);
  if (!ubicacion || !ubicacion.activo) throw _err(404, 'Ubicación no encontrada');

  const [ruta, items] = await Promise.all([
    repo.getRuta(id),
    repo.listarItems(id, opciones),
  ]);

  return { ...ubicacion, ruta, items };
};

const getItems = async (id, negocioId, opciones) => {
  _exigirTablas();

  const ubicacion = await repo.getById(id, negocioId);
  if (!ubicacion || !ubicacion.activo) throw _err(404, 'Ubicación no encontrada');

  return repo.listarItems(id, opciones);
};

const getSinAsignar = async (sucursalId, negocioId, opciones) => {
  _exigirTablas();
  return repo.listarSinAsignar(sucursalId, negocioId, opciones);
};

// "¿Dónde está esto?" — la pregunta que más se hace en una bodega grande, y la
// que el modelo viejo no podía responder desde esta pantalla.
//
// Se exige un texto mínimo: con una sola letra la respuesta es media bodega y
// no ayuda a nadie, además de costarle una pasada a una base compartida.
const buscar = async (sucursalId, negocioId, opciones = {}) => {
  _exigirTablas();

  const q = String(opciones.q ?? '').trim();
  if (q.length < 2) return [];

  return repo.buscarNodos(sucursalId, negocioId, { ...opciones, q });
};

// Dónde está cada línea de una lista que ya existe (el carrito de una venta, un
// préstamo, un traslado). Es la ruta de recogida: sin esto hay que cruzar la
// bodega una vez por producto.
//
// Se agrupa por nivel antes de consultar para no hacer una consulta por línea, y
// se descartan los ids inválidos en silencio: una lista con basura debe
// responder lo que sí sabe, no fallar entera. Quien la manda es el carrito del
// propio usuario, no un formulario.
const ubicacionesDe = async (items, sucursalId, negocioId) => {
  _exigirTablas();

  if (!Array.isArray(items) || !items.length) return [];

  const porNivel = {};
  for (const item of items) {
    const nivel = String(item?.nivel || '').trim();
    const id    = Number(item?.id);
    if (!repo.NODOS[nivel] || !Number.isInteger(id) || id <= 0) continue;
    (porNivel[nivel] ??= []).push(id);
  }

  return repo.ubicacionesDeNodos(sucursalId, negocioId, porNivel);
};

// ── Escritura ────────────────────────────────────────────────────────────────

// El nombre pasa por la MISMA normalización que ya usaban las columnas TEXT
// (trim, espacios internos colapsados, tope de 60). Así "Estante  A-3 " y
// "Estante A-3" chocan contra el índice único en vez de convivir como dos
// sitios distintos, que es el problema que este rediseño viene a cerrar.
const _nombreValido = (nombre) => {
  const limpio = normalizarUbicacion(nombre);
  if (!limpio) throw _err(400, 'El nombre de la ubicación es obligatorio');
  return limpio;
};

// Profundidad del padre, contando desde 1 en la raíz.
const _profundidad = async (padreId) => {
  if (!padreId) return 0;
  const { rows } = await pool.query(`
    WITH RECURSIVE ruta AS (
      SELECT id, padre_id, 1 AS nivel FROM ubicaciones WHERE id = $1
      UNION ALL
      SELECT u.id, u.padre_id, r.nivel + 1
      FROM ubicaciones u JOIN ruta r ON r.padre_id = u.id
    )
    SELECT MAX(nivel)::int AS nivel FROM ruta
  `, [padreId]);
  return rows[0]?.nivel ?? 0;
};

// El padre tiene que existir, ser del mismo negocio y de la MISMA SUCURSAL: un
// estante describe un lugar físico, y el "Estante A-3" de una sede no está
// dentro de la bodega de otra.
const _validarPadre = async (padreId, sucursalId, negocioId) => {
  if (padreId === null || padreId === undefined) return null;

  const padre = await repo.getById(padreId, negocioId);
  if (!padre || !padre.activo) throw _err(400, 'La ubicación padre no existe');
  if (Number(padre.sucursal_id) !== Number(sucursalId)) {
    throw _err(400, 'La ubicación padre es de otra sucursal');
  }

  const nivel = await _profundidad(padreId);
  if (nivel >= MAX_PROFUNDIDAD) {
    throw _err(400, `No se pueden anidar más de ${MAX_PROFUNDIDAD} niveles de ubicación`);
  }

  return Number(padreId);
};

const crear = async (datos, sucursalId, negocioId, usuarioId) => {
  _exigirTablas();

  const nombre  = _nombreValido(datos.nombre);
  const padreId = await _validarPadre(datos.padre_id ?? null, sucursalId, negocioId);

  try {
    return await repo.crear({
      sucursal_id: sucursalId,
      padre_id:    padreId,
      nombre,
      tipo:        datos.tipo ?? null,
      descripcion: datos.descripcion ?? null,
      color:       datos.color ?? null,
      orden:       datos.orden ?? null,
      usuario_id:  usuarioId,
    });
  } catch (err) {
    // 23505 = unique_violation. El mensaje del motor no le dice nada a nadie.
    if (err.code === '23505') {
      throw _err(409, `Ya existe una ubicación llamada "${nombre}" en este mismo nivel`, 'UBICACION_DUPLICADA');
    }
    throw err;
  }
};

const actualizar = async (id, datos, negocioId) => {
  _exigirTablas();

  const actual = await repo.getById(id, negocioId);
  if (!actual || !actual.activo) throw _err(404, 'Ubicación no encontrada');

  const campos = {};
  if (datos.nombre      !== undefined) campos.nombre      = _nombreValido(datos.nombre);
  if (datos.tipo        !== undefined) campos.tipo        = datos.tipo || null;
  if (datos.descripcion !== undefined) campos.descripcion = datos.descripcion || null;
  if (datos.color       !== undefined) campos.color       = datos.color || null;
  if (datos.orden       !== undefined) campos.orden       = Number(datos.orden) || 0;

  if (datos.padre_id !== undefined) {
    const nuevoPadre = datos.padre_id === null ? null : Number(datos.padre_id);

    if (nuevoPadre !== null) {
      if (nuevoPadre === Number(id)) {
        throw _err(400, 'Una ubicación no puede estar dentro de sí misma');
      }
      // La guarda que ningún constraint puede dar: mover "Bodega A" dentro de
      // su propio "Estante 1" dejaría un ciclo, y cualquier recorrido del árbol
      // —el mapa, las migas de pan, el conteo— se colgaría para siempre.
      const dentro = await repo.getDescendientes(id);
      if (dentro.includes(nuevoPadre)) {
        throw _err(400, 'No se puede mover una ubicación dentro de una de sus propias sub-ubicaciones');
      }
      await _validarPadre(nuevoPadre, actual.sucursal_id, negocioId);
    }

    campos.padre_id = nuevoPadre;
  }

  try {
    return await repo.actualizar(id, campos);
  } catch (err) {
    if (err.code === '23505') {
      throw _err(409, 'Ya existe una ubicación con ese nombre en este mismo nivel', 'UBICACION_DUPLICADA');
    }
    throw err;
  }
};

// Baja lógica, y solo si está vacía. Ver la cabecera: el CASCADE de
// `ubicaciones_items` convertiría un borrado en una desasignación masiva
// silenciosa.
const eliminar = async (id, negocioId) => {
  _exigirTablas();

  const actual = await repo.getById(id, negocioId);
  if (!actual || !actual.activo) throw _err(404, 'Ubicación no encontrada');

  const [items, hijas] = await Promise.all([
    repo.contarItems(id),
    repo.contarHijasActivas(id),
  ]);

  if (items > 0) {
    throw _err(409,
      `"${actual.nombre}" todavía tiene ${items} ${items === 1 ? 'producto' : 'productos'}. Muévelos a otra ubicación antes de eliminarla.`,
      'UBICACION_CON_CONTENIDO');
  }
  if (hijas > 0) {
    throw _err(409,
      `"${actual.nombre}" contiene ${hijas} ${hijas === 1 ? 'sub-ubicación' : 'sub-ubicaciones'}. Elimínalas o muévelas primero.`,
      'UBICACION_CON_HIJAS');
  }

  await repo.desactivar(id);
  return { id: Number(id) };
};

const guardarGeometria = async (posiciones, sucursalId, negocioId) => {
  _exigirTablas();

  if (!Array.isArray(posiciones) || !posiciones.length) return { actualizadas: 0 };

  const limpias = posiciones
    .filter((p) => p && p.id)
    .map((p) => ({
      id:    Number(p.id),
      pos_x: p.pos_x  === null || p.pos_x  === undefined ? null : Number(p.pos_x),
      pos_y: p.pos_y  === null || p.pos_y  === undefined ? null : Number(p.pos_y),
      ancho: p.ancho  === null || p.ancho  === undefined ? null : Number(p.ancho),
      alto:  p.alto   === null || p.alto   === undefined ? null : Number(p.alto),
    }));

  const actualizadas = await repo.guardarGeometria(sucursalId, negocioId, limpias);
  return { actualizadas };
};

// ── Asignar y mover ──────────────────────────────────────────────────────────
//
// Es la operación más usada del módulo y la que mantiene el mapa vivo. Acepta
// una LISTA porque el caso real es "selecciono seis cosas y las mando al Cajón
// B7", y porque el escaneo encadena varias sin recargar la pantalla.
//
// `ubicacion_id: null` desasigna — devolver algo a la bandeja de "sin ubicar"
// tiene que ser tan fácil como sacarlo de ahí.
//
// Todo en UNA transacción: si el tercer nodo de la lista es de otra sucursal,
// no puede quedar la mitad movida. Un movimiento a medias en una bodega es peor
// que no haberlo hecho, porque nadie sabe cuál mitad.
const asignar = async ({ ubicacion_id, items }, sucursalId, negocioId, usuarioId) => {
  _exigirTablas();

  if (!Array.isArray(items) || !items.length) {
    throw _err(400, 'No hay productos que mover');
  }

  const destino = ubicacion_id === null || ubicacion_id === undefined
    ? null
    : await repo.getById(ubicacion_id, negocioId);

  if (ubicacion_id !== null && ubicacion_id !== undefined) {
    if (!destino || !destino.activo) throw _err(404, 'La ubicación de destino no existe');
    if (Number(destino.sucursal_id) !== Number(sucursalId)) {
      throw _err(400, 'La ubicación de destino es de otra sucursal');
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Los nombres de las ubicaciones se traen UNA vez para toda la lista, no
    // uno por producto: mover treinta cosas no puede costar treinta consultas
    // sobre una base que comparten 28 negocios. Solo se piden si de verdad se
    // va a registrar el historial.
    const nombres = hayMovimientosUbicacion()
      ? await repo.nombresDeUbicaciones(client, sucursalId, negocioId)
      : new Map();

    let movidos = 0;
    let registrados = 0;

    for (const item of items) {
      const nivel = String(item?.nivel || '').trim();
      const id    = Number(item?.id);

      if (!repo.NODOS[nivel] || !id) {
        throw _err(400, `Producto no válido en la lista (${nivel || 'sin tipo'})`);
      }

      // La mercancía tiene que ser de la misma sucursal que el estante. Se
      // comprueba SIEMPRE, aunque el id venga de una pantalla que ya filtró: la
      // base la comparten 28 negocios y un id ajeno colgaría su mercancía de
      // nuestro mapa.
      const nodo = await repo.datosDelNodo(client, nivel, id, negocioId);
      if (!nodo) throw _err(404, 'Uno de los productos no existe o no es de este negocio');
      if (Number(nodo.sucursal_id) !== Number(sucursalId)) {
        throw _err(400, 'Uno de los productos es de otra sucursal');
      }

      const hacia = destino ? Number(destino.id) : null;
      const { desde: desdeCrudo } = destino
        ? await repo.asignarNodo(client, destino.id, nivel, id, usuarioId)
        : await repo.quitarNodo(client, nivel, id);
      const desde = desdeCrudo === null ? null : Number(desdeCrudo);

      movidos += 1;

      // Volver a guardar algo donde ya estaba no es un movimiento. Sin este
      // corte, escanear dos veces la misma caja —que pasa constantemente con un
      // lector— llenaría el historial de líneas que no cuentan nada y taparía
      // las que sí.
      if (desde === hacia) continue;

      await repo.registrarMovimiento(client, {
        sucursalId,
        nivel,
        id,
        etiqueta:    nodo.etiqueta,
        desde,
        hacia,
        desdeNombre: desde !== null ? (nombres.get(desde) ?? null) : null,
        haciaNombre: destino ? destino.nombre : null,
        usuarioId,
      });
      registrados += 1;
    }

    await client.query('COMMIT');
    return {
      movidos,
      registrados,
      ubicacion_id: destino ? Number(destino.id) : null,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

// ── Historial ────────────────────────────────────────────────────────────────
//
// No exige la tabla: si el historial no está aplicado, devuelve una lista vacía
// y la pantalla dice "todavía no hay movimientos" en vez de reventar. Registrar
// es un extra; mover, la operación diaria.
const getMovimientos = async (sucursalId, negocioId, opciones = {}) => {
  _exigirTablas();

  // Un id de ubicación ajeno no puede usarse ni para filtrar: se valida igual
  // que en cualquier otra lectura por :id.
  if (opciones.ubicacionId) {
    const ubicacion = await repo.getById(opciones.ubicacionId, negocioId);
    if (!ubicacion) throw _err(404, 'Ubicación no encontrada');
  }

  return repo.listarMovimientos(sucursalId, negocioId, opciones);
};

module.exports = {
  getUbicaciones,
  getArbol,
  getDetalle,
  getItems,
  getSinAsignar,
  buscar,
  ubicacionesDe,
  crear,
  actualizar,
  eliminar,
  guardarGeometria,
  asignar,
  getMovimientos,
  MAX_PROFUNDIDAD,
};
