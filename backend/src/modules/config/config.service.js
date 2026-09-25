const bcrypt = require('bcryptjs')
const repo   = require('./config.repository');
const { pool } = require('../../config/db');

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
const codigoAuto = require('../../utils/codigoAuto.util');
const listasPrecios = require('../../utils/listasPrecios.util');

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

const { hayUbicacion, hayCodigoProveedor } = require('../../config/columnas');
const codigoProveedor = require('../../utils/codigoProveedor.util');

// La ubicación de productos solo puede reportarse activa si la columna existe
// realmente en la BD. Si la migración no llegó a aplicarse, el flag sale en '0'
// y el frontend no pinta el campo: la feature se apaga sola en vez de fallar.
const getConfig = async (negocioId) => {
  const config = await repo.getMap(negocioId);
  if (!hayUbicacion()) config.ubicacion_activa = '0';
  if (!hayCodigoProveedor()) config[codigoProveedor.CLAVE_CONFIG] = '0';
  return config;
};

const saveConfig = async (negocioId, datos) => {
  const datosProcesados = { ...datos };

  if (datosProcesados.tarifas_lista !== undefined) {
    _validarTarifasLista(String(datosProcesados.tarifas_lista));
  }
  // Las listas de precios se validan con la MISMA función que las lee
  // (listasPrecios.util), igual que la mora con `normalizarCondicion`: así no
  // se puede guardar una lista que el carrito luego descarte en silencio.
  if (datosProcesados.listas_precios_lista !== undefined) {
    listasPrecios.validarListas(String(datosProcesados.listas_precios_lista));
  }
  if (datosProcesados.mora_lista !== undefined) {
    _validarMoraLista(String(datosProcesados.mora_lista));
  }
  if (datosProcesados.mora_tope_tasa_mensual !== undefined) {
    _validarTechoMora(datosProcesados.mora_tope_tasa_mensual);
  }
  // La mora de los ENVÍOS de la red interna: mismas condiciones y mismas
  // validaciones que la de créditos (las lee la misma `leerConfigMora`), así
  // no se puede guardar una lista que el despacho luego descarte en silencio.
  if (datosProcesados.red_interna_mora_lista !== undefined) {
    _validarMoraLista(String(datosProcesados.red_interna_mora_lista));
  }
  if (datosProcesados.red_interna_mora_tope_tasa_mensual !== undefined) {
    _validarTechoMora(datosProcesados.red_interna_mora_tope_tasa_mensual);
  }
  for (const [clave, min, max, etiqueta] of [
    ['red_interna_mora_plazo_default_dias', 1, 365, 'El plazo de pago por defecto de los envíos'],
    ['red_interna_mora_aviso_previo_dias',  1,  30, 'El aviso previo al vencimiento de un envío'],
  ]) {
    const raw = datosProcesados[clave];
    if (raw === undefined || raw === '' || raw === null) continue;
    const v = Number(raw);
    if (!Number.isInteger(v) || v < min || v > max) {
      throw { status: 400, message: `${etiqueta} debe ser un número entero de días entre ${min} y ${max}` };
    }
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

  // Técnicos externos: interruptor y umbrales de sus dos avisos, con los
  // MISMOS rangos que usa el middleware al leerlos (tecnicos.middleware).
  if (datosProcesados.tecnicos_externos_activo !== undefined
      && !['0', '1'].includes(String(datosProcesados.tecnicos_externos_activo))) {
    throw { status: 400, message: 'Técnicos externos solo puede estar encendido (1) o apagado (0)' };
  }
  const { RANGOS: RANGOS_TECNICOS } = require('../../middlewares/tecnicos.middleware');
  for (const [clave, r] of Object.entries(RANGOS_TECNICOS)) {
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

  // ── Código automático de producto ─────────────────────────────────────────
  // Las reglas son las MISMAS funciones que aplica el motor al generar
  // (utils/codigoAuto.util): si se separaran, aquí se guardaría un prefijo que
  // el motor luego descarta en silencio y el negocio creería estar usándolo.
  if (datosProcesados.codigo_auto !== undefined && !['0', '1'].includes(String(datosProcesados.codigo_auto))) {
    throw { status: 400, message: 'El código automático solo puede estar encendido (1) o apagado (0)' };
  }
  const tocaPrefijo = datosProcesados.codigo_auto_prefijo !== undefined;
  const tocaDigitos = datosProcesados.codigo_auto_digitos !== undefined && datosProcesados.codigo_auto_digitos !== '';
  if (tocaPrefijo) {
    datosProcesados.codigo_auto_prefijo = codigoAuto.validarPrefijo(datosProcesados.codigo_auto_prefijo);
  }
  if (tocaDigitos) {
    datosProcesados.codigo_auto_digitos = String(codigoAuto.validarDigitos(datosProcesados.codigo_auto_digitos));
  }
  if (datosProcesados.codigo_auto_formato !== undefined) {
    datosProcesados.codigo_auto_formato = codigoAuto.validarFormato(datosProcesados.codigo_auto_formato);
  }
  if (tocaPrefijo || tocaDigitos) {
    const prefijo = tocaPrefijo
      ? datosProcesados.codigo_auto_prefijo
      : codigoAuto.configCodigoAuto(await repo.getMap(negocioId)).prefijo;
    const digitos = tocaDigitos
      ? Number(datosProcesados.codigo_auto_digitos)
      : codigoAuto.configCodigoAuto(await repo.getMap(negocioId)).digitos;
    codigoAuto.validarLargo(prefijo, digitos);
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

  // ── Código del proveedor en las etiquetas ─────────────────────────────────
  // Lo que se imprime al recibir es la etiqueta del PRODUCTO con el código del
  // proveedor debajo: sin código único de producto no hay símbolo que imprimir
  // (el módulo de etiquetas ni existe para ese negocio), y un código de
  // proveedor que no llega a ninguna etiqueta no sirve para nada. Mismo
  // prerrequisito que los códigos del proveedor, por la misma razón.
  const claveProv = codigoProveedor.CLAVE_CONFIG;
  if (datosProcesados[claveProv] !== undefined && !['0', '1'].includes(String(datosProcesados[claveProv]))) {
    throw { status: 400, message: 'El código de proveedor solo puede estar encendido (1) o apagado (0)' };
  }
  if (datosProcesados[claveProv] === '1') {
    if (!hayCodigoProveedor()) {
      throw {
        status: 400,
        message: 'El código de proveedor todavía no está disponible en tu base de datos. Intenta de nuevo en unos minutos.',
      };
    }
    const codigosInternos = datosProcesados.codigo_producto_activo !== undefined
      ? datosProcesados.codigo_producto_activo
      : (await repo.getMap(negocioId)).codigo_producto_activo;
    if (codigosInternos !== '1') {
      throw {
        status: 400,
        message: 'Para imprimir el código del proveedor en las etiquetas primero tienes que activar el '
          + 'código único de producto: es el código que lleva la etiqueta.',
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

  // ── Las tarifas porcentuales y las listas de precios son EXCLUYENTES ──────
  //
  // Las dos responden la misma pregunta —"¿a cuánto le vendo esto a este
  // cliente?"— y las dos se contestan con el mismo gesto: un chip en el
  // carrito. Encendidas a la vez, el vendedor tendría dos filas de chips
  // compitiendo por el mismo número y ninguna forma de saber cuál manda; y un
  // ítem con las dos aplicadas tendría que elegir a espaldas del usuario.
  //
  // No es una limitación técnica sino una decisión: el negocio decide si sus
  // precios se CALCULAN desde el costo (tarifas) o si están ESCRITOS uno por
  // uno (listas). Son dos formas de trabajar, no dos funciones que se sumen.
  //
  // Mismo patrón que el candado de costos de aquí arriba: se miran los dos
  // extremos porque saveConfig recibe cambios parciales.
  if (datosProcesados.listas_precios_activo === '1' && (await _guardado('tarifas_activo')) === '1') {
    throw {
      status: 400,
      message: 'No puedes usar listas de precios con las tarifas porcentuales activas: '
        + 'las dos deciden el precio de venta en el carrito y se estorbarían. '
        + 'Apaga primero las tarifas porcentuales.',
    };
  }
  if (datosProcesados.tarifas_activo === '1' && (await _guardado('listas_precios_activo')) === '1') {
    throw {
      status: 400,
      message: 'No puedes activar las tarifas porcentuales con las listas de precios activas: '
        + 'las dos deciden el precio de venta en el carrito. '
        + 'Apaga primero las listas de precios.',
    };
  }

  // ── El precio mínimo y las tarifas porcentuales también son EXCLUYENTES ───
  //
  // El piso sale de los precios ESCRITOS (predeterminado y listas). Una tarifa
  // calcula el precio desde el costo en el navegador del vendedor, así que el
  // candado rechazaría justo el precio que la tarifa acaba de proponer — o
  // habría que recalcular tarifas en el servidor con el costo de cada sede.
  if (datosProcesados.precio_minimo_activo === '1' && (await _guardado('tarifas_activo')) === '1') {
    throw {
      status: 400,
      message: 'No puedes exigir el precio mínimo con las tarifas porcentuales activas: '
        + 'la tarifa calcula el precio desde el costo y el candado lo rechazaría. '
        + 'Apaga primero las tarifas porcentuales.',
    };
  }
  if (datosProcesados.tarifas_activo === '1' && (await _guardado('precio_minimo_activo')) === '1') {
    throw {
      status: 400,
      message: 'No puedes activar las tarifas porcentuales con el precio mínimo activo. '
        + 'Apaga primero «No vender por debajo del precio» en Precios de venta.',
    };
  }

  // Quién más puede usar el PIN: se valida que cada id sea un usuario de ESTE
  // negocio, o un admin podría autorizar (sin saberlo) un id de otro negocio.
  if (datosProcesados.pin_usuarios_autorizados !== undefined) {
    datosProcesados.pin_usuarios_autorizados =
      await _validarUsuariosPin(negocioId, datosProcesados.pin_usuarios_autorizados);
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

  // Encender el código de proveedor asigna los códigos AHÍ MISMO, a todos los
  // proveedores que tengan nombre, NIT y ciudad: esperar a que alguien edite
  // cada uno sería dejar la pantalla llena de «sin código» el primer día.
  // Tolerante, y DESPUÉS de guardar: el interruptor queda encendido pase lo que
  // pase, y lo que no se pudo asignar se ve (y se reintenta) en Proveedores.
  if (datosProcesados[claveProv] === '1') {
    await codigoProveedor.asignarCodigos(negocioId, { tolerante: true });
  }

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

  if (Object.keys(datosProcesados).some((k) => k.startsWith('tecnicos_'))) {
    require('../../middlewares/tecnicos.middleware').invalidarCache(negocioId);
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

// ── Quién puede usar el PIN de administrador ─────────────────────────────────
//
// El PIN existe para que alguien que NO es admin haga algo sensible con la
// autorización del admin (reducir stock, eliminar un equipo, cambiar el
// vendedor de una factura). Pero `/config/verificar-pin` solo dejaba entrar a
// `admin_negocio`: a un supervisor con el PIN correcto le respondía 403 y la
// pantalla lo pintaba como «Error al verificar el PIN».
//
// `admin_negocio` pasa siempre. Los demás, solo si el admin los marcó en
// Ajustes → Seguridad (`pin_usuarios_autorizados`, arreglo JSON de ids).
// Ausente = nadie más: es lo mismo que pasaba hasta hoy, así que ningún
// negocio abre la puerta sin decidirlo.
const _idsAutorizados = (raw) => {
  try {
    const lista = JSON.parse(raw ?? '[]');
    return Array.isArray(lista) ? lista.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  } catch {
    return [];
  }
};

const puedeUsarPin = async (negocioId, usuario) => {
  if (usuario?.rol === 'admin_negocio') return true;
  const config = await repo.getMap(negocioId);
  return _idsAutorizados(config.pin_usuarios_autorizados).includes(Number(usuario?.id));
};

const _validarUsuariosPin = async (negocioId, raw) => {
  let lista;
  try { lista = JSON.parse(String(raw)); } catch { lista = null; }
  if (!Array.isArray(lista)) {
    throw { status: 400, message: 'La lista de usuarios autorizados para el PIN no es válida' };
  }
  const ids = [...new Set(lista.map(Number))];
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) {
    throw { status: 400, message: 'La lista de usuarios autorizados para el PIN no es válida' };
  }
  if (!ids.length) return '[]';

  const { rows } = await pool.query(
    'SELECT id FROM usuarios WHERE negocio_id = $1 AND id = ANY($2::int[])',
    [negocioId, ids],
  );
  if (rows.length !== ids.length) {
    throw { status: 400, message: 'Uno de los usuarios autorizados para el PIN no pertenece a este negocio' };
  }
  return JSON.stringify(ids.sort((a, b) => a - b));
};

// Fuerza bruta: el PIN suele ser de 4 dígitos, así que abrirle la verificación
// a más usuarios exige un tope. Se cuentan solo los FALLOS, por usuario; un
// acierto limpia el contador. En memoria a propósito: un reinicio lo borra,
// pero en ese caso el atacante ya perdió minutos, y no merece una tabla.
const MAX_FALLOS_PIN   = 5;
const VENTANA_FALLOS_MS = 15 * 60 * 1000;
const _fallosPin = new Map();

const verificarPinDeUsuario = async (negocioId, usuario, pinIngresado) => {
  if (!(await puedeUsarPin(negocioId, usuario))) {
    throw {
      status: 403,
      code:   'PIN_NO_AUTORIZADO',
      message: 'Tu usuario no está autorizado para usar el PIN de administrador. '
        + 'Pídele a un administrador que te active en Ajustes → Seguridad.',
    };
  }

  const clave = `${negocioId}:${usuario.id}`;
  const ahora = Date.now();
  const previo = _fallosPin.get(clave);
  const fallos = previo && ahora - previo.desde < VENTANA_FALLOS_MS ? previo : { n: 0, desde: ahora };

  if (fallos.n >= MAX_FALLOS_PIN) {
    const minutos = Math.ceil((VENTANA_FALLOS_MS - (ahora - fallos.desde)) / 60000);
    throw {
      status: 429,
      code:   'PIN_BLOQUEADO',
      message: `Demasiados intentos con PIN incorrecto. Intenta de nuevo en ${minutos} min.`,
    };
  }

  const valido = await verificarPin(negocioId, pinIngresado);
  if (valido) {
    _fallosPin.delete(clave);
  } else if (usuario.rol !== 'admin_negocio') {
    _fallosPin.set(clave, { n: fallos.n + 1, desde: fallos.desde });
  }
  return valido;
};

module.exports = { getConfig, saveConfig, verificarPin, puedeUsarPin, verificarPinDeUsuario };