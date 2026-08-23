const service = require('./redInterna.service');
const audit   = require('../../utils/auditoria.util');

// ── Panel principal: una sola ruta, dos caras ────────────────────────────────
// La UI no elige la vista: la decide el backend según la sucursal activa.
// Así el usuario de un local nunca ve las opciones de la bodega, ni al revés.
const getPanel = async (req, res, next) => {
  try {
    const data = req.esBodega
      ? await service.getPanelBodega(req)
      : await service.getPanelLocal(req);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

// Contexto liviano: lo usa el carrito de inventario para saber qué botón
// mostrar (despachar si estoy en la bodega, devolver si estoy en un local).
const getContexto = async (req, res, next) => {
  try {
    res.json({ ok: true, data: await service.getContexto(req) });
  } catch (err) { next(err); }
};

const getSucursales = async (req, res, next) => {
  try {
    res.json({ ok: true, data: await service.getSucursalesRed(req) });
  } catch (err) { next(err); }
};

// ── Remisiones ───────────────────────────────────────────────────────────────

// Un solo campo para el lector: resuelve IMEI o código único de accesorio.
// `imei` se mantiene como alias por compatibilidad.
const buscarParaDespacho = async (req, res, next) => {
  try {
    const data = await service.buscarParaDespacho(req, req.query.q ?? req.query.imei);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

// Previsualiza a qué referencia del destino va cada producto, ANTES de
// despachar. Es lo que evita crear referencias duplicadas a ciegas.
const previsualizarDestino = async (req, res, next) => {
  try {
    const { sucursal_destino_id, lineas } = req.body;
    const data = await service.previsualizarDestino(req, { sucursal_destino_id, lineas });
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

// Referencias de una sucursal, para elegir el destino a mano.
const catalogoReferencias = async (req, res, next) => {
  try {
    const data = await service.catalogoReferencias(req, {
      sucursalId: req.params.sucursalId, tipo: req.query.tipo, q: req.query.q,
    });
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const catalogoCantidad = async (req, res, next) => {
  try {
    const data = await service.catalogoCantidad(req, req.query.q || '');
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

// Traduce los ítems del carrito de inventario a líneas de despacho valorizadas.
const resolverItems = async (req, res, next) => {
  try {
    const data = await service.resolverItems(req, req.body.items);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const despachar = async (req, res, next) => {
  try {
    const {
      sucursal_destino_id, lineas, notas, clave_idempotencia, permitir_valor_cero,
    } = req.body;
    const data = await service.despachar(req, {
      sucursal_destino_id, lineas, notas, clave_idempotencia, permitir_valor_cero,
    });
    if (!data.repetido) {
      audit.registrar(req.user.negocio_id, req.user.id, 'Remisión despachada', 'red_interna', data.id, {
        sucursal_id:         Number(req.sucursal_id),
        sucursal_destino_id: Number(sucursal_destino_id),
        items:               (lineas || []).length,
        valor_total:         data.valor_total,
      });
    }
    res.status(201).json({ ok: true, data, message: 'Remisión enviada' });
  } catch (err) { next(err); }
};

const recibir = async (req, res, next) => {
  try {
    const { lineas_recibidas, cantidades } = req.body;
    const data = await service.recibir(req, Number(req.params.id), {
      lineas_recibidas, cantidades,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Remisión recibida', 'red_interna', data.id, {
      sucursal_id: Number(req.sucursal_id),
      recibidas:   data.recibidas,
      faltantes:   data.faltantes,
    });
    res.json({
      ok: true, data,
      message: data.faltantes
        ? `Recibiste ${data.recibidas}. ${data.faltantes} quedaron reportados como no llegados.`
        : 'Recepción confirmada',
    });
  } catch (err) { next(err); }
};

const anularRemision = async (req, res, next) => {
  try {
    const data = await service.anularRemision(req, Number(req.params.id));
    audit.registrar(req.user.negocio_id, req.user.id, 'Remisión anulada', 'red_interna', data.id, {
      sucursal_id: Number(req.sucursal_id),
    });
    res.json({ ok: true, data, message: 'Remisión anulada' });
  } catch (err) { next(err); }
};

const devolver = async (req, res, next) => {
  try {
    const { lineas, notas, motivo } = req.body;
    const data = await service.devolver(req, { lineas, notas, motivo });
    audit.registrar(req.user.negocio_id, req.user.id, 'Devolución a bodega', 'red_interna', data.id, {
      sucursal_id: Number(req.sucursal_id),
      items:       (lineas || []).length,
    });
    res.status(201).json({ ok: true, data, message: 'Devolución registrada' });
  } catch (err) { next(err); }
};

// Previsualiza una devolución: de dónde viene cada unidad (bodega o propia).
const previsualizarDevolucion = async (req, res, next) => {
  try {
    const data = await service.previsualizarDevolucion(req, { lineas: req.body.lineas });
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

// La bodega confirma una devolución: aquí sí se mueve el inventario.
const confirmarDevolucion = async (req, res, next) => {
  try {
    const data = await service.confirmarDevolucion(req, Number(req.params.id), {
      lineas_recibidas: req.body.lineas_recibidas,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Devolución confirmada', 'red_interna', data.id, {
      sucursal_id: Number(req.sucursal_id),
      recibidas: data.recibidas, faltantes: data.faltantes,
      saldo_a_favor: data.saldo_a_favor,
    });
    res.json({
      ok: true, data,
      message: data.saldo_a_favor > 0
        ? `Devolución confirmada. Se abonaron ${data.saldo_a_favor} a favor del local.`
        : 'Devolución confirmada',
    });
  } catch (err) { next(err); }
};

// Corrige el valor de una línea (directo si va en tránsito, con nota si no).
const corregirValorLinea = async (req, res, next) => {
  try {
    const data = await service.corregirValorLinea(req, Number(req.params.lineaId), {
      valor_nuevo: req.body.valor_nuevo, motivo: req.body.motivo,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Corrección de valor', 'red_interna', data.linea_id, {
      sucursal_id: Number(req.sucursal_id),
      valor_anterior: data.valor_anterior, valor_nuevo: data.valor_nuevo,
    });
    res.json({ ok: true, data, message: 'Valor corregido' });
  } catch (err) { next(err); }
};

// Cuentas desde las que el local puede remitir.
const getCuentasParaRemesa = async (req, res, next) => {
  try {
    res.json({ ok: true, data: await service.getCuentasParaRemesa(req) });
  } catch (err) { next(err); }
};

const listarRemisiones = async (req, res, next) => {
  try {
    const data = await service.listarRemisiones(req, {
      estado: req.query.estado,
      limit:  Math.min(Number(req.query.limit) || 50, 200),
    });
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getRemision = async (req, res, next) => {
  try {
    res.json({ ok: true, data: await service.getRemision(req, Number(req.params.id)) });
  } catch (err) { next(err); }
};

// ── Remesas de efectivo ──────────────────────────────────────────────────────

const enviarRemesa = async (req, res, next) => {
  try {
    const {
      valor, notas, clave_idempotencia, cuenta_origen_id, metodo, remision_id,
    } = req.body;
    const data = await service.enviarRemesa(req, {
      valor, notas, clave_idempotencia, cuenta_origen_id, metodo, remision_id,
    });
    if (!data.repetido) {
      audit.registrar(req.user.negocio_id, req.user.id, 'Remesa enviada', 'red_interna', data.id, {
        sucursal_id: Number(req.sucursal_id), valor: data.valor,
        // A qué envíos se imputó: sin esto la auditoría no explicaría por qué
        // bajó el saldo de un envío concreto.
        reparto: (data.reparto || []).map((r) => r.numero ?? r.remision_id),
      });
    }
    const n = (data.reparto || []).length;
    res.status(201).json({
      ok: true, data,
      message: n > 1 ? `Pago enviado — cubre ${n} envíos` : 'Pago enviado a la bodega',
    });
  } catch (err) { next(err); }
};

const confirmarRemesa = async (req, res, next) => {
  try {
    const data = await service.confirmarRemesa(req, Number(req.params.id));
    audit.registrar(req.user.negocio_id, req.user.id, 'Remesa confirmada', 'red_interna', data.id, {
      sucursal_id: Number(req.sucursal_id), valor: data.valor,
    });
    res.json({ ok: true, data, message: 'Remesa confirmada' });
  } catch (err) { next(err); }
};

const anularRemesa = async (req, res, next) => {
  try {
    const data = await service.anularRemesa(req, Number(req.params.id));
    audit.registrar(req.user.negocio_id, req.user.id, 'Remesa anulada', 'red_interna', data.id, {
      sucursal_id: Number(req.sucursal_id),
    });
    res.json({ ok: true, data, message: 'Remesa anulada' });
  } catch (err) { next(err); }
};

const listarRemesas = async (req, res, next) => {
  try {
    const data = await service.listarRemesas(req, {
      estado: req.query.estado,
      limit:  Math.min(Number(req.query.limit) || 50, 200),
    });
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

// ── Cuenta interna ───────────────────────────────────────────────────────────

const gastoAutorizado = async (req, res, next) => {
  try {
    const { valor, concepto, cuenta_origen_id } = req.body;
    const data = await service.registrarGastoAutorizado(req, {
      valor, concepto, cuenta_origen_id,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Gasto por cuenta de bodega', 'red_interna', data.id, {
      sucursal_id: Number(req.sucursal_id), valor: data.valor,
    });
    res.status(201).json({ ok: true, data, message: 'Gasto registrado' });
  } catch (err) { next(err); }
};

const ajuste = async (req, res, next) => {
  try {
    const data = await service.registrarAjuste(req, req.body);
    audit.registrar(req.user.negocio_id, req.user.id, 'Ajuste de cuenta interna', 'red_interna', data.id, {
      sucursal_id: Number(req.body.sucursal_id), valor: data.valor,
    });
    res.status(201).json({ ok: true, data, message: 'Ajuste registrado' });
  } catch (err) { next(err); }
};

// La bodega decide sobre un gasto que el local le pasó.
const decidirGasto = async (req, res, next) => {
  try {
    const aprobar = req.body.aprobar !== false;
    const data = await service.decidirGasto(req, Number(req.params.id), {
      aprobar, motivo: req.body.motivo,
    });
    audit.registrar(req.user.negocio_id, req.user.id,
      aprobar ? 'Gasto aprobado' : 'Gasto rechazado', 'red_interna', data.id, {
        sucursal_id: Number(data.sucursal_id), valor: data.valor,
      });
    res.json({ ok: true, data, message: aprobar ? 'Gasto aprobado' : 'Gasto rechazado' });
  } catch (err) { next(err); }
};

// Anular un gasto o un ajuste mal registrado.
const anularMovimientoCuenta = async (req, res, next) => {
  try {
    const data = await service.anularMovimientoCuenta(req, Number(req.params.id), {
      motivo: req.body?.motivo,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Movimiento de cuenta anulado',
      'red_interna', data.id, { sucursal_id: Number(req.sucursal_id), motivo: req.body?.motivo });
    res.json({ ok: true, data, message: 'Movimiento anulado' });
  } catch (err) { next(err); }
};

// Mueve un abono al envío correcto.
const moverAbono = async (req, res, next) => {
  try {
    const data = await service.moverAbono(req, Number(req.params.id), {
      remision_id: req.body.remision_id,
    });
    audit.registrar(req.user.negocio_id, req.user.id, 'Abono reimputado',
      'red_interna', data.id, {
        sucursal_id: Number(req.sucursal_id),
        remision_id: data.remision_id, valor: data.valor,
      });
    res.json({ ok: true, data, message: 'Abono movido al otro envío' });
  } catch (err) { next(err); }
};

const getMovimientosCuenta = async (req, res, next) => {
  try {
    const data = await service.getMovimientosCuenta(req, req.query.sucursal);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

// ── Conciliación y salud ─────────────────────────────────────────────────────

const getConciliacion = async (req, res, next) => {
  try {
    const data = await service.getConciliacion(req, req.params.sucursalId);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

// Diagnóstico del catálogo: qué referencias parecen duplicadas hoy.
const getReferenciasDuplicadas = async (req, res, next) => {
  try {
    res.json({ ok: true, data: await service.getReferenciasDuplicadas(req) });
  } catch (err) { next(err); }
};

// Estado de cuenta completo de un local (extracto + mercancía + documentos).
const getEstadoCuenta = async (req, res, next) => {
  try {
    const { desde, hasta, q, estado, limit, offset } = req.query;
    const data = await service.getEstadoCuenta(req, req.params.sucursalId, {
      desde: desde || null, hasta: hasta || null,
      q: q || '', estado: estado || null, limit, offset,
    });
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const getSalud = async (req, res, next) => {
  try {
    res.json({ ok: true, data: await service.getSalud(req) });
  } catch (err) { next(err); }
};

module.exports = {
  getPanel, getSucursales, getContexto,
  buscarParaDespacho, catalogoCantidad, resolverItems,
  previsualizarDestino, catalogoReferencias,
  despachar, recibir, anularRemision,
  devolver, previsualizarDevolucion, confirmarDevolucion,
  corregirValorLinea, getCuentasParaRemesa,
  listarRemisiones, getRemision,
  enviarRemesa, confirmarRemesa, anularRemesa, listarRemesas,
  gastoAutorizado, ajuste, getMovimientosCuenta,
  decidirGasto, anularMovimientoCuenta, moverAbono,
  getConciliacion, getEstadoCuenta, getSalud, getReferenciasDuplicadas,
};
