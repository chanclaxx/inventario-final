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
    ? {
        costo_compra:     serial.costo_compra,
        // El costo que de verdad rige en esta sucursal si es un local de la red.
        costo_local:      serial.costo_local,
        proveedor_nombre: serial.proveedor_nombre,
      }
    : {};

  // Eliminar campos sensibles para no-admin
  if (!admin) {
    delete serial.costo_compra;
    delete serial.costo_local;
    delete serial.proveedor_id;
    delete serial.proveedor_nombre;
  }

  // ── Semáforo de garantía del proveedor (feature opt-in) ──────────────────
  // No es un dato sensible —no revela costos— así que lo ve cualquier rol: es
  // justo lo que necesita quien atiende al cliente que llega con el equipo.
  try {
    const { getConfigOrdenes } = require('../../middlewares/ordenesCompra.middleware');
    const cfg = await getConfigOrdenes(negocioId);
    if (cfg.garantia_activa) {
      const { estadoGarantia } = require('../procedencia/procedencia.service');
      Object.assign(serial, estadoGarantia(serial.garantia_hasta, cfg.garantia_dias_aviso));
    } else {
      delete serial.garantia_hasta;
    }
  } catch {
    // Sin config legible no hay semáforo, y la ficha sigue funcionando igual.
    delete serial.garantia_hasta;
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

// ─── Código único de producto (escaneo POS): match exacto ───────────────────

const buscarPorCodigo = async (codigo, negocioId, sucursalId, rol) => {
  const admin = _esAdmin(rol);

  // El escaneo se resuelve en la sucursal activa si la hay; un admin sin
  // sucursal seleccionada ve las coincidencias de todas.
  const resultados = await repo.buscarCantidadPorCodigo(codigo, negocioId, sucursalId || null);

  if (!admin) {
    resultados.forEach((p) => { delete p.costo_unitario; });
  }
  return resultados;
};

// ─── Escaneo del carrito: código único O IMEI ───────────────────────────────
//
// Un solo campo para los dos catálogos. El lector no dice qué escaneó, así que
// se resuelve por orden: primero el código único (que puede ser del producto,
// del atributo o de la variante) y solo si no existe se prueba como IMEI.
//
// El orden importa: el código único es de este negocio y lo asignó el usuario,
// mientras que el IMEI viene de fábrica. Si alguien usara un IMEI como código
// interno, gana el código — que es lo que configuró a propósito.
//
// Devuelve siempre la misma forma: { tipo: 'cantidad', nodos } |
// { tipo: 'serial', serial } | null si no existe ninguno de los dos.
const escanear = async (codigo, negocioId, sucursalId, rol) => {
  const nodos = await buscarPorCodigo(codigo, negocioId, sucursalId, rol);
  if (nodos.length) return { tipo: 'cantidad', nodos };

  const serial = await repo.buscarSerialPorCodigoExacto(codigo, negocioId, sucursalId || null);
  if (!serial) return null;

  // En un local de la red interna el costo que vale para calcular la tarifa es
  // el valor interno de la remisión, no `costo_compra` (que es el de la
  // bodega). El helper devuelve la lista intacta cuando no aplica; require
  // lazy para no acoplar la búsqueda con la red en negocios que no la usan.
  const { anotarConsignacionSeriales } = require('../red-interna/redInterna.service');
  const [anotado] = await anotarConsignacionSeriales([serial], {
    negocioId, sucursalId: serial.sucursal_id,
  });

  return { tipo: 'serial', serial: anotado };
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

module.exports = { buscarPorIMEI, buscarProductos, buscarPorCodigo, escanear, buscarCompras, buscarPrestamos, getHistorialCantidad };
