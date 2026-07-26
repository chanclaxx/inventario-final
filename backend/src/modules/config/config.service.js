const bcrypt = require('bcryptjs')
const repo   = require('./config.repository');

const SALT_ROUNDS = 10;

// ── Claves que requieren hasheo antes de guardarse ────────────────────────────
// Añadir aquí cualquier clave futura que deba hashearse.
const CLAVES_A_HASHEAR = new Set(['pin_eliminacion']);

const getConfig = (negocioId) => repo.getMap(negocioId);

const saveConfig = async (negocioId, datos) => {
  const datosProcesados = { ...datos };

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