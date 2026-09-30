const IS_PROD = process.env.NODE_ENV === 'production';

// Un 23505 a secas («Ya existe un registro con ese valor único») no le dice a
// nadie QUÉ choca: con él Tesla no pudo saber que el envío #75 fallaba por un
// producto eliminado en el local (29-sep-2026). Para los índices del catálogo
// se nombra el valor; el primer campo de la clave sale de `err.detail`
// («Key (nombre, sucursal_id)=(X, 49) already exists.»).
const DUPLICADOS = {
  productos_cantidad_nombre_sucursal_id_key: (v) =>
    `Ya existe un producto llamado "${v}" en esta sucursal. Si no lo ves en el inventario, `
    + 'es porque fue eliminado: el nombre sigue ocupado.',
  uq_productos_cantidad_codigo: (v) => `El código "${v}" ya lo usa otro producto de esta sucursal`,
  uq_atributos_producto_codigo: (v) => `El código "${v}" ya lo usa otra variante de esta sucursal`,
  atributos_producto_producto_id_sucursal_id_tipo_id_valor_key: () =>
    'Ese producto ya tiene una variante con ese valor (puede estar desactivada)',
};

const _primerValorClave = (detail) => {
  const m = /\)=\((.*)\) already exists/.exec(String(detail || ''));
  if (!m) return '';
  // Los valores van separados por ", "; el nombre puede traer comas, así que
  // se quita solo lo que sigue a la ÚLTIMA (sucursal_id, un número).
  return m[1].replace(/, \d+$/, '');
};

const mensajeDuplicado = (err) => {
  const armar = DUPLICADOS[err.constraint];
  if (armar) {
    const v = _primerValorClave(err.detail);
    if (err.constraint.startsWith('uq_')) {
      // Estos índices son (sucursal_id, codigo): el valor que importa es el último.
      const m = /\)=\(\d+, (.*)\) already exists/.exec(String(err.detail || ''));
      return armar(m ? m[1] : v);
    }
    return armar(v);
  }
  return 'Ya existe un registro con ese valor único';
};

const errorHandler = (err, req, res, next) => {
  // Log completo siempre en servidor
  console.error(`[ERROR] ${req.method} ${req.url} →`, err);

  // El candado de técnicos externos (trigger fn_serial_en_tecnico). Lo lanza
  // la BASE, así que llega por cualquiera de los caminos que tocan `seriales`
  // —vender, prestar, retomar, recibir una remisión—; su mensaje ya dice dónde
  // está el equipo y qué hacer, y es lo que la pantalla tiene que mostrar.
  // Lo que va en camino en un envío de la red interna no se vende, presta ni
  // baja (triggers de 20260926_reserva_transito.sql). El mensaje ya dice qué
  // envío es y qué hacer.
  if (err.code === 'RT001') {
    return res.status(409).json({ ok: false, error: err.message, code: 'EN_TRANSITO' });
  }

  if (err.code === 'ST001') {
    return res.status(409).json({ ok: false, error: err.message, code: 'EQUIPO_EN_TECNICO' });
  }

  if (err.code === '23505') {
    return res.status(409).json({ ok: false, error: mensajeDuplicado(err) });
  }

  if (err.code === '23503') {
    console.error('[FK 23503] table:', err.table);
  console.error('[FK 23503] constraint:', err.constraint);
  console.error('[FK 23503] detail:', err.detail);
    return res.status(400).json({ ok: false, error: 'El registro referenciado no existe' });
  }

  // ── En producción: nunca exponer err.message de errores inesperados ──
  const status = err.status || 500;
  const mensaje =
    err.status                            // error operacional conocido (lanzado con err.status)
      ? err.message
      : IS_PROD
        ? 'Error interno del servidor'
        : err.message;

  // Código de error operacional (ej. IMEI_PRESTADO) para que el frontend
  // pueda distinguir casos específicos. Solo en errores lanzados con err.status.
  const payload = { ok: false, error: mensaje };
  if (err.status && err.code) payload.code = err.code;
  if (err.status && err.detalle) payload.detalle = err.detalle;

  res.status(status).json(payload);
};

module.exports = { errorHandler };