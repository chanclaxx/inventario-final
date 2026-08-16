const service = require('./borradores.service');

// ─────────────────────────────────────────────────────────────────────────────
// La sucursal SIEMPRE sale de `req.sucursal_id` (resuelto por el middleware),
// nunca del body. Los borradores son por sucursal: aceptar la sucursal del
// cliente permitiría leer o borrar los de otra sede del mismo negocio.
// ─────────────────────────────────────────────────────────────────────────────

const getBorradores = async (req, res, next) => {
  try {
    const data = await service.listar(req.sucursal_id, req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

// Devuelve el borrador revalidado contra el inventario de hoy:
// `items` (lo que sí se puede vender) y `no_disponibles` (lo que no, con motivo).
const getBorradorById = async (req, res, next) => {
  try {
    const data = await service.obtener(req.params.id, req.sucursal_id, req.user.negocio_id);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const crearBorrador = async (req, res, next) => {
  try {
    const data = await service.crear({
      sucursalId: req.sucursal_id,
      negocioId:  req.user.negocio_id,
      usuarioId:  req.user.id,
      titulo:     req.body.titulo,
      destino:    req.body.destino,
      nota:       req.body.nota,
      // Lo que el vendedor alcanzó a diligenciar en el modal antes de que el
      // cliente interrumpiera.
      datos:      req.body.datos,
      items:      req.body.items,
    }, req.configBorradores);

    res.status(201).json({ ok: true, data, message: 'Borrador guardado' });
  } catch (err) { next(err); }
};

const editarBorrador = async (req, res, next) => {
  try {
    const data = await service.actualizar(
      req.params.id, req.sucursal_id, req.user.negocio_id, req.body
    );
    res.json({ ok: true, data, message: 'Borrador actualizado' });
  } catch (err) { next(err); }
};

// Se llama al cargar el borrador al carrito: el que se sigue trabajando no
// debería vencerse por el camino.
const renovarBorrador = async (req, res, next) => {
  try {
    const data = await service.renovar(
      req.params.id, req.sucursal_id, req.user.negocio_id, req.configBorradores
    );
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

const eliminarBorrador = async (req, res, next) => {
  try {
    await service.eliminar(req.params.id, req.sucursal_id, req.user.negocio_id);
    res.json({ ok: true, message: 'Borrador descartado' });
  } catch (err) { next(err); }
};

// El "robo": el producto estaba apalabrado en otro borrador y el vendedor
// decide llevárselo a este carrito.
const quitarItem = async (req, res, next) => {
  try {
    const data = await service.quitarItem(
      req.params.id, req.params.itemId, req.sucursal_id, req.user.negocio_id
    );
    res.json({
      ok: true,
      data,
      message: data.borrador_eliminado
        ? 'El borrador quedó vacío y se descartó'
        : 'Producto liberado del borrador',
    });
  } catch (err) { next(err); }
};

module.exports = {
  getBorradores,
  getBorradorById,
  crearBorrador,
  editarBorrador,
  renovarBorrador,
  eliminarBorrador,
  quitarItem,
};
