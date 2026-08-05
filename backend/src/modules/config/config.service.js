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

// ── Validación de condiciones de mora ────────────────────────────────────────
// Aquí no se re-implementa la validación: se reutiliza `normalizarCondicion` de
// mora.util, que es la MISMA función que usa el cálculo. Así es imposible que
// se guarde una condición que el motor luego descarte en silencio (y que el
// negocio crea que está cobrando mora cuando no).
const { normalizarCondicion, MAX_CONDICIONES } = require('../../utils/mora.util');
const { normalizarPlanInteres, MAX_PLANES }    = require('../../utils/interes.util');

const _validarMoraLista = (raw) => {
  let lista;
  try {
    lista = JSON.parse(raw);
  } catch {
    throw { status: 400, message: 'La lista de condiciones de mora no es un JSON válido' };
  }
  if (!Array.isArray(lista)) {
    throw { status: 400, message: 'La lista de condiciones de mora debe ser un arreglo' };
  }
  if (lista.length > MAX_CONDICIONES) {
    throw { status: 400, message: `No puedes tener más de ${MAX_CONDICIONES} condiciones de mora` };
  }

  const ids = new Set();
  for (const cruda of lista) {
    const c = normalizarCondicion(cruda);
    if (!c) {
      const etiqueta = cruda?.nombre ? `"${cruda.nombre}"` : 'una de las condiciones';
      throw {
        status: 400,
        message: `Revisa ${etiqueta}: necesita nombre y un valor válido `
          + `(porcentaje mensual entre 0 y 100, o un valor fijo por día).`,
      };
    }
    if (typeof cruda.id !== 'string' || !cruda.id.trim()) {
      throw { status: 400, message: `La condición "${c.nombre}" no tiene identificador` };
    }
    if (ids.has(c.id)) {
      throw { status: 400, message: `Hay dos condiciones de mora con el mismo identificador (${c.id})` };
    }
    ids.add(c.id);
  }
};

// El techo de aviso existe para no pasarse de la tasa de usura, que publica la
// Superintendencia Financiera cada mes. No se valida contra un valor fijo aquí
// a propósito: ese número cambia y quedaría desactualizado en el código.
const _validarTechoMora = (raw) => {
  const v = Number(raw);
  if (raw === '' || raw === null) return;
  if (!Number.isFinite(v) || v <= 0 || v > 100) {
    throw { status: 400, message: 'El techo de la tasa de mora debe ser un porcentaje mensual entre 0 y 100' };
  }
};

// Los planes de interés corriente. Mismo criterio que la mora: se rechaza lo que
// no puede ser un pacto real, y se deja pasar lo que el negocio quiera cobrar
// (para eso está el techo de aviso, que avisa pero no bloquea).
const _validarInteresLista = (raw) => {
  let lista;
  try {
    lista = JSON.parse(raw);
  } catch {
    throw { status: 400, message: 'La lista de planes de interés no es un JSON válido' };
  }
  if (!Array.isArray(lista)) {
    throw { status: 400, message: 'La lista de planes de interés debe ser un arreglo' };
  }
  if (lista.length > MAX_PLANES) {
    throw { status: 400, message: `No puedes tener más de ${MAX_PLANES} planes de interés` };
  }

  const ids = new Set();
  for (const cruda of lista) {
    const p = normalizarPlanInteres(cruda);
    if (!p) {
      const etiqueta = cruda?.nombre ? `"${cruda.nombre}"` : 'uno de los planes';
      throw {
        status: 400,
        message: `Revisa ${etiqueta}: necesita nombre, un valor válido `
          + `(porcentaje entre 0 y 100, o un valor fijo en pesos) y una periodicidad. `
          + `Si elegiste "cada N días", indica cuántos.`,
      };
    }
    if (typeof cruda.id !== 'string' || !cruda.id.trim()) {
      throw { status: 400, message: `El plan "${p.nombre}" no tiene identificador` };
    }
    if (ids.has(p.id)) {
      throw { status: 400, message: `Hay dos planes de interés con el mismo identificador (${p.id})` };
    }
    ids.add(p.id);
  }
};

const { hayUbicacion } = require('../../config/columnas');

// La ubicación de productos solo puede reportarse activa si la columna existe
// realmente en la BD. Si la migración no llegó a aplicarse, el flag sale en '0'
// y el frontend no pinta el campo: la feature se apaga sola en vez de fallar.
const getConfig = async (negocioId) => {
  const config = await repo.getMap(negocioId);
  if (!hayUbicacion()) config.ubicacion_activa = '0';
  return config;
};

const saveConfig = async (negocioId, datos) => {
  const datosProcesados = { ...datos };

  if (datosProcesados.tarifas_lista !== undefined) {
    _validarTarifasLista(String(datosProcesados.tarifas_lista));
  }
  if (datosProcesados.mora_lista !== undefined) {
    _validarMoraLista(String(datosProcesados.mora_lista));
  }
  if (datosProcesados.mora_tope_tasa_mensual !== undefined) {
    _validarTechoMora(datosProcesados.mora_tope_tasa_mensual);
  }
  if (datosProcesados.interes_lista !== undefined) {
    _validarInteresLista(String(datosProcesados.interes_lista));
  }
  if (datosProcesados.interes_techo_mensual !== undefined) {
    _validarTechoMora(datosProcesados.interes_techo_mensual);
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