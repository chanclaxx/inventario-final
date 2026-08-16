const repo = require('./borradores.repository');

// ─────────────────────────────────────────────────────────────────────────────
// BORRADORES DE VENTA
//
// Un borrador es el carrito del cliente que "ya vuelvo": conserva el precio
// negociado y advierte a los demás vendedores de que esa mercancía está
// apalabrada.
//
// ── La reserva es BLANDA ─────────────────────────────────────────────────────
// Nada de lo que pasa aquí bloquea una venta. El inventario no se toca, el
// backend de facturas sigue vendiendo cualquier serial disponible con su
// FOR UPDATE de siempre, y este módulo solo responde "oye, eso está apalabrado".
// Si algún día una reserva impide facturar, la feature dejó de servir y el
// negocio la apaga.
// ─────────────────────────────────────────────────────────────────────────────

const DESTINOS = new Set(['factura', 'prestamo', 'indefinido']);

const MAX_TITULO = 120;
const MAX_NOTA   = 500;
const MAX_ITEMS  = 200;   // un carrito real no pasa de 30; esto solo frena abusos

// Tope del formulario guardado. Un modal de factura lleno —cliente, pagos,
// retomas, domicilio, crédito— no llega a 8 KB; 64 KB deja margen de sobra y
// evita que alguien use la columna como almacén.
const MAX_DATOS_BYTES = 64 * 1024;

// ── Normalización de lo que llega del carrito ────────────────────────────────

const _num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const _int = (v) => {
  const n = _num(v);
  return n === null ? null : Math.trunc(n);
};

const _texto = (v, max) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
};

/**
 * Convierte los ítems del carrito en filas listas para insertar.
 *
 * El carrito manda `precioFinal` (camelCase, como lo guarda Zustand) y aquí se
 * vuelve `precio_final`. Es el único punto de traducción: si el borrador
 * guardara el nombre del carrito, cualquier renombrado del store rompería datos
 * ya escritos en la BD.
 */
const _normalizarItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw { status: 400, message: 'El borrador necesita al menos un producto' };
  }
  if (items.length > MAX_ITEMS) {
    throw { status: 400, message: `Un borrador no puede tener más de ${MAX_ITEMS} productos` };
  }

  const vistos = new Set();
  const salida = [];

  for (const it of items) {
    const itemKey = _texto(it.key ?? it.item_key, 200);
    if (!itemKey) {
      throw { status: 400, message: 'Hay un producto sin identificador en el carrito' };
    }
    // El índice único (borrador_id, item_key) reventaría el INSERT entero.
    // Un duplicado es un error del cliente, no del usuario: se ignora en
    // silencio en vez de tumbarle el guardado.
    if (vistos.has(itemKey)) continue;
    vistos.add(itemKey);

    const tipo = it.tipo === 'serial' ? 'serial' : 'cantidad';

    const nombre = _texto(it.nombre, 300);
    if (!nombre) {
      throw { status: 400, message: 'Hay un producto sin nombre en el carrito' };
    }

    const precioFinal = _num(it.precioFinal ?? it.precio_final ?? it.precio);
    if (precioFinal === null || precioFinal < 0) {
      throw { status: 400, message: `Precio inválido en "${nombre}"` };
    }

    const serialId   = _int(it.serial_id);
    const productoId = _int(it.producto_id);

    // Un ítem que no apunta a nada real sería una reserva fantasma: bloquearía
    // sin que se pueda saber qué bloquea.
    if (tipo === 'serial' && !serialId) {
      throw { status: 400, message: `El equipo "${nombre}" no tiene serial identificado` };
    }
    if (tipo === 'cantidad' && !productoId) {
      throw { status: 400, message: `El producto "${nombre}" no tiene identificador` };
    }

    const cantidad = _int(it.cantidad) || 1;
    if (cantidad < 1) {
      throw { status: 400, message: `Cantidad inválida en "${nombre}"` };
    }

    salida.push({
      item_key:       itemKey,
      tipo,
      nombre,
      serial_id:      tipo === 'serial'   ? serialId   : null,
      imei:           _texto(it.imei, 60),
      producto_id:    tipo === 'cantidad' ? productoId : null,
      atributo_id:    _int(it.atributo_id),
      variante_id:    _int(it.variante_id),
      atributo_label: _texto(it.atributo_label, 120),
      variante_label: _texto(it.variante_label, 120),
      // El serial es unitario por definición: dos IMEI son dos ítems.
      cantidad:       tipo === 'serial' ? 1 : cantidad,
      precio:         _num(it.precio),
      precio_final:   precioFinal,
      costo:          _num(it.costo),
      tarifa_id:      _int(it.tarifa_id),
      origen_precio:  _texto(it.origen_precio, 20),
      linea_id:       _int(it.linea_id),
    });
  }

  if (!salida.length) {
    throw { status: 400, message: 'El borrador necesita al menos un producto' };
  }
  return salida;
};

/**
 * Serializa el formulario a medio llenar del modal.
 *
 * Es un BLOB OPACO: el backend no mira lo que hay dentro ni lo valida campo por
 * campo, y no debe hacerlo. Es un borrador — nada de esto entra en un cálculo.
 * Cuando la venta se hace de verdad, el payload se arma desde el formulario
 * vivo del modal y `facturas.service` lo revalida entero (stock, seriales,
 * precios, cupos). Validar aquí sería duplicar esas reglas en un sitio que no
 * puede mantenerlas al día.
 *
 * Lo único que se controla es el tamaño.
 */
const _normalizarDatos = (datos) => {
  if (datos === null || datos === undefined) return null;
  if (typeof datos !== 'object' || Array.isArray(datos)) {
    throw { status: 400, message: 'Formato de datos inválido' };
  }

  let texto;
  try {
    texto = JSON.stringify(datos);
  } catch {
    // Referencias circulares: el cliente mandó algo que no es serializable.
    throw { status: 400, message: 'Formato de datos inválido' };
  }

  if (Buffer.byteLength(texto, 'utf8') > MAX_DATOS_BYTES) {
    throw { status: 400, message: 'Los datos del formulario son demasiado grandes' };
  }
  return texto;
};

// ── Decoración de lectura ────────────────────────────────────────────────────

const _diasPara = (fecha) => {
  if (!fecha) return null;
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
};

const _decorar = (b) => ({
  ...b,
  total:     Number(b.total || 0),
  num_items: Number(b.num_items || 0),
  // Alimenta el badge "vence hoy" de la tarjeta. null = no vence nunca.
  dias_para_vencer: _diasPara(b.expira_en),
});

// ── Casos de uso ─────────────────────────────────────────────────────────────

const listar = async (sucursalId, negocioId) => {
  const filas = await repo.listar(sucursalId, negocioId);
  return filas.map(_decorar);
};

/**
 * Revalida un borrador contra el inventario de HOY.
 *
 * Sin esto, cargar un borrador de la semana pasada es una decepción garantizada:
 * el equipo se vendió, el producto se agotó o alguien lo trasladó. Se devuelve
 * lo que sí se puede vender y, aparte, lo que no y por qué — el mismo contrato
 * `{ items, descartados }` que ya usa el despacho de red interna.
 *
 * NUNCA lanza por un ítem no disponible: un borrador con la mitad de la
 * mercancía vendida sigue siendo útil, y decidir qué hacer es del vendedor.
 */
const obtener = async (id, sucursalId, negocioId) => {
  const borrador = await repo.obtener(id, sucursalId, negocioId);
  if (!borrador) throw { status: 404, message: 'Borrador no encontrado' };

  const items = borrador.items || [];

  const [seriales, productos, atributos, variantes] = await Promise.all([
    repo.estadoSeriales(
      items.filter((i) => i.serial_id).map((i) => i.serial_id), sucursalId, negocioId),
    repo.estadoProductosCantidad(
      items.filter((i) => i.producto_id && !i.atributo_id && !i.variante_id).map((i) => i.producto_id),
      sucursalId, negocioId),
    repo.estadoAtributos(
      items.filter((i) => i.atributo_id && !i.variante_id).map((i) => i.atributo_id), sucursalId),
    repo.estadoVariantes(
      items.filter((i) => i.variante_id).map((i) => i.variante_id), sucursalId),
  ]);

  const porId = (filas) => new Map(filas.map((f) => [Number(f.id), f]));
  const mapSeriales  = porId(seriales);
  const mapProductos = porId(productos);
  const mapAtributos = porId(atributos);
  const mapVariantes = porId(variantes);

  const disponibles   = [];
  const noDisponibles = [];

  for (const item of items) {
    const { estado, motivo, stock } = _evaluar(item, {
      mapSeriales, mapProductos, mapAtributos, mapVariantes,
    });

    if (estado === 'no_disponible') {
      noDisponibles.push({ ...item, motivo });
      continue;
    }

    // El borrador no guarda marca ni modelo (son del producto, no del trato),
    // pero el carrito los lleva y el payload del traslado los lee. Se reponen
    // desde el JOIN que la revalidación ya hizo, para que un borrador cargado
    // sea indistinguible de un carrito recién armado.
    const s = item.serial_id ? mapSeriales.get(Number(item.serial_id)) : null;
    const conProducto = s
      ? { ...item, marca: s.marca ?? null, modelo: s.modelo ?? null }
      : item;

    // Parcial: quedan menos unidades de las apalabradas. Se carga lo que hay y
    // se avisa — mejor vender 2 de 5 que no vender nada.
    if (estado === 'parcial') {
      disponibles.push({ ...conProducto, cantidad: stock, stock, aviso: motivo });
      continue;
    }

    disponibles.push({ ...conProducto, stock: stock ?? null });
  }

  return {
    ..._decorar(borrador),
    items:          disponibles,
    no_disponibles: noDisponibles,
  };
};

/**
 * Regla de disponibilidad. Es distinta por familia a propósito:
 *
 *   serial   → binario. Un IMEI es una unidad física: o está o no está.
 *   cantidad → contra el stock. Si hay 200 forros y 1 está apalabrado, no hay
 *              nada que avisar; avisar igual convierte la alerta en ruido que
 *              el vendedor aprende a descartar sin leer.
 */
const _evaluar = (item, mapas) => {
  if (item.tipo === 'serial') {
    const s = mapas.mapSeriales.get(Number(item.serial_id));
    if (!s)             return { estado: 'no_disponible', motivo: 'Ya no está en el inventario' };
    if (s.vendido)      return { estado: 'no_disponible', motivo: 'Ya fue vendido' };
    if (s.prestado)     return { estado: 'no_disponible', motivo: 'Está prestado' };
    if (!s.en_sucursal) return { estado: 'no_disponible', motivo: 'Se trasladó a otra sucursal' };
    return { estado: 'disponible', stock: 1 };
  }

  // Productos con árbol: el stock real vive en la variante o en el atributo,
  // no en productos_cantidad (que lo agrega).
  const fila = item.variante_id ? mapas.mapVariantes.get(Number(item.variante_id))
    : item.atributo_id          ? mapas.mapAtributos.get(Number(item.atributo_id))
      : mapas.mapProductos.get(Number(item.producto_id));

  if (!fila) return { estado: 'no_disponible', motivo: 'Ya no está en esta sucursal' };
  if (fila.activo === false) return { estado: 'no_disponible', motivo: 'El producto fue dado de baja' };

  const stock    = Number(fila.stock || 0);
  const pedida   = Number(item.cantidad || 1);

  if (stock <= 0)     return { estado: 'no_disponible', motivo: 'Sin stock' };
  if (stock < pedida) return { estado: 'parcial', stock, motivo: `Solo quedan ${stock} de ${pedida}` };
  return { estado: 'disponible', stock };
};

const crear = async ({ sucursalId, negocioId, usuarioId, titulo, destino, nota, datos, items }, cfg) => {
  // El título ya no lo escribe nadie: sale del nombre del cliente que el
  // vendedor alcanzó a teclear en el modal. Si el cliente interrumpió antes de
  // decir su nombre, se guarda igual con una etiqueta genérica — pedirle un
  // título al vendedor en ese momento es justo la fricción que la feature
  // existe para quitar.
  const tituloLimpio = _texto(titulo, MAX_TITULO) || 'Sin nombre';

  const destinoLimpio = DESTINOS.has(destino) ? destino : 'indefinido';
  const filas = _normalizarItems(items);

  const id = await repo.crear({
    sucursalId,
    usuarioId,
    titulo:  tituloLimpio,
    destino: destinoLimpio,
    nota:    _texto(nota, MAX_NOTA),
    datos:   _normalizarDatos(datos),
    dias:    cfg.vencen ? cfg.dias : 0,
    items:   filas,
  });

  const creado = await repo.obtener(id, sucursalId, negocioId);
  return creado ? _decorar(creado) : { id };
};

const actualizar = async (id, sucursalId, negocioId, datos) => {
  const campos = {};

  if (datos.titulo !== undefined) {
    const t = _texto(datos.titulo, MAX_TITULO);
    if (!t) throw { status: 400, message: 'El nombre del borrador no puede quedar vacío' };
    campos.titulo = t;
  }
  if (datos.destino !== undefined) {
    if (!DESTINOS.has(datos.destino)) throw { status: 400, message: 'Destino inválido' };
    campos.destino = datos.destino;
  }
  if (datos.nota !== undefined) campos.nota = _texto(datos.nota, MAX_NOTA);
  if (datos.datos !== undefined) campos.datos = _normalizarDatos(datos.datos);

  if (!Object.keys(campos).length) {
    throw { status: 400, message: 'No hay nada que actualizar' };
  }

  const ok = await repo.actualizar(id, sucursalId, negocioId, campos);
  if (!ok) throw { status: 404, message: 'Borrador no encontrado' };

  return _decorar(await repo.obtener(id, sucursalId, negocioId));
};

/** El borrador que se sigue trabajando no debería vencerse. */
const renovar = async (id, sucursalId, negocioId, cfg) => {
  const ok = await repo.renovar(id, sucursalId, negocioId, cfg.vencen ? cfg.dias : 0);
  if (!ok) throw { status: 404, message: 'Borrador no encontrado' };
  return _decorar(await repo.obtener(id, sucursalId, negocioId));
};

const eliminar = async (id, sucursalId, negocioId) => {
  const ok = await repo.eliminar(id, sucursalId, negocioId);
  if (!ok) throw { status: 404, message: 'Borrador no encontrado' };
  return true;
};

/**
 * Quita un ítem del borrador — el "robo" para llevarlo a otro carrito.
 *
 * Si el borrador queda sin ítems se descarta entero: un borrador vacío no
 * reserva nada y solo ensucia la lista.
 */
const quitarItem = async (borradorId, itemId, sucursalId, negocioId) => {
  const { borrado, restantes } = await repo.eliminarItem(borradorId, itemId, sucursalId, negocioId);
  if (!borrado) throw { status: 404, message: 'Ese producto ya no está en el borrador' };

  if (restantes === 0) {
    await repo.eliminar(borradorId, sucursalId, negocioId);
    return { borrador_eliminado: true, restantes: 0 };
  }
  return { borrador_eliminado: false, restantes };
};

module.exports = {
  listar,
  obtener,
  crear,
  actualizar,
  renovar,
  eliminar,
  quitarItem,
};
