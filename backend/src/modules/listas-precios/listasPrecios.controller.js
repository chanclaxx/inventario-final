const svc = require('./listasPrecios.service');

const guardarPrecios = (req, res, next) =>
  svc.guardarPrecios(req.body?.nodos, req.user.negocio_id)
    .then((data) => res.json({ ok: true, data }))
    .catch(next);

const getPreciosProducto = (req, res, next) =>
  svc.getPreciosProducto(req.params.productoId, req.user.negocio_id)
    .then((data) => res.json({ ok: true, data }))
    .catch(next);

// `sucursales` viaja como lista separada por comas en el query (GET) o como
// arreglo en el cuerpo (POST). Quién puede tocarlas lo decide el service, no
// esto: aquí solo se normaliza la forma.
const _sucursalesDeQuery = (v) =>
  String(v ?? '').split(',').map((s) => Number(s.trim())).filter(Boolean);

// `variantes` ausente NO es «no»: es «decide tú», y el service lo resuelve con
// `variantes_activo`. Así un frontend viejo —o el enlace que alguien se guardó—
// baja la plantilla con las tallas, que es lo que hace falta para tarifar.
const _variantesDeQuery = (v) => {
  if (v === undefined || v === null || v === '') return undefined;
  return String(v) === '1';
};

const descargarPlantilla = (req, res, next) =>
  svc.generarPlantilla(req.user, {
    sucursales:       _sucursalesDeQuery(req.query.sucursales),
    incluirVariantes: _variantesDeQuery(req.query.variantes),
  })
    .then(({ buffer }) => {
      const fecha = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition',
        `attachment; filename="precios-por-lista-${fecha}.xlsx"`);
      res.send(buffer);
    })
    .catch(next);

const _sucursalesDeBody = (v) => {
  if (Array.isArray(v)) return v.map(Number).filter(Boolean);
  return _sucursalesDeQuery(v);
};

const analizarExcel = (req, res, next) =>
  svc.analizarExcel(req.user, req.file?.buffer, _sucursalesDeBody(req.body?.sucursales))
    .then((data) => res.json({ ok: true, data }))
    .catch(next);

const importarExcel = (req, res, next) =>
  svc.importarExcel(req.user, req.file?.buffer, _sucursalesDeBody(req.body?.sucursales))
    .then((data) => res.json({ ok: true, data }))
    .catch(next);

module.exports = {
  guardarPrecios, getPreciosProducto,
  descargarPlantilla, analizarExcel, importarExcel,
};
