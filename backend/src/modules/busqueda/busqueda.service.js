const repo = require('./busqueda.repository');

const _esAdmin = (rol) => rol === 'admin_negocio';

// ─── Historial por IMEI ───────────────────────────────────────────────────────

const buscarPorIMEI = async (imei, negocioId, rol) => {
  const admin = _esAdmin(rol);

  const [serial, ventas, retomas, prestamos, traslados] = await Promise.all([
    repo.getSerialPorIMEI(imei, negocioId),
    repo.getVentasPorIMEI(imei, negocioId),
    repo.getRetomasPorIMEI(imei, negocioId),
    repo.getPrestamosPorIMEI(imei, negocioId),
    repo.getTrasladosPorIMEI(imei, negocioId),
  ]);

  if (!serial) return null;

  // Capturar info sensible antes de borrarla del objeto serial
  const entradaDetalle = admin
    ? { costo_compra: serial.costo_compra, proveedor_nombre: serial.proveedor_nombre }
    : {};

  // Eliminar campos sensibles para no-admin
  if (!admin) {
    delete serial.costo_compra;
    delete serial.proveedor_id;
    delete serial.proveedor_nombre;
  }

  // Construir línea de tiempo unificada (tipo + fecha + detalle)
  const historial = [
    {
      tipo:   'entrada',
      fecha:  serial.fecha_entrada,
      detalle: entradaDetalle,
    },
    ...traslados.map((t) => ({
      tipo:           'traslado',
      fecha:          t.fecha,
      referencia_id:  t.id,
      detalle: {
        origen:  t.origen_nombre,
        destino: t.destino_nombre,
        usuario: t.usuario_nombre,
        notas:   t.notas,
      },
    })),
    ...prestamos.map((p) => ({
      tipo:           'prestamo',
      fecha:          p.fecha,
      referencia_id:  p.id,
      detalle: {
        prestatario:    p.prestatario,
        cedula:         p.cedula,
        telefono:       p.telefono,
        estado:         p.estado,
        valor_prestamo: p.valor_prestamo,
        saldo_pendiente: p.saldo_pendiente,
        usuario:        p.usuario_nombre,
        sucursal:       p.sucursal_nombre,
      },
    })),
    ...retomas.map((r) => ({
      tipo:           'retoma',
      fecha:          r.fecha,
      referencia_id:  r.factura_id,
      detalle: {
        descripcion:        r.descripcion,
        valor_retoma:       r.valor_retoma,
        ingreso_inventario: r.ingreso_inventario,
        cliente:            r.nombre_cliente,
        sucursal:           r.sucursal_nombre,
      },
    })),
    ...ventas.map((v) => ({
      tipo:           'venta',
      fecha:          v.fecha,
      referencia_id:  v.id,
      detalle: {
        cliente:       v.nombre_cliente,
        cedula:        v.cedula,
        celular:       v.celular,
        precio_venta:  v.precio_venta,
        estado_factura: v.estado,
        usuario:       v.usuario_nombre,
        sucursal:      v.sucursal_nombre,
      },
    })),
  ].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  return { serial, historial };
};

// ─── Búsqueda por nombre ──────────────────────────────────────────────────────

const buscarProductos = async (q, negocioId, sucursalId, rol) => {
  const admin = _esAdmin(rol);

  // Para admin: null → busca en todas las sucursales del negocio
  // Para supervisor/vendedor: sucursalId = su sucursal asignada
  const filtroSucursal = admin ? null : sucursalId;

  const [seriales, cantidad] = await Promise.all([
    repo.buscarSeriales(q, negocioId, filtroSucursal),
    repo.buscarCantidad(q, negocioId, filtroSucursal),
  ]);

  // Ocultar costo unitario para no-admin en productos de cantidad
  if (!admin) {
    cantidad.forEach((p) => { delete p.costo_unitario; });
  }

  return { seriales, cantidad };
};

// ─── Búsqueda de compras a proveedores ───────────────────────────────────────

const buscarCompras = async (q, modo, negocioId, sucursalId, rol) => {
  const admin = _esAdmin(rol);
  const filtroSucursal = admin ? null : sucursalId;

  if (modo === 'imei') {
    const [lineas, retomas] = await Promise.all([
      repo.buscarComprasPorIMEI(q, negocioId),
      repo.getRetomasPorIMEI(q, negocioId),
    ]);
    return { lineas, retomas };
  }

  const lineas = await repo.buscarComprasPorTexto(q, negocioId, filtroSucursal);
  return { lineas, retomas: [] };
};

// ─── Búsqueda de préstamos ────────────────────────────────────────────────────

const buscarPrestamos = async (filtros, negocioId, sucursalId, rol) => {
  const admin = _esAdmin(rol);
  const filtroSucursal = admin ? null : sucursalId;
  return repo.buscarPrestamos(filtros, negocioId, filtroSucursal);
};

module.exports = { buscarPorIMEI, buscarProductos, buscarCompras, buscarPrestamos };
