const XLSX        = require('xlsx');
const { pool }    = require('../../config/db');
const service     = require('./importacion.service');
const { generarPlantillaBuffer } = require('./importacion.plantilla');
const { AVISO, crearInforme, aviso, limpiar } = require('./importacion.informe');
const configRepo  = require('../config/config.repository');
const lineasRepo  = require('../lineas/lineas.repository');
const proveedoresRepo = require('../proveedores/proveedores.repository');

const HOJAS_RESERVADAS = [
  'instrucciones', 'productos cantidad', 'cantidad', 'ejemplo producto', 'referencia',
];

const _esHojaSerial = (nombre) =>
  !HOJAS_RESERVADAS.includes(nombre.toLowerCase().trim());

// Normaliza el nombre de una columna del Excel a la clave que lee el service.
// Compartida entre la lectura de filas y la de cabeceras para que no se
// desincronicen: si una hoja "tiene columna IMEI" según la cabecera, las filas
// tienen que traer la clave `imei`.
const _normClave = (clave) =>
  String(clave ?? '')
    .replace(/\s*\*\s*/g, '')   // quita asteriscos (marcadores de requerido)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');      // espacios → guiones bajos

const _normalizarFila = (fila) => {
  const normalizada = {};
  for (const clave in fila) normalizada[_normClave(clave)] = fila[clave];
  return normalizada;
};

// Cabeceras reales de la hoja (fila 2 del Excel), normalizadas.
// Se leen aparte de las filas porque una hoja vacía no tiene filas pero sí
// cabecera, y necesitamos distinguir "hoja de seriales sin datos" (legítima:
// crea el producto) de "hoja que no es de seriales" (una «Hoja1» que alguien
// dejó en el libro y que antes generaba un producto fantasma).
const _cabeceras = (ws) => {
  const filas = XLSX.utils.sheet_to_json(ws, { header: 1, range: 1, defval: '' });
  return (filas[0] || []).map(_normClave).filter(Boolean);
};

// Nombre del producto: se toma de la celda título A1 ("📦  <nombre> — Hoja de Seriales"),
// porque el NOMBRE DE HOJA de Excel se trunca a 31 caracteres (genera nombres cortados
// y productos duplicados). Si el título está vacío o es el genérico de la plantilla,
// se cae al nombre de la hoja.
const _nombreProducto = (ws, nombreHoja) => {
  const a1 = ws && ws['A1'] && ws['A1'].v != null ? ws['A1'].v.toString() : '';
  const limpio = a1
    .replace(/\s*[—\-]\s*Hoja de Seriales.*$/i, '') // quita el sufijo del título
    .replace(/^[^\p{L}\p{N}]+/u, '')                 // quita emoji/espacios iniciales
    .trim();
  if (!limpio || /^ejemplo producto$/i.test(limpio)) return nombreHoja.trim();
  return limpio;
};

// ─── Generar plantilla dinámica ───────────────────────────────────────────────
const generarPlantilla = async (req, res, next) => {
  try {
    const negocioId = req.user.negocio_id;
    const [config, lineas, proveedores] = await Promise.all([
      configRepo.getMap(negocioId),
      lineasRepo.findAll(negocioId),
      proveedoresRepo.findAll(negocioId).catch(() => []),
    ]);
    const buffer = generarPlantillaBuffer(config, lineas, proveedores);

    res.setHeader('Content-Type',        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla_inventario.xlsx"');
    res.setHeader('Content-Length',      buffer.length);
    res.end(buffer);
  } catch (err) {
    next(err);
  }
};

// ─── Lectura del libro ────────────────────────────────────────────────────────
//
// Devuelve las hojas de serial ya agrupadas por producto y las filas de la hoja
// de cantidad. Todo lo que se descarta se ANOTA en el informe: una hoja
// ignorada en silencio es exactamente el tipo de cosa por la que el usuario
// cree que "algunos productos no se importaron".

const _leerLibro = (wb, informe) => {
  const hojas = [];
  let filasCantidad = [];

  for (const nombreHoja of wb.SheetNames) {
    const ws = wb.Sheets[nombreHoja];
    if (!ws) continue;

    const esCantidad = nombreHoja.toLowerCase().includes('cantidad');
    const cabeceras  = _cabeceras(ws);

    if (esCantidad) {
      const crudas = XLSX.utils.sheet_to_json(ws, { range: 1, defval: '' });
      filasCantidad = crudas
        .slice(1)
        .map((f, i) => ({ ..._normalizarFila(f), _fila: i + 4 }))
        .filter((f) => f.nombre?.toString().trim());
      continue;
    }

    if (!_esHojaSerial(nombreHoja)) {
      // La hoja de ejemplo se ignora a propósito — pero si el usuario la LLENÓ
      // sin renombrarla, ignorarla en silencio le deja un "no se encontraron
      // datos válidos" sin explicación. Es el error de primerizo más probable.
      if (nombreHoja.toLowerCase().trim() === 'ejemplo producto' && cabeceras.includes('imei')) {
        const conDatos = XLSX.utils.sheet_to_json(ws, { range: 1, defval: '' })
          .slice(1)
          .filter((f) => _normalizarFila(f).imei?.toString().trim());
        if (conDatos.length) {
          informe.hojas_ignoradas.push(nombreHoja);
          aviso(informe, {
            hoja: nombreHoja, fila: null, columna: null, valor: `${conDatos.length} fila(s)`,
            tipo: AVISO.HOJA_IGNORADA,
            mensaje: `Llenaste la hoja «Ejemplo Producto» pero no la renombraste, así que NO se importa.`,
            sugerencia: 'Cambia el nombre de la pestaña por el del producto real (ej: «iPhone 13 128GB») y vuelve a subir el archivo.',
          });
        }
      }
      continue;
    }

    // Una hoja de seriales SIN columna IMEI no es una hoja de seriales: es la
    // «Hoja1», el «Resumen» o los apuntes que el usuario dejó en el libro.
    // Antes se procesaba igual y, al no encontrar filas válidas, se creaba un
    // `productos_serial` vacío con ese nombre. En producción quedaron productos
    // llamados «Hola» y hasta uno con el nombre en blanco.
    if (!cabeceras.includes('imei')) {
      informe.hojas_ignoradas.push(nombreHoja);
      aviso(informe, {
        hoja: nombreHoja, fila: null, columna: null, valor: nombreHoja,
        tipo: AVISO.HOJA_IGNORADA,
        mensaje: `La hoja «${nombreHoja}» no tiene columna IMEI, así que no se importa.`,
        sugerencia: 'Si debía ser una hoja de seriales, cópiala de la plantilla oficial.',
      });
      continue;
    }

    const crudas = XLSX.utils.sheet_to_json(ws, { range: 1, defval: '' });
    const datos  = crudas
      .slice(1)
      .map((f, i) => ({ ..._normalizarFila(f), _fila: i + 4 }))
      .filter((f) => f.imei?.toString().trim());

    const nombreProducto = _nombreProducto(ws, nombreHoja);
    if (!nombreProducto.trim()) {
      informe.hojas_ignoradas.push(nombreHoja);
      aviso(informe, {
        hoja: nombreHoja, fila: null, columna: null, valor: null,
        tipo: AVISO.HOJA_IGNORADA,
        mensaje: 'La hoja no tiene nombre de producto (ni en el título ni en la pestaña) y no se importa.',
        sugerencia: 'Escribe el nombre del producto en la pestaña de la hoja.',
      });
      continue;
    }
    if (/^ejemplo producto/i.test(nombreProducto)) {
      aviso(informe, {
        hoja: nombreHoja, fila: null, columna: null, valor: nombreProducto,
        tipo: AVISO.HOJA_IGNORADA,
        mensaje: `El producto se llamará «${nombreProducto}» porque la hoja conserva el nombre de la plantilla.`,
        sugerencia: 'Renombra la pestaña con el nombre real del producto antes de importar.',
      });
    }

    hojas.push({ nombreProducto, nombreHoja, filas: datos });
  }

  return { hojas, filasCantidad };
};

// ─── Importar inventario (previsualización y aplicación) ──────────────────────
//
// `preview` corre EXACTAMENTE el mismo código dentro de una transacción que se
// revierte al final. El informe no puede divergir de lo que va a pasar porque
// es lo que pasó, deshecho.

const _procesar = async (req, res, next, preview) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No se recibió ningún archivo' });
    }

    const sucursalId = req.sucursal_id;
    const negocioId  = req.user.negocio_id;

    // Leer configuración del negocio para saber qué columnas procesar
    const config = await configRepo.getMap(negocioId);

    let wb;
    try {
      wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    } catch {
      return res.status(400).json({ ok: false, error: 'No se pudo leer el archivo. ¿Es un Excel válido?' });
    }

    const informe = crearInforme();
    const { hojas, filasCantidad } = _leerLibro(wb, informe);

    const resultado = { serial: null, cantidad: null };

    // En preview: UNA transacción para todo el libro, revertida al final. Así
    // los efectos entre hojas se acumulan igual que en la corrida real (un
    // producto creado en la hoja 1 sale como "actualizado" en la hoja 5).
    const client = preview ? await pool.connect() : null;
    try {
      if (client) await client.query('BEGIN');
      const opciones = { informe, client };

      if (hojas.length > 0) {
        resultado.serial = await service.importarSerial(hojas, sucursalId, negocioId, config, opciones);
      }
      if (filasCantidad.length > 0) {
        resultado.cantidad = await service.importarCantidad(filasCantidad, sucursalId, negocioId, config, opciones);
      }
      if (client) await client.query('ROLLBACK');
    } catch (err) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      if (client) client.release();
    }

    if (!resultado.serial && !resultado.cantidad) {
      // Si algo se descartó, decir QUÉ: "no se encontraron datos válidos" a
      // secas deja al usuario sin nada que corregir.
      const pista = informe.hojas_ignoradas.length
        ? ` Se ignoraron estas hojas: ${informe.hojas_ignoradas.join(', ')}.`
        : '';
      return res.status(400).json({
        ok: false,
        error: `No se encontraron datos para importar.${pista} Revisa el detalle.`,
        informe: limpiar(informe),
      });
    }

    const resumen = {
      productos_nuevos:      (resultado.cantidad?.insertados   ?? 0),
      productos_actualizados:(resultado.cantidad?.actualizados ?? 0),
      seriales_nuevos:       (resultado.serial?.insertados     ?? 0),
      seriales_actualizados: (resultado.serial?.actualizados   ?? 0),
      unidades_sumadas:      (resultado.cantidad?.unidades_sumadas ?? 0),
      omitidos:              (resultado.serial?.omitidos ?? 0) + (resultado.cantidad?.omitidos ?? 0),
      conflictos:            informe.conflictos.length,
      avisos:                informe.avisos.length,
      productos_serial:      hojas.length,
    };

    res.json({
      ok: true,
      data: { ...resultado, modo: preview ? 'preview' : 'aplicado', resumen, informe: limpiar(informe) },
    });
  } catch (err) {
    next(err);
  }
};

const analizarInventario = (req, res, next) => _procesar(req, res, next, true);
const importarInventario = (req, res, next) => _procesar(req, res, next, false);

module.exports = { generarPlantilla, analizarInventario, importarInventario };
