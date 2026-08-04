const repo        = require('./catalogo.repository');
const repoPublico = require('./catalogo.publico.repository');
const storage     = require('./catalogo.storage');

// ── Límites ─────────────────────────────────────────────────────────────────
const MAX_IMAGENES        = 6;
const MAX_DESCRIPCION     = 2000;
const MAX_TITULO          = 120;
const MAX_MARCA           = 60;
const MAX_PUBLICAR_MASIVO = 500;

// Rutas que no pueden ser un slug porque chocarían con la propia app pública
// o con la interna. Se comparan en minúsculas.
const SLUGS_RESERVADOS = new Set([
  'api', 'admin', 'www', 'app', 'login', 'registro', 'superadmin', 'config',
  'assets', 'static', 'public', 'catalogo', 'inventario', 'facturar', 'caja',
  'reportes', 'tesoreria', 'bodega', 'busqueda', 'prestamos', 'servicios',
  '_next', 'sitemap', 'robots', 'favicon', 'health', 'null', 'undefined',
]);

const RE_SLUG = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

// ── Helpers ─────────────────────────────────────────────────────────────────

const _texto = (valor, max) => {
  if (valor === undefined || valor === null) return null;
  const limpio = String(valor).trim();
  return limpio ? limpio.slice(0, max) : null;
};

const _bool = (valor, porDefecto) => (valor === undefined ? porDefecto : Boolean(valor));

const _dinero = (valor) => {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0) {
    throw { status: 400, message: 'El precio público no es válido' };
  }
  return n;
};

/** Convierte un nombre en un slug candidato ("Sucursal Centro" → "sucursal-centro"). */
const slugify = (texto) =>
  String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // quita las tildes que NFD separó
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

const _validarSlug = (raw) => {
  const slug = String(raw || '').trim().toLowerCase();
  if (!slug) {
    throw { status: 400, message: 'La dirección del catálogo es obligatoria' };
  }
  if (!RE_SLUG.test(slug)) {
    throw {
      status: 400,
      message: 'La dirección solo puede tener letras minúsculas, números y guiones '
             + '(entre 3 y 50 caracteres, sin empezar ni terminar en guión)',
    };
  }
  if (SLUGS_RESERVADOS.has(slug)) {
    throw { status: 400, message: `"${slug}" es una dirección reservada. Elige otra.` };
  }
  return slug;
};

// El número se guarda solo con dígitos. Colombia por defecto: 10 dígitos que
// empiezan por 3 se prefijan con 57, porque es el error más común al escribirlo.
const _validarWhatsapp = (raw) => {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const digitos = String(raw).replace(/\D/g, '');
  if (digitos.length < 10 || digitos.length > 15) {
    throw { status: 400, message: 'El número de WhatsApp no es válido' };
  }
  return digitos.length === 10 && digitos.startsWith('3') ? `57${digitos}` : digitos;
};

const _validarColor = (raw) => {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const color = String(raw).trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw { status: 400, message: 'El color debe estar en formato #RRGGBB' };
  }
  return color.toLowerCase();
};

// ── Vitrina ─────────────────────────────────────────────────────────────────

const getVitrina = async (negocioId, sucursalId) => {
  const vitrina = await repo.getVitrina(sucursalId, negocioId);
  // Sin vitrina creada todavía: se devuelve un borrador con el slug sugerido
  // para que el formulario tenga algo que mostrar sin escribir en la BD.
  if (!vitrina) return null;
  return vitrina;
};

const listarVitrinas = (negocioId) => repo.listarVitrinas(negocioId);

const guardarVitrina = async (negocioId, sucursalId, datos) => {
  const slug = _validarSlug(datos.slug);

  if (await repo.slugOcupado(slug, sucursalId)) {
    throw { status: 409, message: `La dirección "${slug}" ya está en uso. Elige otra.` };
  }

  return repo.upsertVitrina(negocioId, sucursalId, {
    slug,
    activo:                 _bool(datos.activo, false),
    titulo:                 _texto(datos.titulo, MAX_TITULO),
    descripcion:            _texto(datos.descripcion, MAX_DESCRIPCION),
    whatsapp:               _validarWhatsapp(datos.whatsapp),
    direccion:              _texto(datos.direccion, 200),
    horario:                _texto(datos.horario, 200),
    color_primario:         _validarColor(datos.color_primario),
    mostrar_precios:        _bool(datos.mostrar_precios, true),
    mostrar_disponibilidad: _bool(datos.mostrar_disponibilidad, true),
    ocultar_agotados:       _bool(datos.ocultar_agotados, false),
  });
};

// ── Fichas ──────────────────────────────────────────────────────────────────

const listarItems = async (sucursalId, tipo) => {
  if (tipo === 'serial')   return repo.listarItemsSerial(sucursalId);
  if (tipo === 'cantidad') return repo.listarItemsCantidad(sucursalId);
  const [serial, cantidad] = await Promise.all([
    repo.listarItemsSerial(sucursalId),
    repo.listarItemsCantidad(sucursalId),
  ]);
  return [...serial, ...cantidad];
};

// Detalle de una ficha con sus imágenes. La lista de arriba solo trae el
// CONTEO de fotos (traer todas las URLs de todo el inventario sería un payload
// enorme para una pantalla que casi siempre solo necesita saber si hay o no).
const getItemDetalle = async (negocioId, itemId) => {
  const item = await repo.getItem(itemId, negocioId);
  if (!item) throw { status: 404, message: 'Ficha de catálogo no encontrada' };
  return item;
};

const _normalizarTipo = (tipo) => {
  if (tipo !== 'serial' && tipo !== 'cantidad') {
    throw { status: 400, message: 'Tipo de producto no válido' };
  }
  return tipo;
};

const guardarItem = async (negocioId, sucursalId, datos) => {
  const tipo       = _normalizarTipo(datos.tipo);
  const productoId = Number(datos.producto_id);

  if (!Number.isInteger(productoId) || productoId <= 0) {
    throw { status: 400, message: 'Producto no válido' };
  }
  // No hay FK (el tipo decide la tabla), así que la pertenencia se comprueba
  // aquí: sin esto se podría crear una ficha para un producto de otro negocio.
  if (!await repo.productoExisteEnSucursal(tipo, productoId, sucursalId)) {
    throw { status: 404, message: 'El producto no existe en esta sucursal' };
  }

  return repo.upsertItem(negocioId, sucursalId, tipo, productoId, {
    publicado:      _bool(datos.publicado, false),
    titulo:         _texto(datos.titulo, MAX_TITULO),
    descripcion:    _texto(datos.descripcion, MAX_DESCRIPCION),
    marca:          _texto(datos.marca, MAX_MARCA),
    precio_publico: _dinero(datos.precio_publico),
    mostrar_precio: _bool(datos.mostrar_precio, true),
    destacado:      _bool(datos.destacado, false),
    orden:          Number.isFinite(Number(datos.orden)) ? Number(datos.orden) : 0,
  });
};

const publicarMasivo = async (negocioId, sucursalId, datos) => {
  const tipo = _normalizarTipo(datos.tipo);
  const ids  = Array.from(new Set(
    (Array.isArray(datos.producto_ids) ? datos.producto_ids : [])
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0)
  ));

  if (!ids.length) {
    throw { status: 400, message: 'No seleccionaste ningún producto' };
  }
  if (ids.length > MAX_PUBLICAR_MASIVO) {
    throw { status: 400, message: `No puedes publicar más de ${MAX_PUBLICAR_MASIVO} productos a la vez` };
  }

  // Se filtran contra la sucursal ANTES de escribir: un id de otro negocio
  // colado en el array crearía una ficha que no le corresponde.
  const validos = [];
  for (const id of ids) {
    if (await repo.productoExisteEnSucursal(tipo, id, sucursalId)) validos.push(id);
  }
  if (!validos.length) {
    throw { status: 404, message: 'Ninguno de los productos pertenece a esta sucursal' };
  }

  const afectados = await repo.publicarMasivo(
    negocioId, sucursalId, tipo, validos, _bool(datos.publicado, true)
  );
  return { afectados, ignorados: ids.length - validos.length };
};

// ── Imágenes ────────────────────────────────────────────────────────────────

const subirImagen = async (negocioId, itemId, archivo, usuarioId) => {
  const item = await repo.getItem(itemId, negocioId);
  if (!item) throw { status: 404, message: 'Ficha de catálogo no encontrada' };

  if (await repo.contarImagenes(itemId) >= MAX_IMAGENES) {
    throw { status: 400, message: `Máximo ${MAX_IMAGENES} imágenes por producto` };
  }
  if (!archivo?.buffer) {
    throw { status: 400, message: 'No llegó ninguna imagen' };
  }

  const subida = await storage.subir(archivo.buffer, { negocioId, itemId });

  try {
    return await repo.crearImagen(itemId, {
      ...subida,
      alt:        item.titulo || null,
      usuario_id: usuarioId,
    });
  } catch (err) {
    // Si la fila no se pudo guardar, el archivo ya subido no debe quedarse
    // ocupando espacio sin que nada lo referencie.
    await storage.borrar(subida.storage_path);
    throw err;
  }
};

const eliminarImagen = async (negocioId, imagenId) => {
  const imagen = await repo.getImagen(imagenId, negocioId);
  if (!imagen) throw { status: 404, message: 'Imagen no encontrada' };

  // Primero la BD: si el borrado en el bucket falla, la foto ya desapareció de
  // la vitrina, que es lo que el usuario pidió. El huérfano es recuperable.
  await repo.eliminarImagen(imagenId);
  await storage.borrar(imagen.storage_path);
  return true;
};

const reordenarImagenes = async (negocioId, itemId, ids) => {
  const item = await repo.getItem(itemId, negocioId);
  if (!item) throw { status: 404, message: 'Ficha de catálogo no encontrada' };

  const propias = new Set((item.imagenes || []).map((i) => Number(i.id)));
  const orden   = (Array.isArray(ids) ? ids : [])
    .map(Number)
    .filter((id) => propias.has(id));

  if (!orden.length) throw { status: 400, message: 'Orden de imágenes no válido' };

  await repo.reordenarImagenes(itemId, orden);
  return repo.getItem(itemId, negocioId);
};

// ── Lectura pública ─────────────────────────────────────────────────────────

const getCatalogoPublico = async (slug) => {
  const vitrina = await repoPublico.getVitrinaPorSlug(String(slug || '').trim());
  if (!vitrina) throw { status: 404, message: 'Catálogo no encontrado' };

  const productos = await repoPublico.getProductosPublicados(vitrina);

  // Los interruptores de la vitrina se aplican AQUÍ, al armar la respuesta:
  // así el dato oculto no viaja por la red y no basta con abrir las
  // herramientas del navegador para verlo.
  const visibles = productos.map((p) => ({
    id:          p.id,
    nombre:      p.nombre,
    descripcion: p.descripcion,
    marca:       p.marca,
    linea:       p.linea,
    modelo:      p.modelo,
    unidad:      p.unidad_medida,
    precio:      vitrina.mostrar_precios ? (p.precio != null ? Number(p.precio) : null) : null,
    disponible:  vitrina.mostrar_disponibilidad ? p.disponible : null,
    destacado:   p.destacado,
    imagenes:    p.imagenes || [],
  }));

  const lineas = [...new Set(visibles.map((p) => p.linea).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, 'es')
  );

  return {
    vitrina: {
      slug:        vitrina.slug,
      titulo:      vitrina.titulo,
      descripcion: vitrina.descripcion,
      whatsapp:    vitrina.whatsapp,
      direccion:   vitrina.direccion,
      horario:     vitrina.horario,
      color:       vitrina.color_primario,
    },
    lineas,
    productos: visibles,
    total:     visibles.length,
  };
};

const listarSlugsActivos = () => repoPublico.listarSlugsActivos();

module.exports = {
  getVitrina, listarVitrinas, guardarVitrina,
  listarItems, getItemDetalle, guardarItem, publicarMasivo,
  subirImagen, eliminarImagen, reordenarImagenes,
  getCatalogoPublico, listarSlugsActivos,
  slugify, MAX_IMAGENES,
};
