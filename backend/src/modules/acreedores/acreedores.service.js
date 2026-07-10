const { pool } = require('../../config/db');
const repo = require('./acreedores.repository');

const getAcreedores = (negocioId, filtro) => repo.findAll(negocioId, filtro);

// Para usuarios no-admin: filtra por los proveedores que tienen permitidos
const getAcreedoresParaUsuario = (negocioId, permisos, filtro) => {
  if (!permisos || !permisos.ver) return Promise.resolve([]);
  if (permisos.ver_todos) return repo.findAll(negocioId, filtro);
  return repo.findByProveedorIds(negocioId, permisos.ver_lista || [], filtro);
};

// Solo acreedores vinculados a cruces — mantenida por compatibilidad interna
const getAcreedoresCruces = (negocioId, filtro) => repo.findByCruces(negocioId, filtro);

const getAcreedorById = async (negocioId, id) => {
  const acreedor = await repo.findById(negocioId, id);
  if (!acreedor) throw { status: 404, message: 'Acreedor no encontrado' };

  const movimientos = await repo.getMovimientos(negocioId, id);

  const saldo = movimientos.length > 0
    ? Number(movimientos[movimientos.length - 1].saldo_despues)
    : 0;

  return { ...acreedor, saldo, movimientos };
};

const crearAcreedor = async (negocioId, datos) => {
  const { rows } = await pool.query(
    `SELECT id FROM acreedores WHERE negocio_id = $1 AND cedula = $2 LIMIT 1`,
    [negocioId, datos.cedula]
  );
  if (rows.length) {
    throw { status: 409, message: `Ya existe un acreedor con la cédula ${datos.cedula}` };
  }
  return repo.create(negocioId, datos);
};

const registrarMovimiento = async (negocioId, acreedorId, datos) => {
  const acreedor = await repo.findById(negocioId, acreedorId);
  if (!acreedor) throw { status: 404, message: 'Acreedor no encontrado' };

  if (datos.tipo === 'Abono' && datos.cargo_id) {
    const { rows } = await pool.query(`
      SELECT GREATEST(m.valor - COALESCE(SUM(a.valor), 0), 0) AS saldo_pendiente
      FROM movimientos_acreedor m
      LEFT JOIN movimientos_acreedor a ON a.cargo_id = m.id AND a.tipo = 'Abono'
      WHERE m.id = $1 AND m.acreedor_id = $2 AND m.tipo = 'Cargo'
      GROUP BY m.id
    `, [datos.cargo_id, acreedorId]);
    if (rows.length && Number(datos.valor) > Number(rows[0].saldo_pendiente)) {
      throw { status: 400, message: 'El abono no puede superar el saldo pendiente del cargo' };
    }
  }

  return repo.insertarMovimiento({ ...datos, acreedor_id: acreedorId });
};

const getCargosAbiertos = async (negocioId, acreedorId) => {
  const acreedor = await repo.findById(negocioId, acreedorId);
  if (!acreedor) throw { status: 404, message: 'Acreedor no encontrado' };
  return repo.getCargosAbiertos(negocioId, acreedorId);
};

const getComprasConSaldo = async (negocioId, acreedorId) => {
  const acreedor = await repo.findById(negocioId, acreedorId);
  if (!acreedor) throw { status: 404, message: 'Acreedor no encontrado' };
  return repo.getComprasConSaldo(negocioId, acreedorId);
};

const getAbonosPorCargo = async (negocioId, acreedorId, cargoId) => {
  const acreedor = await repo.findById(negocioId, acreedorId);
  if (!acreedor) throw { status: 404, message: 'Acreedor no encontrado' };
  return repo.getAbonosPorCargo(negocioId, acreedorId, cargoId);
};

const getSaldoAFavor = async (negocioId, acreedorId) => {
  const acreedor = await repo.findById(negocioId, acreedorId);
  if (!acreedor) throw { status: 404, message: 'Acreedor no encontrado' };
  return repo.getSaldoAFavor(negocioId, acreedorId);
};

const aplicarSaldoAFavor = async (negocioId, acreedorId, cargoId, valor) => {
  const acreedor = await repo.findById(negocioId, acreedorId);
  if (!acreedor) throw { status: 404, message: 'Acreedor no encontrado' };
  return repo.aplicarSaldoAFavor(negocioId, acreedorId, cargoId, valor);
};

const registrarAbonoTotal = async (negocioId, acreedorId, { valor, metodo, registrar_en_caja, usuario_id, sucursal_id }) => {
  const acreedor = await repo.findById(negocioId, acreedorId);
  if (!acreedor) throw { status: 404, message: 'Acreedor no encontrado' };
  if (!valor || Number(valor) <= 0) throw { status: 400, message: 'El valor debe ser mayor a 0' };
  return repo.registrarAbonoTotal(negocioId, acreedorId, {
    valor: Number(valor), metodo, registrar_en_caja, usuario_id, sucursal_id,
  });
};

const eliminarAcreedor = async (negocioId, acreedorId) => {
  try {
    await repo.eliminarSeguro(negocioId, acreedorId);
  } catch (err) {
    if (err.code === '23503') {
      throw {
        status: 409,
        message: 'Este acreedor tiene registros vinculados en el sistema y no puede eliminarse.',
      };
    }
    throw err;
  }
};

// Los abonos espejo (mov_dinero_id) provienen de un pago hecho en Tesorería:
// editarlos o borrarlos aquí descuadraría el dinero. Se anulan desde
// Tesorería (extracto de la cuenta) y el sistema sincroniza ambos lados.
const _bloquearAbonoEspejo = async (movId) => {
  const { rows } = await pool.query(
    `SELECT id FROM movimientos_acreedor WHERE id = $1 AND mov_dinero_id IS NOT NULL`,
    [movId]
  );
  if (rows.length) {
    throw {
      status: 400,
      message: 'Este abono proviene de un pago hecho en Tesorería. Para modificarlo, anula el pago desde Tesorería (extracto de la cuenta) y el sistema cuadra ambos lados.',
    };
  }
};

const editarAbono = async (negocioId, acreedorId, movId, datos) => {
  const acreedor = await repo.findById(negocioId, acreedorId);
  if (!acreedor) throw { status: 404, message: 'Acreedor no encontrado' };
  await _bloquearAbonoEspejo(movId);
  // Si el abono queda ligado a un cargo, no puede superar el saldo pendiente de
  // ese cargo (mismo criterio que al crear). Evita dejar cargos sobre-pagados.
  if (datos.cargo_id) {
    const max = await repo.getMaxAbonoEditable(acreedorId, Number(datos.cargo_id), Number(movId));
    if (max !== null && Number(datos.valor) > max + 0.001) {
      throw { status: 400, message: `El abono no puede superar el saldo pendiente del cargo (${max.toLocaleString('es-CO')})` };
    }
  }
  return repo.editarAbono(negocioId, acreedorId, movId, datos);
};

const eliminarAbono = async (negocioId, acreedorId, movId) => {
  const acreedor = await repo.findById(negocioId, acreedorId);
  if (!acreedor) throw { status: 404, message: 'Acreedor no encontrado' };
  await _bloquearAbonoEspejo(movId);
  return repo.eliminarAbono(negocioId, acreedorId, movId);
};

const getHistorial = async (negocioId, acreedorId) => {
  const acreedor = await repo.findById(negocioId, acreedorId);
  if (!acreedor) throw { status: 404, message: 'Acreedor no encontrado' };
  return repo.getMovimientos(negocioId, acreedorId);
};

module.exports = {
  getAcreedores, getAcreedoresParaUsuario, getAcreedoresCruces, getAcreedorById,
  crearAcreedor, registrarMovimiento, getCargosAbiertos,
  getComprasConSaldo, getAbonosPorCargo,
  getSaldoAFavor, aplicarSaldoAFavor,
  registrarAbonoTotal,
  editarAbono, eliminarAbono,
  eliminarAcreedor, getHistorial,
};