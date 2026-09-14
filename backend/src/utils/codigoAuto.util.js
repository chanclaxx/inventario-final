'use strict';

// ── Código AUTOMÁTICO: todo nodo nace con su código ──────────────────────────
//
// Hasta ahora un producto por cantidad nacía sin código y alguien tenía que
// acordarse de ir a Etiquetas → «Generar códigos» antes de imprimir. Lo que se
// crea sin código es justo lo que no se puede escanear en el mostrador, y la
// primera vez que alguien se da cuenta es con el cliente esperando.
//
// Con `codigo_auto` encendido (el valor por defecto cuando el negocio ya activó
// el código único), cada nodo nace con el suyo:
//
//   · un producto SIN variantes → el código es del producto, y es el que se
//     escanea y se imprime;
//   · un atributo o una variante → nacen con su propio código, porque con
//     variantes activas lo que existe en el estante es la talla 38MM, no «la
//     correa». El producto conserva el suyo: la red interna empareja el mismo
//     producto entre sedes por `productos_cantidad.codigo`, así que sigue siendo
//     su identidad aunque lo que se etiquete sea la hoja.
//
// ── UN SOLO MOTOR ────────────────────────────────────────────────────────────
// Lo usan los cuatro que asignan códigos: crear un producto, crear un atributo o
// una variante, el importador (una pasada al final, en lote) y la generación
// masiva de Etiquetas. Antes esa última tenía su propia copia del algoritmo, y
// dos copias del reparto de códigos es exactamente como se desincronizan.
//
// Las reglas, en el orden en que se aplican:
//
//   1. NUNCA se pisa un código. Solo se escriben nodos con el código vacío, y
//      el UPDATE lo vuelve a exigir (`codigo IS NULL`) por si alguien lo llenó
//      entre la lectura y la escritura. Un código ya impreso está pegado a la
//      mercancía; cambiarlo convierte esas etiquetas en basura silenciosa.
//
//   2. Se HEREDA antes de inventar: el mismo nodo lógico (nombre del producto +
//      valor del atributo + valor de la variante) en otra sede lleva el mismo
//      código a propósito, o el lector deja de funcionar allá.
//
//   3. Si el nodo YA tiene código en otra sede pero aquí ese código está
//      ocupado, NO se inventa otro distinto: se deja vacío y se reporta como
//      `bloqueado`. Un segundo código para el mismo producto partiría su
//      identidad entre sedes, y la antigua generación masiva además propagaba
//      el nuevo encima del viejo — pisando justo la etiqueta ya impresa.
//
//   4. Lo que no hereda toma el siguiente número del contador del negocio
//      (`contadores_documento`, tipo 'codigo_producto'), sembrado con el mayor
//      código numérico que ya exista para no repartir números ocupados.
//      Con `codigo_auto_formato = 'patron'` el código es CAT-PRO-VAR-número y
//      hay un contador POR RAÍZ CAT-PRO (tipo 'codigo_patron:CAT-PRO'); las
//      razones están en `codigoPatron.util.js`. Las reglas 1, 2, 3 y 5 son
//      las mismas en los dos formatos.
//
//   5. Se PROPAGA a las demás sedes, pero solo a los nodos que están vacíos.
//
// ── NUNCA TUMBA LA OPERACIÓN QUE LO DISPARA ──────────────────────────────────
// Asignar el código es un extra; crear el producto, recibir el envío o importar
// el archivo es la operación. Todo corre dentro de un SAVEPOINT propio: si algo
// falla se revierte SOLO el código y el llamador decide (`tolerante`) si eso es
// un error o un aviso. En una transacción abortada atrapar el error no salva lo
// que viene después; el savepoint sí.

const { pool } = require('../config/db');
const { normalizarCodigo, MAX_CODIGO } = require('./codigo.util');
const {
  raizPatron, componerPatron, tipoContadorPatron, regexRaiz,
} = require('./codigoPatron.util');

// Los dos formatos del código generado. `numero` es el de siempre y el valor
// por defecto: los negocios que ya imprimieron etiquetas numéricas siguen
// igual. `patron` = CATEGORÍA-PRODUCTO-VARIANTE-consecutivo
// (`utils/codigoPatron.util.js`). Cambiar de formato NUNCA reescribe un código
// existente (regla 1): solo decide cómo nacen los próximos.
const FORMATOS = ['numero', 'patron'];

// Mismas reglas que la generación masiva ha usado siempre: el prefijo es corto
// y sin espacios porque va delante de CADA código, y los dígitos son dígitos
// porque Code 128 los codifica de dos en dos (juego C): 6 cifras ocupan casi la
// mitad que 6 letras, y en una etiqueta de 32 mm eso decide si escanea.
const PREFIJO_OK = /^[A-Z0-9-]{0,8}$/;
const DIGITOS = { min: 4, max: 10, defecto: 6 };

const NIVELES = {
  producto: 'productos_cantidad',
  atributo: 'atributos_producto',
  variante: 'variantes_atributo',
};

const _limpiarPrefijo = (p) => String(p ?? '').trim().toUpperCase();

/** Lanza el 400 que ve el usuario si el prefijo no sirve. Lo comparten Ajustes y Etiquetas. */
const validarPrefijo = (raw) => {
  const p = _limpiarPrefijo(raw);
  if (!PREFIJO_OK.test(p)) {
    throw { status: 400, message: 'El prefijo solo admite letras, números y guiones (máximo 8).' };
  }
  return p;
};

const validarDigitos = (raw) => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < DIGITOS.min || n > DIGITOS.max) {
    throw { status: 400, message: `Los dígitos del código deben ser un número entre ${DIGITOS.min} y ${DIGITOS.max}.` };
  }
  return n;
};

const validarFormato = (raw) => {
  const f = String(raw ?? '').trim();
  if (!FORMATOS.includes(f)) {
    throw { status: 400, message: 'El formato del código debe ser «numero» o «patron».' };
  }
  return f;
};

const validarLargo = (prefijo, digitos) => {
  if (prefijo.length + digitos > MAX_CODIGO) {
    throw { status: 400, message: `El código no puede superar ${MAX_CODIGO} caracteres` };
  }
};

/**
 * Lo que dice la configuración del negocio.
 *
 * `codigo_auto` AUSENTE = encendido, al revés que casi todo en este sistema, y a
 * propósito: solo cuenta cuando el negocio ya encendió a mano el código único
 * —quien llegó aquí quiere códigos— y un código que nadie imprime no mueve un
 * peso ni una unidad. El interruptor existe para el negocio que usa los
 * códigos de fábrica y prefiere escanearlos él mismo al crear el producto.
 *
 * Lo guardado se vuelve a validar al leer: una clave corrupta en
 * `config_negocio` no puede terminar en códigos con espacios.
 */
const configCodigoAuto = (config = {}) => {
  const activo = config.codigo_producto_activo === '1' && config.codigo_auto !== '0';
  const p = _limpiarPrefijo(config.codigo_auto_prefijo);
  const prefijo = PREFIJO_OK.test(p) ? p : '';
  const n = Number(config.codigo_auto_digitos);
  const digitos = Number.isInteger(n) && n >= DIGITOS.min && n <= DIGITOS.max ? n : DIGITOS.defecto;
  // Ausente o desconocido = numérico: lo que no se entiende no cambia nada.
  const formato = config.codigo_auto_formato === 'patron' ? 'patron' : 'numero';
  return { activo, prefijo, digitos: Math.min(digitos, MAX_CODIGO - prefijo.length), formato };
};

// ─────────────────────────────────────────────────────────────────────────────
// El contador
// ─────────────────────────────────────────────────────────────────────────────

/** El mayor código puramente numérico (con ese prefijo) que ya usa el negocio. */
const semilla = async (client, negocioId, prefijo) => {
  const patron = prefijo ? `^${prefijo}[0-9]{1,9}$` : '^[0-9]{1,9}$';
  const corte  = prefijo ? prefijo.length + 1 : 1;

  const { rows } = await client.query(
    `SELECT COALESCE(MAX(SUBSTRING(codigo FROM $2::int)::bigint), 0) AS maximo
     FROM (
       SELECT pc.codigo FROM productos_cantidad pc
         JOIN sucursales su ON su.id = pc.sucursal_id
        WHERE su.negocio_id = $1 AND pc.codigo ~ $3
       UNION ALL
       SELECT ap.codigo FROM atributos_producto ap
         JOIN sucursales su ON su.id = ap.sucursal_id
        WHERE su.negocio_id = $1 AND ap.codigo ~ $3
       UNION ALL
       SELECT v.codigo FROM variantes_atributo v
         JOIN atributos_producto ap ON ap.id = v.atributo_id
         JOIN sucursales su ON su.id = ap.sucursal_id
        WHERE su.negocio_id = $1 AND v.codigo ~ $3
     ) t`,
    [negocioId, corte, patron]
  );
  return Number(rows[0]?.maximo || 0);
};

/**
 * Reserva `cuantos` números de una sola vez y devuelve el primero.
 *
 * Mismo mecanismo que `asignarNumeroDocumento`: un INSERT … ON CONFLICT DO
 * UPDATE … RETURNING es atómico, el lock de fila serializa a dos personas
 * creando productos a la vez, y si la transacción hace ROLLBACK el contador
 * vuelve atrás con ella. El `GREATEST` contra la semilla es lo que lo hace
 * reparable: si alguien importó códigos numéricos por fuera, el contador se
 * pone por encima solo, en vez de repartir números que ya existen.
 */
const reservarBloque = async (client, negocioId, base, cuantos, tipo = 'codigo_producto') => {
  const { rows } = await client.query(
    `INSERT INTO contadores_documento (negocio_id, tipo, ultimo_numero)
     VALUES ($1, $4, GREATEST($2::int, 0) + $3)
     ON CONFLICT (negocio_id, tipo)
     DO UPDATE SET ultimo_numero = GREATEST(contadores_documento.ultimo_numero, $2::int) + $3
     RETURNING ultimo_numero`,
    [negocioId, base, cuantos, tipo]
  );
  return Number(rows[0].ultimo_numero) - cuantos + 1;
};

/**
 * El mayor consecutivo que ya usa una raíz CAT-PRO en el negocio, en los tres
 * niveles. Es la semilla del contador de esa raíz: así un código escrito a mano
 * con el mismo patrón («ACC-AUD-BLA-040») hace que el siguiente salga 041 en vez
 * de chocar.
 */
const semillaPatron = async (client, negocioId, raiz) => {
  const patron = regexRaiz(raiz);
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(SUBSTRING(codigo FROM '([0-9]+)$')::bigint), 0) AS maximo
     FROM (
       SELECT pc.codigo FROM productos_cantidad pc
         JOIN sucursales su ON su.id = pc.sucursal_id
        WHERE su.negocio_id = $1 AND UPPER(pc.codigo) ~ $2
       UNION ALL
       SELECT ap.codigo FROM atributos_producto ap
         JOIN sucursales su ON su.id = ap.sucursal_id
        WHERE su.negocio_id = $1 AND UPPER(ap.codigo) ~ $2
       UNION ALL
       SELECT v.codigo FROM variantes_atributo v
         JOIN atributos_producto ap ON ap.id = v.atributo_id
         JOIN sucursales su ON su.id = ap.sucursal_id
        WHERE su.negocio_id = $1 AND UPPER(v.codigo) ~ $2
     ) t`,
    [negocioId, patron]
  );
  return Number(rows[0]?.maximo || 0);
};

// ─────────────────────────────────────────────────────────────────────────────
// Consultas en lote
// ─────────────────────────────────────────────────────────────────────────────

const _vacio = (col) => `(${col} IS NULL OR BTRIM(${col}) = '')`;

/**
 * Los nodos de la lista que siguen SIN código y son de esta sucursal, con su
 * identidad lógica. Se bloquean (FOR UPDATE) para que dos tandas simultáneas no
 * le den dos códigos al mismo nodo.
 */
const _pendientes = async (client, sucursalId, nodos) => {
  const ids = (nivel) => [...new Set(nodos
    .filter((n) => n.nivel === nivel)
    .map((n) => Number(n.id))
    .filter((id) => Number.isInteger(id) && id > 0))];

  const out = [];
  const prod = ids('producto');
  if (prod.length) {
    const { rows } = await client.query(
      `SELECT pc.id, pc.nombre AS producto, lp.nombre AS categoria
       FROM productos_cantidad pc
       LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
       WHERE pc.id = ANY($1::int[]) AND pc.sucursal_id = $2 AND pc.activo
         AND ${_vacio('pc.codigo')}
       ORDER BY pc.id
       FOR UPDATE OF pc`,
      [prod, sucursalId]
    );
    for (const r of rows) out.push({ nivel: 'producto', id: r.id, producto: r.producto, categoria: r.categoria, atributo: null, variante: null });
  }
  const atr = ids('atributo');
  if (atr.length) {
    const { rows } = await client.query(
      `SELECT ap.id, pc.nombre AS producto, lp.nombre AS categoria, ap.valor AS atributo
       FROM atributos_producto ap
       JOIN productos_cantidad pc ON pc.id = ap.producto_id
       LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
       WHERE ap.id = ANY($1::int[]) AND ap.sucursal_id = $2 AND ap.activo
         AND ${_vacio('ap.codigo')}
       ORDER BY ap.id
       FOR UPDATE OF ap`,
      [atr, sucursalId]
    );
    for (const r of rows) out.push({ nivel: 'atributo', id: r.id, producto: r.producto, categoria: r.categoria, atributo: r.atributo, variante: null });
  }
  const vars = ids('variante');
  if (vars.length) {
    const { rows } = await client.query(
      `SELECT v.id, pc.nombre AS producto, lp.nombre AS categoria, ap.valor AS atributo, v.valor AS variante
       FROM variantes_atributo v
       JOIN atributos_producto ap ON ap.id = v.atributo_id
       JOIN productos_cantidad pc ON pc.id = ap.producto_id
       LEFT JOIN lineas_producto lp ON lp.id = pc.linea_id
       WHERE v.id = ANY($1::int[]) AND ap.sucursal_id = $2 AND v.activo
         AND ${_vacio('v.codigo')}
       ORDER BY v.id
       FOR UPDATE OF v`,
      [vars, sucursalId]
    );
    for (const r of rows) out.push({ nivel: 'variante', id: r.id, producto: r.producto, categoria: r.categoria, atributo: r.atributo, variante: r.variante });
  }
  return out;
};

/**
 * ¿Qué códigos de la lista ya están tomados en la sucursal, en cualquiera de
 * los tres niveles? Devuelve `Map(CÓDIGO → etiqueta de quien lo tiene)`.
 *
 * Es deliberadamente MÁS estricta que `buscarCodigoEnUso`: cuenta cualquier
 * fila activa del nivel aunque su padre esté dado de baja, porque así es como
 * la mira el índice único (`WHERE codigo IS NOT NULL AND activo`). Tratar como
 * libre algo que el índice rechaza haría fallar el UPDATE; tratar como ocupado
 * algo que en rigor está libre solo cuesta saltarse un número.
 */
const codigosOcupados = async (client, sucursalId, codigos) => {
  const lista = [...new Set((codigos || []).filter(Boolean).map((c) => String(c).toUpperCase()))];
  if (!lista.length) return new Map();
  const { rows } = await (client || pool).query(
    `SELECT UPPER(t.codigo) AS codigo, t.etiqueta FROM (
       SELECT pc.codigo, pc.nombre AS etiqueta
       FROM productos_cantidad pc
       WHERE pc.sucursal_id = $1 AND pc.activo AND UPPER(pc.codigo) = ANY($2::text[])
       UNION ALL
       SELECT ap.codigo, pc.nombre || ' — ' || ap.valor
       FROM atributos_producto ap
       JOIN productos_cantidad pc ON pc.id = ap.producto_id
       WHERE ap.sucursal_id = $1 AND ap.activo AND UPPER(ap.codigo) = ANY($2::text[])
       UNION ALL
       SELECT v.codigo, pc.nombre || ' — ' || ap.valor || ' / ' || v.valor
       FROM variantes_atributo v
       JOIN atributos_producto ap ON ap.id = v.atributo_id
       JOIN productos_cantidad pc ON pc.id = ap.producto_id
       WHERE ap.sucursal_id = $1 AND v.activo AND UPPER(v.codigo) = ANY($2::text[])
     ) t`,
    [sucursalId, lista]
  );
  const mapa = new Map();
  for (const r of rows) if (!mapa.has(r.codigo)) mapa.set(r.codigo, r.etiqueta);
  return mapa;
};

/**
 * Herencia en lote: para cada nodo, el código que ya tiene el MISMO nodo lógico
 * en cualquier sede del negocio, del MISMO nivel (darle a un atributo el código
 * de su producto los dejaría a los dos con el mismo, y el lector no sabría cuál
 * se escaneó). Misma regla que `heredarCodigo`, en una consulta por nivel en vez
 * de una por nodo: el importador corre contra una base a 145 ms por consulta.
 *
 * @returns {Map<number, string>} índice en `pendientes` → código
 */
const _heredados = async (client, negocioId, pendientes) => {
  const heredado = new Map();
  const de = (nivel) => pendientes
    .map((n, k) => ({ ...n, k }))
    .filter((n) => n.nivel === nivel);

  const prod = de('producto');
  if (prod.length) {
    const { rows } = await client.query(
      `SELECT DISTINCT ON (x.k) x.k, pc.codigo
       FROM unnest($2::text[], $3::int[]) AS x(nombre, k)
       JOIN productos_cantidad pc ON LOWER(pc.nombre) = LOWER(x.nombre) AND pc.activo
       JOIN sucursales su ON su.id = pc.sucursal_id AND su.negocio_id = $1
       WHERE NOT ${_vacio('pc.codigo')}
       ORDER BY x.k, pc.id`,
      [negocioId, prod.map((n) => n.producto), prod.map((n) => n.k)]
    );
    for (const r of rows) heredado.set(Number(r.k), String(r.codigo).toUpperCase());
  }

  const atr = de('atributo');
  if (atr.length) {
    const { rows } = await client.query(
      `SELECT DISTINCT ON (x.k) x.k, ap.codigo
       FROM unnest($2::text[], $3::text[], $4::int[]) AS x(nombre, atributo, k)
       JOIN productos_cantidad pc ON LOWER(pc.nombre) = LOWER(x.nombre) AND pc.activo
       JOIN sucursales su ON su.id = pc.sucursal_id AND su.negocio_id = $1
       JOIN atributos_producto ap ON ap.producto_id = pc.id AND ap.activo
        AND LOWER(ap.valor) = LOWER(x.atributo)
       WHERE NOT ${_vacio('ap.codigo')}
       ORDER BY x.k, pc.id, ap.id`,
      [negocioId, atr.map((n) => n.producto), atr.map((n) => n.atributo), atr.map((n) => n.k)]
    );
    for (const r of rows) heredado.set(Number(r.k), String(r.codigo).toUpperCase());
  }

  const vars = de('variante');
  if (vars.length) {
    const { rows } = await client.query(
      `SELECT DISTINCT ON (x.k) x.k, v.codigo
       FROM unnest($2::text[], $3::text[], $4::text[], $5::int[]) AS x(nombre, atributo, variante, k)
       JOIN productos_cantidad pc ON LOWER(pc.nombre) = LOWER(x.nombre) AND pc.activo
       JOIN sucursales su ON su.id = pc.sucursal_id AND su.negocio_id = $1
       JOIN atributos_producto ap ON ap.producto_id = pc.id AND ap.activo
        AND LOWER(ap.valor) = LOWER(x.atributo)
       JOIN variantes_atributo v ON v.atributo_id = ap.id AND v.activo
        AND LOWER(v.valor) = LOWER(x.variante)
       WHERE NOT ${_vacio('v.codigo')}
       ORDER BY x.k, pc.id, ap.id, v.id`,
      [negocioId, vars.map((n) => n.producto), vars.map((n) => n.atributo),
        vars.map((n) => n.variante), vars.map((n) => n.k)]
    );
    for (const r of rows) heredado.set(Number(r.k), String(r.codigo).toUpperCase());
  }
  return heredado;
};

/**
 * Escribe los códigos. En lote por nivel; si el lote choca con el índice único
 * (alguien tomó el código entre la verificación y la escritura) se reintenta
 * nodo por nodo, cada uno en su savepoint, y el que choque se queda sin código.
 * El `codigo IS NULL` del WHERE es la regla 1 hecha SQL.
 *
 * @returns {Set<string>} claves `nivel:id` que de verdad quedaron escritas
 */
const _escribir = async (client, asignados) => {
  const escritos = new Set();
  for (const [nivel, tabla] of Object.entries(NIVELES)) {
    const lote = asignados.filter((a) => a.nivel === nivel);
    if (!lote.length) continue;

    await client.query('SAVEPOINT codigo_auto_lote');
    try {
      const { rows } = await client.query(
        `UPDATE ${tabla} t SET codigo = x.codigo
         FROM unnest($1::int[], $2::text[]) AS x(id, codigo)
         WHERE t.id = x.id AND ${_vacio('t.codigo')}
         RETURNING t.id`,
        [lote.map((a) => a.id), lote.map((a) => a.codigo)]
      );
      await client.query('RELEASE SAVEPOINT codigo_auto_lote');
      for (const r of rows) escritos.add(`${nivel}:${r.id}`);
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT codigo_auto_lote');
      await client.query('RELEASE SAVEPOINT codigo_auto_lote');
      for (const a of lote) {
        await client.query('SAVEPOINT codigo_auto_uno');
        try {
          const { rows } = await client.query(
            `UPDATE ${tabla} SET codigo = $1 WHERE id = $2 AND ${_vacio('codigo')} RETURNING id`,
            [a.codigo, a.id]
          );
          await client.query('RELEASE SAVEPOINT codigo_auto_uno');
          if (rows.length) escritos.add(`${nivel}:${a.id}`);
        } catch {
          await client.query('ROLLBACK TO SAVEPOINT codigo_auto_uno');
          await client.query('RELEASE SAVEPOINT codigo_auto_uno');
        }
      }
    }
  }
  return escritos;
};

// El código no puede estar tomado en la sede DESTINO de la propagación, en
// ninguno de los tres niveles. Sin comillas invertidas: vive dentro de un
// template literal.
const _libreEnSede = (sede, codigo) => `
  NOT EXISTS (SELECT 1 FROM productos_cantidad o
              WHERE o.sucursal_id = ${sede} AND o.activo AND UPPER(o.codigo) = UPPER(${codigo}))
  AND NOT EXISTS (SELECT 1 FROM atributos_producto o
              WHERE o.sucursal_id = ${sede} AND o.activo AND UPPER(o.codigo) = UPPER(${codigo}))
  AND NOT EXISTS (SELECT 1 FROM variantes_atributo o
              JOIN atributos_producto oa ON oa.id = o.atributo_id
              WHERE oa.sucursal_id = ${sede} AND o.activo AND UPPER(o.codigo) = UPPER(${codigo}))`;

/**
 * Propaga a las demás sedes, SOLO a los nodos vacíos (regla 5). A diferencia de
 * `propagarCodigo` —que sobrescribe, porque la usa quien cambia un código a
 * mano y quiere que el cambio llegue a todas las sedes— esto nunca pisa nada.
 *
 * `DISTINCT ON (sede, código)`: si una sede tiene el mismo producto dos veces
 * con el nombre en distinta caja («11PRO» y «11Pro», existen en producción),
 * solo una de las dos filas recibe el código; las dos lo harían chocar contra el
 * índice único y se perdería la propagación entera.
 *
 * Best-effort, en su propio savepoint: que el código no llegue a otra sede no
 * puede deshacer el que sí se asignó aquí.
 */
const _propagar = async (client, negocioId, asignados) => {
  const lote = (nivel) => asignados.filter((a) => a.nivel === nivel);

  await client.query('SAVEPOINT codigo_auto_prop');
  try {
    const prod = lote('producto');
    if (prod.length) {
      await client.query(
        `WITH objetivo AS (
           SELECT DISTINCT ON (pc.sucursal_id, x.codigo) pc.id, x.codigo
           FROM unnest($2::text[], $3::text[]) AS x(nombre, codigo)
           JOIN productos_cantidad pc ON LOWER(pc.nombre) = LOWER(x.nombre) AND pc.activo
           JOIN sucursales su ON su.id = pc.sucursal_id AND su.negocio_id = $1
           WHERE ${_vacio('pc.codigo')} AND ${_libreEnSede('pc.sucursal_id', 'x.codigo')}
           ORDER BY pc.sucursal_id, x.codigo, pc.id
         )
         UPDATE productos_cantidad t SET codigo = o.codigo
         FROM objetivo o WHERE t.id = o.id AND ${_vacio('t.codigo')}`,
        [negocioId, prod.map((a) => a.producto), prod.map((a) => a.codigo)]
      );
    }
    const atr = lote('atributo');
    if (atr.length) {
      await client.query(
        `WITH objetivo AS (
           SELECT DISTINCT ON (ap.sucursal_id, x.codigo) ap.id, x.codigo
           FROM unnest($2::text[], $3::text[], $4::text[]) AS x(nombre, atributo, codigo)
           JOIN productos_cantidad pc ON LOWER(pc.nombre) = LOWER(x.nombre) AND pc.activo
           JOIN sucursales su ON su.id = pc.sucursal_id AND su.negocio_id = $1
           JOIN atributos_producto ap ON ap.producto_id = pc.id AND ap.activo
            AND LOWER(ap.valor) = LOWER(x.atributo)
           WHERE ${_vacio('ap.codigo')} AND ${_libreEnSede('ap.sucursal_id', 'x.codigo')}
           ORDER BY ap.sucursal_id, x.codigo, ap.id
         )
         UPDATE atributos_producto t SET codigo = o.codigo
         FROM objetivo o WHERE t.id = o.id AND ${_vacio('t.codigo')}`,
        [negocioId, atr.map((a) => a.producto), atr.map((a) => a.atributo), atr.map((a) => a.codigo)]
      );
    }
    const vars = lote('variante');
    if (vars.length) {
      await client.query(
        `WITH objetivo AS (
           SELECT DISTINCT ON (ap.sucursal_id, x.codigo) v.id, x.codigo
           FROM unnest($2::text[], $3::text[], $4::text[], $5::text[]) AS x(nombre, atributo, variante, codigo)
           JOIN productos_cantidad pc ON LOWER(pc.nombre) = LOWER(x.nombre) AND pc.activo
           JOIN sucursales su ON su.id = pc.sucursal_id AND su.negocio_id = $1
           JOIN atributos_producto ap ON ap.producto_id = pc.id AND ap.activo
            AND LOWER(ap.valor) = LOWER(x.atributo)
           JOIN variantes_atributo v ON v.atributo_id = ap.id AND v.activo
            AND LOWER(v.valor) = LOWER(x.variante)
           WHERE ${_vacio('v.codigo')} AND ${_libreEnSede('ap.sucursal_id', 'x.codigo')}
           ORDER BY ap.sucursal_id, x.codigo, v.id
         )
         UPDATE variantes_atributo t SET codigo = o.codigo
         FROM objetivo o WHERE t.id = o.id AND ${_vacio('t.codigo')}`,
        [negocioId, vars.map((a) => a.producto), vars.map((a) => a.atributo),
          vars.map((a) => a.variante), vars.map((a) => a.codigo)]
      );
    }
    await client.query('RELEASE SAVEPOINT codigo_auto_prop');
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT codigo_auto_prop');
    await client.query('RELEASE SAVEPOINT codigo_auto_prop');
    console.warn('⚠️ No se pudo propagar el código automático a las otras sedes:', err.message);
  }
};

// Tope de rondas para los choques del bloque reservado. Con la semilla puesta
// por encima del mayor código numérico, un choque solo aparece por una carrera
// o por un código de más de nueve cifras; cinco rondas seguidas sin salir es un
// estado raro, y el nodo se queda sin código en vez de colgar la tanda.
const MAX_RONDAS = 5;

/**
 * Genera con PATRÓN (CAT-PRO-VAR-consecutivo). Un contador por raíz CAT-PRO,
 * sembrado con lo que ya exista de esa raíz; los choques (un código escrito a
 * mano justo con ese número) se saltan y piden otro, igual que en el numérico.
 * Muta `asignados` y `usados`; lo que tras las rondas siga sin salir se queda
 * sin código, igual que en el numérico.
 */
const _generarPatron = async (client, { negocioId, sucursalId, porGenerar, asignados, usados }) => {
  const grupos = new Map();
  for (const n of porGenerar) {
    const raiz = raizPatron({ categoria: n.categoria, producto: n.producto });
    if (!grupos.has(raiz)) grupos.set(raiz, []);
    grupos.get(raiz).push(n);
  }

  // El segmento de variante es el valor del nodo que se etiqueta: el propio
  // producto no lleva, la talla lleva el suyo, la sub-variante el suyo.
  const segmento = (n) => (n.nivel === 'variante' ? n.variante : n.nivel === 'atributo' ? n.atributo : null);

  for (const [raiz, lista] of grupos) {
    const base = await semillaPatron(client, negocioId, raiz);
    let pendientes = lista;
    for (let ronda = 0; ronda < MAX_RONDAS && pendientes.length; ronda += 1) {
      const primero = await reservarBloque(client, negocioId, base, pendientes.length, tipoContadorPatron(raiz));
      const propuestos = pendientes.map((n, k) => normalizarCodigo(componerPatron(
        { categoria: n.categoria, producto: n.producto, variante: segmento(n) }, primero + k)));
      const ocupados = await codigosOcupados(client, sucursalId, propuestos);
      const siguen = [];
      pendientes.forEach((n, k) => {
        const c = propuestos[k];
        if (ocupados.has(c) || usados.has(c)) { siguen.push(n); return; }
        usados.add(c);
        asignados.push({ ...n, codigo: c, origen: 'generado' });
      });
      pendientes = siguen;
    }
  }
};

/**
 * El motor. Asigna código a los nodos de la lista que no tienen.
 *
 * @param {object} client  cliente DENTRO de una transacción (usa SAVEPOINT)
 * @param {object} p
 * @param {number} p.negocioId
 * @param {number} p.sucursalId  todos los nodos son de esta sucursal
 * @param {{nivel:'producto'|'atributo'|'variante', id:number}[]} p.nodos
 * @param {string}  [p.prefijo]
 * @param {number}  [p.digitos]
 * @param {boolean} [p.generar=true]    false = solo heredar
 * @param {boolean} [p.tolerante=false] true = un error deja todo sin código y
 *   no se propaga; false = se relanza (la generación masiva, donde asignar ES la
 *   operación, tiene que poder decir que falló)
 * @returns {Promise<{ asignados: object[], bloqueados: object[] }>}
 *   `asignados[i] = { nivel, id, codigo, origen: 'heredado'|'generado', producto, atributo, variante }`
 *   `bloqueados[i] = { nivel, id, codigo, bloqueadoPor }` — heredaba un código ocupado aquí
 */
const asignarCodigos = async (client, {
  negocioId, sucursalId, nodos, prefijo = '', digitos = DIGITOS.defecto,
  generar = true, tolerante = false, formato = 'numero',
}) => {
  if (!Array.isArray(nodos) || !nodos.length) return { asignados: [], bloqueados: [] };

  await client.query('SAVEPOINT codigo_auto');
  try {
    const pendientes = await _pendientes(client, sucursalId, nodos);
    if (!pendientes.length) {
      await client.query('RELEASE SAVEPOINT codigo_auto');
      return { asignados: [], bloqueados: [] };
    }

    // Con una sola sede no hay de quién heredar ni a quién propagar, y
    // saltarse esas consultas es la situación de la mayoría de negocios.
    const { rows: [{ n: sedes }] } = await client.query(
      'SELECT COUNT(*)::int AS n FROM sucursales WHERE negocio_id = $1 AND activa = true',
      [negocioId]
    );
    const variasSedes = sedes > 1;

    const heredados = variasSedes ? await _heredados(client, negocioId, pendientes) : new Map();
    const ocupadosHer = await codigosOcupados(client, sucursalId, [...heredados.values()]);

    const asignados = [];
    const bloqueados = [];
    const usados = new Set();
    let porGenerar = [];

    pendientes.forEach((n, k) => {
      const c = heredados.get(k);
      if (!c) { porGenerar.push(n); return; }
      if (ocupadosHer.has(c) || usados.has(c)) {
        bloqueados.push({ ...n, codigo: c, bloqueadoPor: ocupadosHer.get(c) || 'otro producto de esta misma tanda' });
        return;
      }
      usados.add(c);
      asignados.push({ ...n, codigo: c, origen: 'heredado' });
    });

    if (generar && porGenerar.length && formato === 'patron') {
      await _generarPatron(client, { negocioId, sucursalId, porGenerar, asignados, usados });
    } else if (generar && porGenerar.length) {
      const pref = _limpiarPrefijo(prefijo);
      const base = await semilla(client, negocioId, pref);
      for (let ronda = 0; ronda < MAX_RONDAS && porGenerar.length; ronda += 1) {
        const primero = await reservarBloque(client, negocioId, base, porGenerar.length);
        const propuestos = porGenerar.map((_, k) =>
          normalizarCodigo(pref + String(primero + k).padStart(digitos, '0')));
        const ocupados = await codigosOcupados(client, sucursalId, propuestos);
        const siguen = [];
        porGenerar.forEach((n, k) => {
          const c = propuestos[k];
          if (ocupados.has(c) || usados.has(c)) { siguen.push(n); return; }
          usados.add(c);
          asignados.push({ ...n, codigo: c, origen: 'generado' });
        });
        porGenerar = siguen;
      }
    }

    const escritos = await _escribir(client, asignados);
    const finales = asignados.filter((a) => escritos.has(`${a.nivel}:${a.id}`));
    if (variasSedes && finales.length) await _propagar(client, negocioId, finales);

    await client.query('RELEASE SAVEPOINT codigo_auto');
    return { asignados: finales, bloqueados };
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT codigo_auto').catch(() => {});
    await client.query('RELEASE SAVEPOINT codigo_auto').catch(() => {});
    if (!tolerante) throw err;
    console.warn('⚠️ No se pudo asignar el código automático:', err.message);
    return { asignados: [], bloqueados: [] };
  }
};

/**
 * Lee la configuración del negocio (solo las cuatro claves que importan). Se
 * lee directo y no por `config.repository` para que este util no dependa de un
 * módulo: lo importan cuatro módulos distintos y el importador corre dentro de
 * su propia transacción.
 */
const leerConfig = async (ejecutor, negocioId) => {
  const { rows } = await (ejecutor || pool).query(
    `SELECT clave, valor FROM config_negocio
     WHERE negocio_id = $1
       AND clave IN ('codigo_producto_activo', 'codigo_auto', 'codigo_auto_prefijo',
                     'codigo_auto_digitos', 'codigo_auto_formato')`,
    [negocioId]
  );
  return configCodigoAuto(Object.fromEntries(rows.map((r) => [r.clave, r.valor])));
};

/**
 * El atajo de los tres «crear» de la app (producto, atributo, variante): lee la
 * configuración, abre su propia transacción y NUNCA lanza. El nodo ya existe
 * cuando se llama; si el código no se pudo asignar, el producto queda creado
 * igual y se le puede generar después desde Etiquetas.
 *
 * @returns {Promise<string|null>} el código asignado, o null
 */
const asignarAlCrear = async ({ negocioId, sucursalId, nivel, id }) => {
  let client;
  try {
    const cfg = await leerConfig(null, negocioId);
    if (!cfg.activo) return null;

    client = await pool.connect();
    await client.query('BEGIN');
    const { asignados } = await asignarCodigos(client, {
      negocioId, sucursalId, nodos: [{ nivel, id }],
      prefijo: cfg.prefijo, digitos: cfg.digitos, formato: cfg.formato, tolerante: true,
    });
    await client.query('COMMIT');
    return asignados[0]?.codigo ?? null;
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.warn('⚠️ No se pudo asignar el código automático al crear:', err.message);
    return null;
  } finally {
    if (client) client.release();
  }
};

/**
 * Lo mismo que `asignarAlCrear` pero DENTRO de una transacción que ya está
 * abierta y para varios nodos: crear un producto con sus variantes de una vez,
 * o recibir una compra que toca nodos que todavía no tienen código. Lee la
 * configuración con el mismo `client` y es tolerante: el motor corre en su
 * propio savepoint, así que un fallo deja los nodos sin código y la operación
 * que lo disparó sigue.
 *
 * @returns {Promise<object[]>} los asignados
 */
const asignarEnTransaccion = async (client, { negocioId, sucursalId, nodos }) => {
  if (!Array.isArray(nodos) || !nodos.length) return [];
  const cfg = await leerConfig(client, negocioId);
  if (!cfg.activo) return [];
  const { asignados } = await asignarCodigos(client, {
    negocioId, sucursalId, nodos,
    prefijo: cfg.prefijo, digitos: cfg.digitos, formato: cfg.formato, tolerante: true,
  });
  return asignados;
};

/**
 * Copia un código YA EXISTENTE a un nodo recién creado, si en su sucursal está
 * libre. Es lo que hace la red interna al crear en el local la talla que le
 * llega de la bodega: no hay nada que inventar, el nodo es el mismo y su código
 * también. En savepoint propio porque corre dentro de la recepción, y una
 * recepción no se puede caer por el código de una talla.
 *
 * @returns {Promise<boolean>} si quedó escrito
 */
const copiarCodigoSiLibre = async (client, { nivel, id, sucursalId, codigo }) => {
  const tabla = NIVELES[nivel];
  const limpio = codigo ? String(codigo).trim().toUpperCase() : '';
  if (!tabla || !limpio || !id) return false;

  await client.query('SAVEPOINT codigo_copia');
  try {
    const ocupado = await codigosOcupados(client, sucursalId, [limpio]);
    let ok = false;
    if (!ocupado.size) {
      const { rows } = await client.query(
        `UPDATE ${tabla} SET codigo = $1 WHERE id = $2 AND ${_vacio('codigo')} RETURNING id`,
        [limpio, id]
      );
      ok = rows.length > 0;
    }
    await client.query('RELEASE SAVEPOINT codigo_copia');
    return ok;
  } catch {
    await client.query('ROLLBACK TO SAVEPOINT codigo_copia').catch(() => {});
    await client.query('RELEASE SAVEPOINT codigo_copia').catch(() => {});
    return false;
  }
};

module.exports = {
  PREFIJO_OK, DIGITOS, FORMATOS,
  validarPrefijo, validarDigitos, validarFormato, validarLargo, configCodigoAuto, leerConfig,
  semilla, semillaPatron, reservarBloque, codigosOcupados,
  asignarCodigos, asignarAlCrear, asignarEnTransaccion, copiarCodigoSiLibre,
};
