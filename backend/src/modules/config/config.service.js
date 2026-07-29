const bcrypt = require('bcryptjs')
const repo   = require('./config.repository');

const SALT_ROUNDS = 10;

// ── Claves que requieren hasheo antes de guardarse ────────────────────────────
// Añadir aquí cualquier clave futura que deba hashearse.
const CLAVES_A_HASHEAR = new Set(['pin_eliminacion']);

// ── Validación de tarifas porcentuales ───────────────────────────────────────
// `tarifas_lista` es un JSON que el frontend parsea para calcular precios. Un
// valor corrupto aquí rompería el carrito en producción, así que se valida la
// forma antes de persistir. Solo se ejecuta si la clave viene en el payload:
// saveConfig recibe cambios parciales.
const MAX_TARIFAS = 20;

const _validarTarifasLista = (raw) => {
  let lista;
  try {
    lista = JSON.parse(raw);
  } catch {
    throw { status: 400, message: 'La lista de tarifas no es un JSON válido' };
  }
  if (!Array.isArray(lista)) {
    throw { status: 400, message: 'La lista de tarifas debe ser un arreglo' };
  }
  if (lista.length > MAX_TARIFAS) {
    throw { status: 400, message: `No puedes tener más de ${MAX_TARIFAS} tarifas` };
  }

  const ids = new Set();
  for (const t of lista) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) {
      throw { status: 400, message: 'Cada tarifa debe ser un objeto' };
    }
    if (typeof t.nombre !== 'string' || !t.nombre.trim()) {
      throw { status: 400, message: 'Cada tarifa necesita un nombre' };
    }
    const p = Number(t.porcentaje);
    if (!Number.isFinite(p) || p < 0 || p > 1000) {
      throw { status: 400, message: `Porcentaje inválido en la tarifa "${t.nombre}" (debe estar entre 0 y 1000)` };
    }
    if (typeof t.id !== 'string' || !t.id.trim()) {
      throw { status: 400, message: `La tarifa "${t.nombre}" no tiene identificador` };
    }
    if (ids.has(t.id)) {
      throw { status: 400, message: `Hay dos tarifas con el mismo identificador (${t.id})` };
    }
    ids.add(t.id);
  }
};

const getConfig = (negocioId) => repo.getMap(negocioId);

const saveConfig = async (negocioId, datos) => {
  const datosProcesados = { ...datos };

  if (datosProcesados.tarifas_lista !== undefined) {
    _validarTarifasLista(String(datosProcesados.tarifas_lista));
  }

  // Hashear las claves privadas antes de persistir
  for (const clave of CLAVES_A_HASHEAR) {
    if (clave in datosProcesados && datosProcesados[clave] !== '') {
      datosProcesados[clave] = await bcrypt.hash(String(datosProcesados[clave]), SALT_ROUNDS);
    }
    // Si viene vacío se ignora — no sobreescribir el hash existente con vacío
    if (clave in datosProcesados && datosProcesados[clave] === '') {
      delete datosProcesados[clave];
    }
  }

  const resultado = await repo.updateMany(negocioId, datosProcesados);

  // La config de red interna se cachea 60s en su middleware; al guardarla desde
  // Ajustes hay que invalidar para que el cambio se sienta de inmediato.
  if (Object.keys(datosProcesados).some((k) => k.startsWith('red_interna_'))) {
    require('../../middlewares/redInterna.middleware').invalidarCache(negocioId);
  }

  return resultado;
};

// Verifica un PIN ingresado contra el hash almacenado.
// Devuelve true/false — nunca expone el hash.
const verificarPin = async (negocioId, pinIngresado) => {
  if (!pinIngresado) return false;

  const hashGuardado = await repo.getValorPrivado(negocioId, 'pin_eliminacion');
  if (!hashGuardado) return false;

  return bcrypt.compare(String(pinIngresado), hashGuardado);
};

module.exports = { getConfig, saveConfig, verificarPin };