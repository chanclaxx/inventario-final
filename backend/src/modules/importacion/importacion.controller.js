const XLSX        = require('xlsx');
const service     = require('./importacion.service');
const { generarPlantillaBuffer } = require('./importacion.plantilla');
const configRepo  = require('../config/config.repository');
const lineasRepo  = require('../lineas/lineas.repository');

const HOJAS_RESERVADAS = ['instrucciones', 'productos cantidad', 'cantidad', 'ejemplo producto'];

const _esHojaSerial = (nombre) =>
  !HOJAS_RESERVADAS.includes(nombre.toLowerCase().trim());

const _normalizarFila = (fila) => {
  const normalizada = {};
  for (const clave in fila) {
    const claveNorm = clave
      .replace(/\s*\*\s*/g, '')   // quita asteriscos (marcadores de requerido)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');      // espacios → guiones bajos
    normalizada[claveNorm] = fila[clave];
  }
  return normalizada;
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
    const [config, lineas] = await Promise.all([
      configRepo.getMap(negocioId),
      lineasRepo.findAll(negocioId),
    ]);
    const buffer    = generarPlantillaBuffer(config, lineas);

    res.setHeader('Content-Type',        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla_inventario.xlsx"');
    res.setHeader('Content-Length',      buffer.length);
    res.end(buffer);
  } catch (err) {
    next(err);
  }
};

// ─── Importar inventario ──────────────────────────────────────────────────────
const importarInventario = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No se recibió ningún archivo' });
    }

    const sucursalId = req.sucursal_id;
    const negocioId  = req.user.negocio_id;

    // Leer configuración del negocio para saber qué columnas procesar
    const config = await configRepo.getMap(negocioId);

    const wb        = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const resultado = { serial: null, cantidad: null };

    const hojasSerial = wb.SheetNames.filter(_esHojaSerial);

    if (hojasSerial.length > 0) {
      const hojas = [];
      for (const nombreHoja of hojasSerial) {
        const ws    = wb.Sheets[nombreHoja];
        const filas = XLSX.utils.sheet_to_json(ws, {
          range:  1,
          defval: '',
        });
        const datos = filas
          .slice(1)
          .map(_normalizarFila)
          .filter((f) => f.imei?.toString().trim());

        hojas.push({ nombreProducto: _nombreProducto(ws, nombreHoja), filas: datos });
      }

      if (hojas.length > 0) {
        resultado.serial = await service.importarSerial(hojas, sucursalId, negocioId, config);
      }
    }

    const hojaCantidad = wb.SheetNames.find((n) =>
      n.toLowerCase().includes('cantidad')
    );

    if (hojaCantidad) {
      const filas = XLSX.utils.sheet_to_json(wb.Sheets[hojaCantidad], {
        range:  1,
        defval: '',
      });
      const datos = filas
        .slice(1)
        .map(_normalizarFila)
        .filter((f) => f.nombre?.toString().trim());

      if (datos.length > 0) {
        resultado.cantidad = await service.importarCantidad(datos, sucursalId, negocioId, config);
      }
    }

    if (!resultado.serial && !resultado.cantidad) {
      return res.status(400).json({
        ok: false,
        error: 'No se encontraron datos válidos. Verifica que el archivo siga la plantilla oficial.',
      });
    }

    res.json({ ok: true, data: resultado });
  } catch (err) {
    next(err);
  }
};

module.exports = { generarPlantilla, importarInventario };
