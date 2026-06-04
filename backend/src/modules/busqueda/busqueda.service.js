const repo = require('./busqueda.repository');

const _esAdmin = (rol) => rol === 'admin_negocio';

// ─── Historial por IMEI ───────────────────────────────────────────────────────

const buscarPorIMEI = async (query, negocioId, rol) => {
  const admin = _esAdmin(rol);

  const candidatos = await repo.buscarSerialPorIMEI(query, negocioId);
  if (candidatos.length === 0) return null;

  const exacto = candidatos.find((c) => c.imei.toLowerCase() === query.toLowerCase());
  const serial = exacto ?? (candidatos.length === 1 ? candidatos[0] : null);

  if (!serial) {
    return {
      candidatos: candidatos.map((c) => ({
        imei:            c.imei,
        producto_nombre: c.producto_nombre,
        marca:           c.marca,
        modelo:          c.modelo,
        vendido:         c.vendido,
        prestado:        c.prestado,
        sucursal_nombre: c.sucursal_nombre,
      })),
    };
  }

  const [ventas, retomas, prestamos, traslados] = await Promise.all([
    repo.getVentasPorIMEI(serial.imei, negocioId),
    repo.getRetomasPorIMEI(serial.imei, negocioId),
    repo.getPrestamosPorIMEI(serial.imei, negocioId),
    repo.getTrasladosPorIMEI(serial.imei, negocioId),
  ]);

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

const buscarCompras = async (q, modo, negocioId, sucursalId, rol, proveedorIds = null) => {
  const admin = _esAdmin(rol);
  const filtroSucursal = admin ? null : sucursalId;

  if (modo === 'imei') {
    const [lineas, retomas] = await Promise.all([
      repo.buscarComprasPorIMEI(q, negocioId, proveedorIds),
      repo.getRetomasPorIMEI(q, negocioId),
    ]);
    return { lineas, retomas };
  }

  const lineas = await repo.buscarComprasPorTexto(q, negocioId, filtroSucursal, proveedorIds);
  return { lineas, retomas: [] };
};

// ─── Búsqueda de préstamos ────────────────────────────────────────────────────

const buscarPrestamos = async (filtros, negocioId, sucursalId, rol) => {
  const admin = _esAdmin(rol);
  const { suc, ...filtrosSinSuc } = filtros;
  const filtroSucursal = admin ? (suc ? Number(suc) : null) : sucursalId;

  const [prestamos, abonosTotales] = await Promise.all([
    repo.buscarPrestamos(filtrosSinSuc, negocioId, filtroSucursal),
    repo.buscarAbonosTotales(filtrosSinSuc, negocioId, filtroSucursal),
  ]);

  return { prestamos, abonosTotales };
};

const getHistorialCantidad = async (productoId, negocioId) =>
  repo.getHistorialCantidad(productoId, negocioId);

module.exports = { buscarPorIMEI, buscarProductos, buscarCompras, buscarPrestamos, getHistorialCantidad };
