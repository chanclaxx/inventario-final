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

// ── Validación de la compra por órdenes ──────────────────────────────────────
// El modo de cargo decide CUÁNDO nace la deuda con el proveedor, así que un
// valor corrupto aquí produciría compras sin cargo o cargos duplicados. Se
// valida contra la lista cerrada que entiende compras.service.
const MODOS_CARGO = new Set(['recepcion', 'orden']);

const _validarModoCargo = (raw) => {
  if (raw === '' || raw === null) return;
  if (!MODOS_CARGO.has(String(raw))) {
    throw {
      status: 400,
      message: 'El modo de cargo debe ser "recepcion" (el proveedor factura cada '
        + 'entrega) u "orden" (factura el pedido completo por adelantado)',
    };
  }
};

// Días de aviso previo de los semáforos (vencimiento de factura, garantía).
// Cota superior generosa: hay proveedores que dan garantías de años y un negocio
// puede querer que le avisen con dos meses.
const _validarDiasAviso = (raw, etiqueta) => {
  if (raw === '' || raw === null) return;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < 0 || v > 365) {
    throw { status: 400, message: `${etiqueta} debe ser un número entero de días entre 0 y 365` };
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
  if (datosProcesados.ordenes_compra_modo_cargo !== undefined) {
    _validarModoCargo(datosProcesados.ordenes_compra_modo_cargo);
  }
  if (datosProcesados.ordenes_compra_dias_aviso !== undefined) {
    _validarDiasAviso(datosProcesados.ordenes_compra_dias_aviso, 'El aviso previo de vencimiento');
  }
  // ── Los umbrales del motor de avisos ──────────────────────────────────────
  //
  // Los rangos son los MISMOS que aplica `notificaciones.motor.js` al leerlos y
  // los que ofrece la pantalla. Si se separan, aquí se guardaría un número que
  // el motor descarta en silencio y el usuario creería haberlo cambiado.
  //
  // Vacío es válido y significa "usa el valor por defecto": es la forma de
  // deshacer un umbral sin tener que recordar cuál era el original.
  const UMBRALES_NOTIF = {
    notif_garantia_dias: { min: 1, max: 90, etiqueta: 'El aviso de garantías por vencer' },
    notif_entrada_dias:  { min: 0, max: 30, etiqueta: 'El aviso de entradas sin confirmar' },
    notif_caja_horas:    { min: 4, max: 72, etiqueta: 'El aviso de caja sin cerrar' },
  };
  for (const [clave, r] of Object.entries(UMBRALES_NOTIF)) {
    const raw = datosProcesados[clave];
    if (raw === undefined || raw === '' || raw === null) continue;
    const v = Number(raw);
    if (!Number.isInteger(v) || v < r.min || v > r.max) {
      throw { status: 400, message: `${r.etiqueta} debe ser un número entero entre ${r.min} y ${r.max}` };
    }
  }

  if (datosProcesados.garantia_proveedor_dias_aviso !== undefined) {
    _validarDiasAviso(datosProcesados.garantia_proveedor_dias_aviso, 'El aviso previo de garantía');
  }
  // Vigencia de los borradores de venta. 0 = no vencen nunca (la lista se
  // limpia solo a mano). Mismo rango 0–365 que los demás plazos.
  if (datosProcesados.borradores_dias !== undefined) {
    _validarDiasAviso(datosProcesados.borradores_dias, 'La vigencia de los borradores');
  }

  // Los códigos del proveedor resuelven contra el código interno del producto
  // (codigo_proveedor → codigo_interno → producto). Sin códigos internos no hay
  // a dónde apuntar, y permitir un fallback por producto_id crearía una SEGUNDA
  // noción de identidad de producto — el repositorio ya tiene tres conviviendo y
  // de ahí salen los duplicados que hay hoy en producción.
  //
  // saveConfig recibe cambios parciales, así que el prerrequisito puede venir en
  // el mismo payload o estar ya guardado: hay que mirar los dos.
  if (datosProcesados.codigos_proveedor_activos === '1') {
    const codigosInternos = datosProcesados.codigo_producto_activo !== undefined
      ? datosProcesados.codigo_producto_activo
      : (await repo.getMap(negocioId)).codigo_producto_activo;

    if (codigosInternos !== '1') {
      throw {
        status: 400,
        message: 'Para usar los códigos del proveedor primero tienes que activar el '
          + 'código único de producto: la referencia del proveedor apunta a tu código interno.',
      };
    }
  }

  // El pedido detallado pide la VARIANTE en vez del producto ("50 de 25W y 50
  // de 20W", no "100 cargadores"). Sin el árbol de variantes no hay nodo que
  // pedir y la feature resolvería a nada: sería un selector que no puede
  // seleccionar. Mismo prerrequisito que los códigos del proveedor, y por la
  // misma razón — la capacidad no puede existir sin aquello sobre lo que opera.
  if (datosProcesados.ordenes_compra_detalle_nodo === '1') {
    const variantes = datosProcesados.variantes_activo !== undefined
      ? datosProcesados.variantes_activo
      : (await repo.getMap(negocioId)).variantes_activo;

    if (variantes !== '1') {
      throw {
        status: 400,
        message: 'Para pedir por variante primero tienes que activar las variantes de producto: '
          + 'sin ellas no hay talla ni color que pedir, solo el producto completo.',
      };
    }
  }

  // ── El candado de costos y las tarifas porcentuales no pueden convivir ─────
  //
  // Una tarifa calcula el precio de venta DESDE el costo, y ese cálculo corre en
  // el navegador del vendedor: para aplicarla, el costo tiene que llegarle. Si
  // se enciende el candado con las tarifas activas, o el vendedor se queda sin
  // precio en el punto de venta, o el costo sigue viajando y el candado es
  // decorativo. Las dos salidas son mentiras distintas, así que se dice.
  //
  // saveConfig recibe cambios parciales: el otro extremo puede venir en el mismo
  // payload o estar guardado, hay que mirar los dos.
  const _guardado = async (clave) => (
    datosProcesados[clave] !== undefined
      ? datosProcesados[clave]
      : (await repo.getMap(negocioId))[clave]
  );

  if (datosProcesados.costos_solo_admin === '1' && (await _guardado('tarifas_activo')) === '1') {
    throw {
      status: 400,
      message: 'No puedes ocultar los costos mientras las tarifas porcentuales estén activas: '
        + 'la tarifa calcula el precio a partir del costo y necesita ese dato en la pantalla de venta. '
        + 'Apaga las tarifas primero, o deja los costos visibles.',
    };
  }
  if (datosProcesados.tarifas_activo === '1' && (await _guardado('costos_solo_admin')) === '1') {
    throw {
      status: 400,
      message: 'No puedes activar las tarifas porcentuales con los costos ocultos: '
        + 'la tarifa se calcula desde el costo. Quita primero "Ocultar costos" en Seguridad.',
    };
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

  // Misma razón para la compra por órdenes: su middleware cachea 60s y el
  // interruptor tiene que sentirse al instante al guardarlo desde Ajustes.
  const CLAVES_COMPRA = ['ordenes_compra_', 'garantia_proveedor_', 'codigos_proveedor_'];
  if (Object.keys(datosProcesados).some((k) => CLAVES_COMPRA.some((p) => k.startsWith(p)))) {
    require('../../middlewares/ordenesCompra.middleware').invalidarCache(negocioId);
  }

  // El candado de costos también se cachea 60s (se consulta en cada listado de
  // inventario, que es la pantalla más caliente): sin invalidar, apagarlo desde
  // Ajustes dejaría los costos escondidos hasta un minuto después.
  if ('costos_solo_admin' in datosProcesados) {
    require('../../utils/costos.util').invalidarCache(negocioId);
  }

  // Y lo mismo para los borradores de venta: su middleware cachea 60s, y apagar
  // la feature tiene que sentirse al instante — no un minuto después, con las
  // reservas todavía advirtiendo.
  if (Object.keys(datosProcesados).some((k) => k.startsWith('borradores_'))) {
    require('../../middlewares/borradores.middleware').invalidarCache(negocioId);
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