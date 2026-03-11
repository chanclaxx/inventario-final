const XLSX    = require('xlsx');
const service = require('./importacion.service');

const HOJAS_RESERVADAS = ['instrucciones', 'productos cantidad', 'cantidad'];

const _esHojaSerial = (nombre) =>
  !HOJAS_RESERVADAS.includes(nombre.toLowerCase().trim());

const _normalizarFila = (fila) => {
  const normalizada = {};
  for (const clave in fila) {
    const claveNorm = clave.replace(/\s*\*\s*/g, '').trim().toLowerCase();
    normalizada[claveNorm] = fila[clave];
  }
  return normalizada;
};

const importarInventario = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No se recibió ningún archivo' });
    }

    const sucursalId = req.sucursal_id;
    const negocioId  = req.user.negocio_id;
    const wb         = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const resultado  = { serial: null, cantidad: null };

    const hojasSerial = wb.SheetNames.filter(_esHojaSerial);

    if (hojasSerial.length > 0) {
      const hojas = hojasSerial.map((nombreHoja) => {
        const filas = XLSX.utils.sheet_to_json(wb.Sheets[nombreHoja], {
  range: 1,
  defval: '',
});
console.log('HOJA:', nombreHoja);
console.log('FILAS RAW:', JSON.stringify(filas.slice(0, 4)));
console.log('DATOS NORMALIZADOS:', JSON.stringify(filas.slice(1).map(_normalizarFila).slice(0, 3)));
        const datos = filas
          .slice(1)
          .map(_normalizarFila)
          .filter((f) => f.imei?.toString().trim());

        return { nombreProducto: nombreHoja.trim(), filas: datos };
      }).filter((h) => h.filas.length > 0);

      if (hojas.length > 0) {
        resultado.serial = await service.importarSerial(hojas, sucursalId, negocioId);
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
        resultado.cantidad = await service.importarCantidad(datos, sucursalId, negocioId);
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

module.exports = { importarInventario };