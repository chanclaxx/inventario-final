const { pool } = require('../../config/db');
const { hayUbicacion } = require('../../config/columnas');
const {
  CONFLICTO, AVISO, crearInforme, conflicto, aviso, avisoUnico, limpiar,
  clavesCaracteristica,
} = require('./importacion.informe');
const { codigoTomadoPorOtroNodo, heredarCodigo, propagarCodigo } = require('../../utils/codigo.util');

const MAX_FILAS = 2000;

// ─────────────────────────────────────────────────────────────────────────────
// Identidad del producto — LEER ANTES DE TOCAR NADA AQUÍ
//
// En este sistema conviven TRES nociones de "el mismo producto":
//   · el índice único de la BD  → (nombre, sucursal_id) EXACTO
//   · este importador           → LOWER(nombre)
//   · la UI (crearProducto)     → ninguna, ni siquiera hace trim
//
// El desajuste ya dejó duplicados reales en producción (`[11PRO]` vs `[11Pro]`,
// `[cargador 3ds]` vs `[cargador 3ds ]`). NO se unifican y NO se fusionan: son
// negocios operando y su historia de ventas cuelga de esas filas. Cambiar la
// búsqueda a una forma normalizada movería el stock a una fila distinta de la
// que recibió el stock la última vez — silenciosamente.
//
// Así que la búsqueda se deja EXACTAMENTE como estaba (LOWER, sin BTRIM) y en
// su lugar se DETECTA y se REPORTA. `_NORM` solo se usa para detectar
// parecidos y avisar; jamás para decidir a qué fila se escribe.
// ─────────────────────────────────────────────────────────────────────────────
const _NORM = (col) =>
  `TRANSLATE(LOWER(REGEXP_REPLACE(BTRIM(${col}), '\\s+', ' ', 'g')), 'áéíóúüñ', 'aeiouun')`;

/** Misma normalización que `_NORM`, en JS, para comparar filas del mismo archivo. */
const _normJS = (s) =>
  String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const _mensajeSeguro = (err) => {
  if (err.code === '23505') return 'Registro duplicado';
  if (err.code === '23503') return 'Referencia inválida';
  if (err.code === '22P02') return 'Valor con formato incorrecto';
  if (err.code === '22003') return 'Número demasiado grande';
  return 'Error al procesar la fila';
};

const _hoyISO = () => new Date().toISOString().split('T')[0];

// Devuelve { fecha, reconocida } — el llamador avisa cuando no se pudo leer,
// porque caer a hoy en silencio hace que un inventario entero nazca fechado
// el día de la importación y nadie se entera.
const _formatearFecha = (valor) => {
  if (valor == null || valor === '') return { fecha: _hoyISO(), reconocida: true };

  // Celda de fecha real de Excel (cellDates:true) → objeto Date válido
  if (valor instanceof Date) {
    if (isNaN(valor)) return { fecha: _hoyISO(), reconocida: false };
    const year  = valor.getFullYear();
    const month = String(valor.getMonth() + 1).padStart(2, '0');
    const day   = String(valor.getDate()).padStart(2, '0');
    return { fecha: `${year}-${month}-${day}`, reconocida: true };
  }

  const s = valor.toString().trim();
  if (!s) return { fecha: _hoyISO(), reconocida: true };

  // Formato de la plantilla: dd/mm/aaaa (también admite dd-mm-aaaa).
  // OJO: new Date("dd/mm/aaaa") interpreta mm/dd (bug), por eso se parsea a mano.
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const dia = Number(m[1]), mes = Number(m[2]), anio = Number(m[3]);
    if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) {
      return { fecha: `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`, reconocida: true };
    }
    return { fecha: _hoyISO(), reconocida: false };
  }

  // Formato ISO aaaa-mm-dd
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { fecha: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`, reconocida: true };

  return { fecha: _hoyISO(), reconocida: false };
};

const _parseLista = (valor) => {
  try { return JSON.parse(valor || '[]'); }
  catch { return []; }
};

// Misma normalización que el controller (mantenida en sync)
const _normClave = (s) => s.toLowerCase().replace(/\s+/g, '_');

// Número tolerante: acepta 1.500,50 y 1,500.50 (los dos separadores que usa
// la gente en Colombia al pegar desde otra hoja). Devuelve null si no es
// número; el llamador decide si eso es aviso o conflicto.
const _numero = (valor) => {
  if (valor === undefined || valor === null || valor === '') return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  let s = String(valor).trim();
  if (!s) return null;
  s = s.replace(/\s|\$/g, '');
  const comas = (s.match(/,/g) || []).length;
  const puntos = (s.match(/\./g) || []).length;
  if (comas && puntos) {
    // El separador decimal es el que aparece más a la derecha.
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (comas === 1 && /,\d{1,2}$/.test(s)) {
    s = s.replace(',', '.');              // 1500,50 → decimal
  } else if (comas) {
    s = s.replace(/,/g, '');              // 1,500 → miles
  } else if (puntos > 1) {
    s = s.replace(/\./g, '');             // 1.500.000 → miles
  } else if (puntos === 1 && /^\d+\.\d{3}$/.test(s)) {
    // es-CO: el punto es separador de MILES. "1.500" son mil quinientos, no 1,5.
    // Sin esta rama, un costo de $1.500 escrito a mano entraba como $1,5 — mil
    // veces menor, en silencio, y el reporte de utilidad quedaba absurdo.
    // Solo aplica cuando separa exactamente 3 dígitos: "1.5" y "1.50" siguen
    // siendo decimales de verdad (kg, litros).
    s = s.replace('.', '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const _entero = (valor) => {
  const n = _numero(valor);
  return n === null ? null : Math.trunc(n);
};

// ── Resolución de referencias ────────────────────────────────────────────────
// Devuelven { id, creado } para poder reportar "voy a crear estos proveedores":
// un typo en el Excel crea un proveedor nuevo y hoy nadie se entera.

const _resolverProveedor = async (client, nombre, negocioId) => {
  if (!nombre?.toString().trim()) return { id: null, creado: false };
  const nombreLimpio = nombre.toString().trim();

  const { rows: existe } = await client.query(
    `SELECT id FROM proveedores
     WHERE negocio_id = $1 AND LOWER(nombre) = LOWER($2) LIMIT 1`,
    [negocioId, nombreLimpio]
  );
  if (existe.length) return { id: existe[0].id, creado: false };

  const { rows: nuevo } = await client.query(
    `INSERT INTO proveedores(negocio_id, nombre) VALUES($1, $2) RETURNING id`,
    [negocioId, nombreLimpio]
  );
  return { id: nuevo[0].id, creado: true, nombre: nombreLimpio };
};

const _resolverLinea = async (client, nombre, negocioId) => {
  if (!nombre?.toString().trim()) return { id: null, creado: false };
  const nombreLimpio = nombre.toString().trim();
  const { rows: existe } = await client.query(
    `SELECT id FROM lineas_producto WHERE negocio_id = $1 AND LOWER(nombre) = LOWER($2) LIMIT 1`,
    [negocioId, nombreLimpio]
  );
  if (existe.length) return { id: existe[0].id, creado: false };
  const { rows: nuevo } = await client.query(
    `INSERT INTO lineas_producto(negocio_id, nombre) VALUES($1,$2) RETURNING id`,
    [negocioId, nombreLimpio]
  );
  return { id: nuevo[0].id, creado: true, nombre: nombreLimpio };
};

// ── Ubicación espacial (feature opt-in) ──────────────────────────────────────
// Se aplica en un UPDATE aparte, después de resolver el producto, en vez de
// meterla en los INSERT/UPDATE existentes: así la importación de un negocio sin
// la feature ejecuta exactamente el mismo SQL de siempre.
//
// Celda vacía = NO tocar. Reimportar la misma plantilla sin llenar la columna
// nunca borra las ubicaciones ya puestas.
//
// Doble interruptor, y los dos tienen que estar en ON:
//   · `hayUbicacion()` — ¿existe la columna en el esquema? (seguridad de BD)
//   · `config.ubicacion_activa` — ¿el negocio encendió la feature?
// Antes solo se miraba el primero, así que un negocio con la ubicación apagada
// igual recibía datos si la columna aparecía en el archivo. La plantilla ya
// decidía con la config; ahora las dos mitades preguntan a lo mismo.
//
// `tabla` es un literal fijo del código, jamás entrada del usuario.
const _aplicarUbicacion = async (client, tabla, productoId, valor, activa) => {
  if (!activa || !productoId) return;
  const limpio = String(valor ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!limpio) return;
  await client.query(`UPDATE ${tabla} SET ubicacion = $1 WHERE id = $2`, [limpio, productoId]);
};

// Nota libre del producto/serial (columna añadida en 20260710, que hasta ahora
// no se podía importar). Misma regla que la ubicación: vacío = no tocar.
const _aplicarNota = async (client, tabla, id, valor) => {
  if (!id) return;
  const limpio = String(valor ?? '').trim().slice(0, 500);
  if (!limpio) return;
  await client.query(`UPDATE ${tabla} SET nota = $1 WHERE id = $2`, [limpio, id]);
};

// ── Detección de nombres parecidos (solo para avisar) ────────────────────────
//
// Devuelve productos de la MISMA sucursal cuyo nombre normalizado coincide pero
// que la búsqueda real (LOWER exacto) NO va a encontrar. Son los que generan
// duplicados invisibles: `cargador 3ds ` con espacio final, `ZTE  256GB` con
// espacio doble, `Batería` contra `Bateria`.
const _nombresParecidos = async (client, tabla, nombre, sucursalId) => {
  const { rows } = await client.query(
    `SELECT id, nombre FROM ${tabla}
     WHERE sucursal_id = $2
       AND ${_NORM('nombre')} = ${_NORM('$1')}
       AND LOWER(nombre) <> LOWER($1)
     ORDER BY id ASC LIMIT 3`,
    [nombre, sucursalId]
  );
  return rows;
};

/**
 * Busca el producto tal como SIEMPRE lo ha buscado el importador (LOWER exacto)
 * y además reporta si hay más de una coincidencia. Con `[11PRO]` y `[11Pro]`
 * conviviendo, antes ganaba una fila al azar (LIMIT 1 sin ORDER BY, el orden lo
 * decide Postgres y puede cambiar entre corridas). Ahora gana siempre la más
 * antigua y se avisa de la ambigüedad.
 */
const _buscarPorNombre = async (client, tabla, nombre, sucursalId) => {
  const { rows } = await client.query(
    `SELECT id, nombre FROM ${tabla}
     WHERE LOWER(nombre) = LOWER($1) AND sucursal_id = $2
     ORDER BY id ASC`,
    [nombre, sucursalId]
  );
  return rows;
};

// Avisos comunes a las dos hojas cuando se resuelve un producto por nombre.
const _avisarSobreNombre = async (client, tabla, { informe, hoja, fila, nombre, sucursalId, coincidencias, vistosArchivo }) => {
  if (coincidencias.length > 1) {
    aviso(informe, {
      hoja, fila, columna: 'Nombre', valor: nombre,
      tipo: AVISO.VARIOS_COINCIDEN,
      mensaje: `Hay ${coincidencias.length} productos con este nombre en la sucursal (${coincidencias.map((c) => `«${c.nombre}»`).join(', ')}). Se usará el más antiguo (id ${coincidencias[0].id}).`,
      sugerencia: 'Revisa el inventario: son productos distintos escritos casi igual.',
    });
  }

  if (coincidencias.length === 0) {
    const parecidos = await _nombresParecidos(client, tabla, nombre, sucursalId);
    if (parecidos.length) {
      aviso(informe, {
        hoja, fila, columna: 'Nombre', valor: nombre,
        tipo: AVISO.NOMBRE_SIMILAR,
        mensaje: `Se creará un producto NUEVO. Ya existe uno casi idéntico: ${parecidos.map((p) => `«${p.nombre}»`).join(', ')}.`,
        sugerencia: 'Si es el mismo producto, corrige el nombre en el Excel para que coincida exactamente; si no, ignora este aviso.',
      });
    }
  }

  // Dos filas del mismo archivo que son el mismo producto escrito distinto.
  if (vistosArchivo) {
    const norm = _normJS(nombre);
    const previo = vistosArchivo.get(norm);
    if (previo && previo.nombre !== nombre) {
      aviso(informe, {
        hoja, fila, columna: 'Nombre', valor: nombre,
        tipo: AVISO.NOMBRE_ARCHIVO,
        mensaje: `En la fila ${previo.fila} de este archivo aparece «${previo.nombre}», que es el mismo producto escrito distinto.`,
        sugerencia: 'Unifica la escritura en el Excel o quedarán como dos productos separados.',
      });
    } else if (!previo) {
      vistosArchivo.set(norm, { nombre, fila });
    }
  }
};

const _resolverProductoSerial = async (client, { nombre, marca, modelo, precio, sucursalId, proveedorId, lineaId }) => {
  const coincidencias = await _buscarPorNombre(client, 'productos_serial', nombre.trim(), sucursalId);

  if (coincidencias.length) {
    if (marca || modelo || proveedorId || precio || lineaId) {
      await client.query(
        `UPDATE productos_serial SET
           marca        = COALESCE(NULLIF($1,''), marca),
           modelo       = COALESCE(NULLIF($2,''), modelo),
           proveedor_id = COALESCE($3, proveedor_id),
           precio       = COALESCE($4, precio),
           linea_id     = COALESCE($5, linea_id)
         WHERE id = $6`,
        [
          marca?.toString().trim() || '',
          modelo?.toString().trim() || '',
          proveedorId,
          precio || null,
          lineaId,
          coincidencias[0].id,
        ]
      );
    }
    return { id: coincidencias[0].id, coincidencias, nuevo: false };
  }

  const { rows: nuevo } = await client.query(
    `INSERT INTO productos_serial(sucursal_id, proveedor_id, nombre, marca, modelo, precio, linea_id)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [
      sucursalId, proveedorId, nombre.trim(),
      marca?.toString().trim()  || null,
      modelo?.toString().trim() || null,
      precio || null,
      lineaId,
    ]
  );
  return { id: nuevo[0].id, coincidencias, nuevo: true };
};

// ─────────────────────────────────────────────
// TRANSACCIONES
// ─────────────────────────────────────────────
//
// En modo preview el llamador abre UNA transacción para todo el archivo y la
// revierte al final: así el informe sale del importador de verdad, no de un
// validador paralelo que se desincroniza y acaba mintiendo. Es el mismo patrón
// que se usó para el borrado masivo de inventario: la simulación y la corrida
// real reportaron las mismas cifras porque son el mismo código.
//
// Con `client` externo NO se hace BEGIN/COMMIT — manda el llamador.

const _abrir = async (clienteExterno) => {
  if (clienteExterno) return { client: clienteExterno, propia: false };
  const client = await pool.connect();
  await client.query('BEGIN');
  return { client, propia: true };
};

const _cerrar = async (ctx, exito) => {
  if (!ctx.propia) return;
  try {
    await ctx.client.query(exito ? 'COMMIT' : 'ROLLBACK');
  } finally {
    ctx.client.release();
  }
};

// ─────────────────────────────────────────────
// IMPORTAR SERIAL
// ─────────────────────────────────────────────

const importarSerial = async (hojas, sucursalId, negocioId, config = {}, opciones = {}) => {
  const informe = opciones.informe || crearInforme();
  const totalFilas = hojas.reduce((s, h) => s + h.filas.length, 0);
  if (totalFilas > MAX_FILAS) {
    throw {
      status: 400,
      message: `El archivo tiene ${totalFilas} filas. El máximo permitido es ${MAX_FILAS}.`,
    };
  }

  // ── Leer configuración del negocio ────────────────────────────────────────
  const coloresActivo         = config.colores_serial_activo === '1';
  const caracteristicasActivo = config.caracteristicas_serial_activo === '1';
  const ubicacionActiva       = config.ubicacion_activa === '1' && hayUbicacion();
  const tarifasActivas        = config.tarifas_activo === '1';
  // Lista de características con su nombre original (para guardar como clave en JSON)
  // y su forma normalizada (para buscarla en la fila importada)
  // `claves` trae la forma desambiguada y la simple: una plantilla descargada
  // antes de que existiera el sufijo « (caract.)» se sigue leyendo igual.
  const caracteristicasLista  = _parseLista(config.caracteristicas_serial_lista).map((nombre) => ({
    original: nombre,
    claves:   clavesCaracteristica(nombre),
  }));

  const resumenPorProducto = [];
  // IMEI ya visto en ESTE archivo → dónde. Un mismo IMEI dos veces en el Excel
  // es error de dedo garantizado (los IMEI son únicos por definición física).
  const imeisArchivo   = new Map();
  const nombresArchivo = new Map();

  for (const hoja of hojas) {
    const resultado = {
      producto: hoja.nombreProducto,
      insertados: 0, actualizados: 0, omitidos: 0, errores: [],
    };

    const ctx = await _abrir(opciones.client);
    // Con cliente externo, un fallo de hoja no puede tumbar el resto del
    // archivo: se aísla en su propio savepoint.
    if (!ctx.propia) await ctx.client.query('SAVEPOINT hoja_sp');
    const client = ctx.client;
    let hojaOk = true;

    try {
      // Línea es atributo del producto, no del serial → resolverla una vez por hoja
      const lineaNombre = hoja.filas.find((f) => f.linea?.toString().trim())?.linea?.toString().trim() ?? null;
      const linea       = await _resolverLinea(client, lineaNombre, negocioId);
      const lineaId     = linea.id;
      if (linea.creado && !informe.lineas_nuevas.includes(linea.nombre)) {
        informe.lineas_nuevas.push(linea.nombre);
      }
      if (!lineaId) {
        avisoUnico(informe, {
          hoja: hoja.nombreHoja, fila: null, columna: 'Linea', valor: hoja.nombreProducto,
          tipo: AVISO.SIN_LINEA,
          mensaje: `El producto «${hoja.nombreProducto}» queda sin línea (categoría).`,
          sugerencia: 'Al crearlo desde la app la línea es obligatoria; conviene ponerla aquí también.',
        });
      }

      // La ubicación es del PRODUCTO, no de cada IMEI: se toma la primera fila
      // de la hoja que la traiga, igual que se hace con la línea.
      const ubicacionHoja = hoja.filas.find((f) => f.ubicacion?.toString().trim())
        ?.ubicacion?.toString().trim() ?? null;

      // Garantizar que el producto existe aunque la hoja no tenga seriales.
      // Solo llega aquí una hoja que SÍ tiene columna IMEI (el controller ya
      // descartó las demás), así que esto ya no fabrica productos fantasma a
      // partir de una hoja "Resumen" o "Hoja1" que alguien dejó en el libro.
      if (hoja.filas.length === 0) {
        const vacio = await _resolverProductoSerial(client, {
          nombre: hoja.nombreProducto,
          marca: null, modelo: null, precio: null,
          sucursalId, proveedorId: null, lineaId,
        });
        await _avisarSobreNombre(client, 'productos_serial', {
          informe, hoja: hoja.nombreHoja, fila: null, nombre: hoja.nombreProducto,
          sucursalId, coincidencias: vacio.coincidencias, vistosArchivo: nombresArchivo,
        });
        await _aplicarUbicacion(client, 'productos_serial', vacio.id, ubicacionHoja, ubicacionActiva);
      }

      for (const [i, fila] of hoja.filas.entries()) {
        const nFila = fila._fila ?? (i + 4);

        const imei = fila.imei?.toString().trim();
        if (!imei) {
          conflicto(informe, {
            hoja: hoja.nombreHoja, fila: nFila, columna: 'IMEI', valor: null,
            tipo: CONFLICTO.IMEI_REQUERIDO,
            mensaje: 'La fila no tiene IMEI y se omite.',
          });
          resultado.errores.push({ fila: nFila, error: 'IMEI vacío' });
          resultado.omitidos++;
          continue;
        }

        const imeiClave = imei.toUpperCase();
        if (imeisArchivo.has(imeiClave)) {
          const previo = imeisArchivo.get(imeiClave);
          conflicto(informe, {
            hoja: hoja.nombreHoja, fila: nFila, columna: 'IMEI', valor: imei,
            tipo: CONFLICTO.IMEI_REPETIDO,
            mensaje: `Este IMEI ya aparece en la fila ${previo.fila}${previo.hoja !== hoja.nombreHoja ? ` de la hoja «${previo.hoja}»` : ''}. Se omite.`,
            sugerencia: 'Un IMEI es único: no puede estar dos veces en el archivo.',
          });
          resultado.errores.push({ fila: nFila, error: `IMEI repetido (fila ${previo.fila})` });
          resultado.omitidos++;
          continue;
        }

        // Savepoint por fila: si una fila falla, se revierte SOLO esa fila y la
        // hoja continúa. Sin esto, el 1er error aborta toda la transacción de la
        // hoja y el COMMIT hace un ROLLBACK silencioso (se pierde todo).
        await client.query('SAVEPOINT fila_sp');
        try {
          // ── El IMEI es único en TODO el negocio ─────────────────────────
          // Un teléfono no puede estar en dos sedes a la vez. Antes se buscaba
          // igual en todo el negocio pero la reacción era hacer UPDATE sobre la
          // fila de la OTRA sucursal: reportaba "actualizado", modificaba una
          // sede que el usuario nunca mencionó, y en la sede destino no
          // aparecía nada. Ahora la misma sede actualiza (re-import correctivo)
          // y otra sede es conflicto explícito.
          const { rows: yaExiste } = await client.query(
            `SELECT s.id, s.vendido, s.prestado, ps.sucursal_id, ps.nombre AS producto_nombre,
                    su.nombre AS sucursal_nombre
             FROM seriales s
             JOIN productos_serial ps ON ps.id = s.producto_id
             JOIN sucursales       su ON su.id = ps.sucursal_id
             WHERE UPPER(TRIM(s.imei)) = UPPER(TRIM($1)) AND su.negocio_id = $2
             ORDER BY s.id ASC LIMIT 1`,
            [imei, negocioId]
          );
          const previo = yaExiste[0] || null;

          if (previo && previo.sucursal_id !== sucursalId) {
            conflicto(informe, {
              hoja: hoja.nombreHoja, fila: nFila, columna: 'IMEI', valor: imei,
              tipo: CONFLICTO.IMEI_OTRA_SEDE,
              mensaje: `Este IMEI ya está registrado en la sucursal «${previo.sucursal_nombre}» (producto «${previo.producto_nombre}»). No se importa.`,
              sugerencia: 'Si el equipo se movió de sede, usa un traslado en vez de importarlo.',
            });
            resultado.errores.push({ fila: nFila, error: `IMEI ya existe en ${previo.sucursal_nombre}` });
            resultado.omitidos++;
            await client.query('RELEASE SAVEPOINT fila_sp');
            continue;
          }

          if (previo && (previo.vendido || previo.prestado)) {
            const estado = previo.vendido ? 'vendida' : 'prestada';
            conflicto(informe, {
              hoja: hoja.nombreHoja, fila: nFila, columna: 'IMEI', valor: imei,
              tipo: previo.vendido ? CONFLICTO.IMEI_VENDIDO : CONFLICTO.IMEI_PRESTADO,
              mensaje: `Esta unidad ya está ${estado}. No se toca.`,
              sugerencia: 'Reescribir su costo cambiaría la utilidad de una venta ya hecha.',
            });
            resultado.errores.push({ fila: nFila, error: `Unidad ya ${estado}` });
            resultado.omitidos++;
            await client.query('RELEASE SAVEPOINT fila_sp');
            continue;
          }

          imeisArchivo.set(imeiClave, { fila: nFila, hoja: hoja.nombreHoja });

          const prov = await _resolverProveedor(client, fila.proveedor, negocioId);
          if (prov.creado && !informe.proveedores_nuevos.includes(prov.nombre)) {
            informe.proveedores_nuevos.push(prov.nombre);
          }

          // Precio de venta para productos_serial
          const precio = _numero(fila.precio);

          const resuelto = await _resolverProductoSerial(client, {
            nombre: hoja.nombreProducto,
            marca:  fila.marca,
            modelo: fila.modelo,
            precio,
            sucursalId,
            proveedorId: prov.id,
            lineaId,
          });
          const productoId = resuelto.id;

          if (i === 0) {
            await _avisarSobreNombre(client, 'productos_serial', {
              informe, hoja: hoja.nombreHoja, fila: nFila, nombre: hoja.nombreProducto,
              sucursalId, coincidencias: resuelto.coincidencias, vistosArchivo: nombresArchivo,
            });
          }

          await _aplicarUbicacion(client, 'productos_serial', productoId, ubicacionHoja, ubicacionActiva);

          const { fecha: fechaEntrada, reconocida } = _formatearFecha(fila.fecha_entrada);
          if (!reconocida) {
            aviso(informe, {
              hoja: hoja.nombreHoja, fila: nFila, columna: 'Fecha Entrada', valor: fila.fecha_entrada,
              tipo: AVISO.FECHA_NO_LEIDA,
              mensaje: `No se pudo leer la fecha; se guarda con la fecha de hoy (${fechaEntrada}).`,
              sugerencia: 'Usa el formato dd/mm/aaaa.',
            });
          }

          const costoCompra   = _numero(fila.costo_compra);
          const clienteOrigen = fila.cliente_origen?.toString().trim() || null;

          if (costoCompra === null && !previo) {
            avisoUnico(informe, {
              hoja: hoja.nombreHoja, fila: nFila, columna: 'Costo Compra', valor: hoja.nombreProducto,
              tipo: tarifasActivas ? AVISO.SIN_COSTO_TARIFAS : AVISO.SIN_COSTO,
              mensaje: tarifasActivas
                ? `«${hoja.nombreProducto}» entra sin costo. Con tarifas activas no se le podrá calcular precio por tarifa, y sus ventas no mostrarán utilidad.`
                : `«${hoja.nombreProducto}» entra sin costo: sus ventas no mostrarán utilidad en los reportes.`,
              sugerencia: 'Es opcional. Si tu negocio no registra costos, ignora este aviso.',
            });
          }

          // Color (solo si la feature está activa)
          const color = coloresActivo
            ? (fila.color?.toString().trim() || null)
            : null;

          // Características: construir JSON con nombre original como clave
          let caracteristicas = null;
          if (caracteristicasActivo && caracteristicasLista.length > 0) {
            const obj = {};
            for (const { original, claves } of caracteristicasLista) {
              // Gana la columna desambiguada si existe; si no, la simple.
              const clave = claves.find((k) => fila[k] !== undefined && String(fila[k]).trim() !== '');
              const valor = clave ? fila[clave].toString().trim() : '';
              if (valor) obj[original] = valor;
            }
            if (Object.keys(obj).length > 0) caracteristicas = obj;
          }

          if (previo) {
            await client.query(
              `UPDATE seriales SET
                 costo_compra    = COALESCE($1, costo_compra),
                 precio          = COALESCE($2, precio),
                 cliente_origen  = COALESCE($3, cliente_origen),
                 color           = COALESCE($4, color),
                 caracteristicas = COALESCE($5::jsonb, caracteristicas)
               WHERE id = $6`,
              [
                costoCompra,
                precio,
                clienteOrigen,
                color,
                caracteristicas ? JSON.stringify(caracteristicas) : null,
                previo.id,
              ]
            );
            await _aplicarNota(client, 'seriales', previo.id, fila.nota);
            aviso(informe, {
              hoja: hoja.nombreHoja, fila: nFila, columna: 'IMEI', valor: imei,
              tipo: AVISO.SERIAL_ACTUALIZADO,
              mensaje: 'Este IMEI ya estaba en esta sucursal: se actualizan sus datos, no se duplica.',
            });
            resultado.actualizados++;
          } else {
            const { rows: creado } = await client.query(
              `INSERT INTO seriales
                 (producto_id, imei, fecha_entrada, costo_compra, precio, cliente_origen, color, caracteristicas)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id`,
              [
                productoId, imei, fechaEntrada,
                costoCompra, precio, clienteOrigen,
                color,
                caracteristicas ? JSON.stringify(caracteristicas) : null,
              ]
            );
            await _aplicarNota(client, 'seriales', creado[0]?.id, fila.nota);
            resultado.insertados++;
          }
          await client.query('RELEASE SAVEPOINT fila_sp');
        } catch (err) {
          await client.query('ROLLBACK TO SAVEPOINT fila_sp');
          const msg = _mensajeSeguro(err);
          conflicto(informe, {
            hoja: hoja.nombreHoja, fila: nFila, columna: null, valor: imei,
            tipo: CONFLICTO.ERROR_FILA,
            mensaje: `${msg} (producto «${hoja.nombreProducto}»).`,
          });
          resultado.errores.push({ fila: nFila, error: msg });
          resultado.omitidos++;
        }
      }

      if (!ctx.propia) await client.query('RELEASE SAVEPOINT hoja_sp');
    } catch (err) {
      hojaOk = false;
      if (!ctx.propia) {
        await client.query('ROLLBACK TO SAVEPOINT hoja_sp').catch(() => {});
      }
      const msg = _mensajeSeguro(err);
      conflicto(informe, {
        hoja: hoja.nombreHoja, fila: null, columna: null, valor: hoja.nombreProducto,
        tipo: CONFLICTO.ERROR_FILA,
        mensaje: `La hoja completa falló: ${msg}.`,
      });
      resultado.errores.push({ fila: 0, error: `Error general en hoja: ${msg}` });
    } finally {
      await _cerrar(ctx, hojaOk);
    }

    resumenPorProducto.push(resultado);
  }

  const totales = resumenPorProducto.reduce(
    (acc, r) => ({
      insertados:   acc.insertados   + r.insertados,
      actualizados: acc.actualizados + r.actualizados,
      omitidos:     acc.omitidos     + r.omitidos,
    }),
    { insertados: 0, actualizados: 0, omitidos: 0 }
  );

  return { ...totales, detalle: resumenPorProducto };
};

// ─────────────────────────────────────────────
// HELPERS DE VARIANTES (para importarCantidad)
// ─────────────────────────────────────────────

// Crea o actualiza el producto raíz sin tocar su stock (el stock lo manejan atributos/variantes)
const _resolverProductoBase = async (client, { nombre, sucursalId, proveedorId, costoUnit, unidad, clienteOrig, precioVenta, lineaId }) => {
  const coincidencias = await _buscarPorNombre(client, 'productos_cantidad', nombre, sucursalId);
  if (coincidencias.length) {
    await client.query(
      `UPDATE productos_cantidad SET
         costo_unitario = COALESCE($1, costo_unitario),
         unidad_medida  = COALESCE(NULLIF($2,''), unidad_medida),
         cliente_origen = COALESCE($3, cliente_origen),
         proveedor_id   = COALESCE($4, proveedor_id),
         precio         = COALESCE($5, precio),
         linea_id       = COALESCE($6, linea_id)
       WHERE id = $7`,
      [costoUnit, unidad, clienteOrig, proveedorId, precioVenta, lineaId, coincidencias[0].id]
    );
    return { id: coincidencias[0].id, coincidencias, nuevo: false };
  }
  const { rows: nuevo } = await client.query(
    `INSERT INTO productos_cantidad
       (sucursal_id, proveedor_id, nombre, stock, stock_minimo, costo_unitario, unidad_medida, cliente_origen, precio, linea_id)
     VALUES($1,$2,$3,0,0,$4,$5,$6,$7,$8) RETURNING id`,
    [sucursalId, proveedorId, nombre, costoUnit, unidad, clienteOrig, precioVenta, lineaId]
  );
  return { id: nuevo[0].id, coincidencias, nuevo: true };
};

// Busca o crea un atributo para el producto en la sucursal.
//
// El costo se propaga hacia abajo: antes el atributo nacía con
// `costo_unitario` NULL aunque el usuario SÍ hubiera escrito el costo en su
// fila, y como los reportes leen el costo del atributo/variante al vender, esa
// venta salía con utilidad NULL para siempre. No es "el negocio no quiso poner
// costo" — es que el importador tiraba el que sí puso.
const _resolverAtributo = async (client, productoId, sucursalId, valor, costoUnit) => {
  const { rows } = await client.query(
    `SELECT id FROM atributos_producto
     WHERE producto_id = $1 AND sucursal_id = $2 AND LOWER(valor) = LOWER($3) AND activo = true
     ORDER BY id ASC LIMIT 1`,
    [productoId, sucursalId, valor]
  );
  if (rows.length) {
    if (costoUnit !== null) {
      await client.query(
        `UPDATE atributos_producto SET costo_unitario = COALESCE($1, costo_unitario) WHERE id = $2`,
        [costoUnit, rows[0].id]
      );
    }
    return { id: rows[0].id, nuevo: false };
  }
  const { rows: ins } = await client.query(
    `INSERT INTO atributos_producto (producto_id, sucursal_id, valor, stock, stock_minimo, costo_unitario)
     VALUES($1, $2, $3, 0, 0, $4) RETURNING id`,
    [productoId, sucursalId, valor.trim(), costoUnit]
  );
  return { id: ins[0].id, nuevo: true };
};

// Busca o crea/actualiza una variante dentro de un atributo
const _ajustarVariante = async (client, atributoId, valor, stock, stockMinimo, precioVenta, costoUnit) => {
  const { rows } = await client.query(
    `SELECT id FROM variantes_atributo
     WHERE atributo_id = $1 AND LOWER(valor) = LOWER($2) AND activo = true
     ORDER BY id ASC LIMIT 1`,
    [atributoId, valor]
  );
  if (rows.length) {
    await client.query(
      `UPDATE variantes_atributo SET
         stock          = stock + $1,
         stock_minimo   = GREATEST(stock_minimo, $2),
         precio         = COALESCE($3, precio),
         costo_unitario = COALESCE($4, costo_unitario)
       WHERE id = $5`,
      [stock, stockMinimo, precioVenta, costoUnit, rows[0].id]
    );
    return { id: rows[0].id, accion: 'actualizado' };
  }
  const { rows: ins } = await client.query(
    `INSERT INTO variantes_atributo (atributo_id, valor, stock, stock_minimo, precio, costo_unitario)
     VALUES($1, $2, $3, $4, $5, $6) RETURNING id`,
    [atributoId, valor.trim(), stock, stockMinimo, precioVenta, costoUnit]
  );
  return { id: ins[0].id, accion: 'insertado' };
};

// Recalcula stock en cascada: variantes → atributo → producto
const _recalcularStockProducto = async (client, productoId) => {
  await client.query(
    `UPDATE atributos_producto ap
     SET stock = COALESCE(sub.total, 0)
     FROM (
       SELECT v.atributo_id, SUM(v.stock) AS total
       FROM variantes_atributo v
       WHERE v.activo = true
       GROUP BY v.atributo_id
     ) sub
     WHERE ap.id = sub.atributo_id AND ap.producto_id = $1 AND ap.activo = true`,
    [productoId]
  );
  await client.query(
    `UPDATE productos_cantidad pc
     SET stock = sub.total
     FROM (
       SELECT ap.producto_id, COALESCE(SUM(ap.stock), 0) AS total
       FROM atributos_producto ap
       WHERE ap.activo = true AND ap.producto_id = $1
       GROUP BY ap.producto_id
     ) sub
     WHERE pc.id = sub.producto_id
       AND EXISTS (
         SELECT 1 FROM atributos_producto WHERE producto_id = $1 AND activo = true
       )`,
    [productoId]
  );
};

// ─────────────────────────────────────────────
// IMPORTAR CANTIDAD
// ─────────────────────────────────────────────

// Código único: Excel suele convertir códigos largos (EAN-13) a número y
// mostrarlos en notación científica, o perder ceros a la izquierda. Por eso
// la plantilla pide TEXTO, y aquí se recuperan los casos numéricos comunes.
const _normalizarCodigoImport = (valor) => {
  if (valor === undefined || valor === null) return null;
  let s = String(valor).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?[eE]\+?\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) s = String(Math.round(n));
  } else if (/^\d+\.0+$/.test(s)) {
    s = s.replace(/\.0+$/, '');
  }
  s = s.toUpperCase();
  if (/\s/.test(s)) throw { message: 'El código no puede contener espacios' };
  if (s.length > 50) throw { message: 'El código no puede superar 50 caracteres' };
  return s;
};

const importarCantidad = async (filas, sucursalId, negocioId, config = {}, opciones = {}) => {
  const informe         = opciones.informe || crearInforme();
  const variantesActivo = config.variantes_activo === '1';
  const codigoActivo    = config.codigo_producto_activo === '1';
  const ubicacionActiva = config.ubicacion_activa === '1' && hayUbicacion();
  const tarifasActivas  = config.tarifas_activo === '1';

  if (filas.length > MAX_FILAS) {
    throw {
      status: 400,
      message: `El archivo tiene ${filas.length} filas. El máximo permitido es ${MAX_FILAS}.`,
    };
  }

  const resultado = { insertados: 0, actualizados: 0, omitidos: 0, errores: [], unidades_sumadas: 0 };

  // codigo → identidad ya vista en el archivo, para detectar el mismo código
  // apuntando a dos cosas distintas dentro del mismo Excel.
  const codigosArchivo = new Map();
  const nombresArchivo = new Map();

  // ── ¿Los códigos de este producto son del PRODUCTO o de sus VARIANTES? ────
  //
  // Las dos formas existen y las dos son legítimas:
  //   · códigos DISTINTOS en varias filas del mismo producto → cada código
  //     identifica ESA variante. Es lo que pedía el lector: escanear la talla
  //     38MM, no "la correa".
  //   · un solo código (repetido o en una sola fila) → identifica el PRODUCTO,
  //     como venían los archivos hasta hoy.
  //
  // Mirando una fila sola es imposible distinguirlas: hay que ver el archivo
  // entero antes de empezar. Y la regla tiene que ser conservadora, porque
  // mover un código del producto a una variante no es gratis — `red-interna`
  // empareja el mismo producto entre sedes por `productos_cantidad.codigo`, y
  // vaciarlo lo dejaría emparejando solo por nombre.
  //
  // Sin esta pasada previa, un archivo con el mismo código repetido en las
  // filas de un producto perdía todas menos la primera, rechazadas por "código
  // repetido" y EN SILENCIO — justo el daño que este importador existe para
  // no hacer.
  const productosConCodigoPorVariante = new Set();
  {
    const porProducto = new Map();
    for (const f of filas) {
      let c;
      try { c = _normalizarCodigoImport(f.codigo ?? f['código']); } catch { continue; }
      const nom = f.nombre?.toString().trim();
      if (!c || !nom) continue;
      const k = nom.toLowerCase();
      if (!porProducto.has(k)) porProducto.set(k, new Set());
      porProducto.get(k).add(c);
    }
    for (const [k, codigos] of porProducto) {
      if (codigos.size > 1) productosConCodigoPorVariante.add(k);
    }
  }

  const ctx = await _abrir(opciones.client);
  const client = ctx.client;
  let exito = true;

  try {
    for (const [i, fila] of filas.entries()) {
      const nFila = fila._fila ?? (i + 4);

      const nombre = fila.nombre?.toString().trim();
      if (!nombre) {
        conflicto(informe, {
          hoja: 'Productos Cantidad', fila: nFila, columna: 'Nombre', valor: null,
          tipo: CONFLICTO.NOMBRE_REQUERIDO,
          mensaje: 'La fila no tiene nombre de producto y se omite.',
        });
        resultado.errores.push({ fila: nFila, error: 'Nombre requerido' });
        resultado.omitidos++;
        continue;
      }

      let codigo = null;
      try {
        // La plantilla usa "Codigo", pero se tolera "Código" escrito a mano
        codigo = _normalizarCodigoImport(fila.codigo ?? fila['código']);
      } catch (e) {
        conflicto(informe, {
          hoja: 'Productos Cantidad', fila: nFila, columna: 'Codigo', valor: fila.codigo ?? fila['código'],
          tipo: CONFLICTO.CODIGO_INVALIDO,
          mensaje: e.message,
        });
        resultado.errores.push({ fila: nFila, error: e.message });
        resultado.omitidos++;
        continue;
      }
      if (codigo && !codigoActivo) {
        avisoUnico(informe, {
          hoja: 'Productos Cantidad', fila: nFila, columna: 'Codigo', valor: codigo,
          tipo: AVISO.CODIGO_NO_APLICADO,
          mensaje: 'El archivo trae códigos pero la feature "Código único de producto" está apagada en Ajustes. Se guardan igual.',
        });
      }
      // El código identifica el NODO que describe la fila, no el producto: con
      // variantes activas, la fila «Correa / 38MM» le pone código a esa talla.
      // Por eso la identidad para detectar choques lleva los tres valores.
      const atributoValor = variantesActivo ? fila.atributo?.toString().trim() || null : null;
      const varianteValor = atributoValor   ? fila.variante?.toString().trim() || null : null;
      const identidadNodo = { producto: nombre, atributo: atributoValor, variante: varianteValor };

      // …salvo que el archivo repita ese código en varias filas del mismo
      // producto: entonces el código es DEL PRODUCTO (la forma de siempre), y
      // esa es la identidad que manda en todo lo que sigue: la detección de
      // choques, la herencia y la propagación.
      const codigoEsDelProducto = !productosConCodigoPorVariante.has(nombre.toLowerCase());
      const identidadCodigo = codigoEsDelProducto
        ? { producto: nombre, atributo: null, variante: null }
        : identidadNodo;
      const claveNodo = codigoEsDelProducto
        ? nombre.toLowerCase()
        : [nombre, atributoValor ?? '', varianteValor ?? ''].join('|').toLowerCase();
      const etiquetaNodo = codigoEsDelProducto
        ? nombre
        : [nombre, atributoValor, varianteValor].filter(Boolean).join(' / ');

      if (codigo) {
        const nodoPrevio = codigosArchivo.get(codigo);
        if (nodoPrevio && nodoPrevio.clave !== claveNodo) {
          conflicto(informe, {
            hoja: 'Productos Cantidad', fila: nFila, columna: 'Codigo', valor: codigo,
            tipo: CONFLICTO.CODIGO_ARCHIVO,
            mensaje: `El código ${codigo} aparece en el archivo con otra fila («${nodoPrevio.etiqueta}»). Se omite la fila.`,
            sugerencia: 'Un código debe apuntar a una sola variante.',
          });
          resultado.errores.push({ fila: nFila, error: `El código ${codigo} aparece en el archivo con otra variante` });
          resultado.omitidos++;
          continue;
        }
        codigosArchivo.set(codigo, { clave: claveNodo, etiqueta: etiquetaNodo });

        // Contra la BD: el MISMO nodo en otra sucursal comparte código a
        // propósito (así el lector funciona en las dos sedes), así que la
        // comparación es por identidad y no por id — que además todavía no
        // existe si el nodo se va a crear en esta misma fila.
        const tomado = await codigoTomadoPorOtroNodo(client, {
          negocioId, codigo, identidad: identidadCodigo,
        });
        if (tomado) {
          conflicto(informe, {
            hoja: 'Productos Cantidad', fila: nFila, columna: 'Codigo', valor: codigo,
            tipo: CONFLICTO.CODIGO_EN_USO,
            mensaje: `El código ${codigo} ya está en uso por «${tomado.etiqueta}» (${tomado.sucursal_nombre}). Se omite la fila.`,
            sugerencia: 'Cambia el código en el Excel o corrige el nombre de la fila.',
          });
          resultado.errores.push({ fila: nFila, error: `El código ${codigo} ya está en uso por "${tomado.etiqueta}"` });
          resultado.omitidos++;
          continue;
        }
      }

      // Savepoint por fila: un error revierte solo esa fila, no toda la importación.
      await client.query('SAVEPOINT fila_sp');
      try {
        const stock       = _entero(fila.stock)        ?? 0;
        const stockMinimo = _entero(fila.stock_minimo) ?? 0;
        const costoUnit   = _numero(fila.costo_unitario);
        const precioVenta = _numero(fila.precio_venta);
        const unidad      = fila.unidad_medida?.toString().trim() || 'unidad';
        const clienteOrig = fila.cliente_origen?.toString().trim() || null;

        const prov = await _resolverProveedor(client, fila.proveedor, negocioId);
        if (prov.creado && !informe.proveedores_nuevos.includes(prov.nombre)) {
          informe.proveedores_nuevos.push(prov.nombre);
        }
        const linea = await _resolverLinea(client, fila.linea, negocioId);
        if (linea.creado && !informe.lineas_nuevas.includes(linea.nombre)) {
          informe.lineas_nuevas.push(linea.nombre);
        }
        const proveedorId = prov.id;
        const lineaId     = linea.id;

        if (!lineaId) {
          aviso(informe, {
            hoja: 'Productos Cantidad', fila: nFila, columna: 'Linea', valor: nombre,
            tipo: AVISO.SIN_LINEA,
            mensaje: `«${nombre}» queda sin línea (categoría).`,
            sugerencia: 'Al crearlo desde la app la línea es obligatoria; conviene ponerla aquí también.',
          });
        }
        if (costoUnit === null) {
          aviso(informe, {
            hoja: 'Productos Cantidad', fila: nFila, columna: 'Costo Unitario', valor: nombre,
            tipo: tarifasActivas ? AVISO.SIN_COSTO_TARIFAS : AVISO.SIN_COSTO,
            mensaje: tarifasActivas
              ? `«${nombre}» entra sin costo. Con tarifas activas no se le podrá calcular precio por tarifa, y sus ventas no mostrarán utilidad.`
              : `«${nombre}» entra sin costo: sus ventas no mostrarán utilidad en los reportes.`,
            sugerencia: 'Es opcional. Si tu negocio no registra costos, ignora este aviso.',
          });
        }

        // Nodo al que pertenece el código de esta fila: se llena más abajo,
        // cuando ya se sabe si el stock fue al producto, al atributo o a la
        // sub-variante. { tabla, id }
        let nodoDelCodigo = null;
        // Id del producto de esta fila, para cuando el código es del producto
        // aunque el stock haya ido a una variante.
        let productoDeLaFila = null;

        if (!variantesActivo && fila.atributo?.toString().trim()) {
          avisoUnico(informe, {
            hoja: 'Productos Cantidad', fila: nFila, columna: 'Atributo', valor: fila.atributo,
            tipo: AVISO.CODIGO_NO_APLICADO,
            mensaje: 'El archivo trae Atributo/Variante pero la feature "Variantes" está apagada en Ajustes. Esas columnas se ignoran y el stock va al producto.',
          });
        }

        if (atributoValor) {
          // ── Con variante: el producto es contenedor, el stock vive en atributo/variante ──
          const base = await _resolverProductoBase(client, {
            nombre, sucursalId, proveedorId, costoUnit, unidad, clienteOrig, precioVenta, lineaId,
          });
          const productoId = base.id;
          productoDeLaFila = productoId;
          await _avisarSobreNombre(client, 'productos_cantidad', {
            informe, hoja: 'Productos Cantidad', fila: nFila, nombre,
            sucursalId, coincidencias: base.coincidencias, vistosArchivo: nombresArchivo,
          });
          await _aplicarUbicacion(client, 'productos_cantidad', productoId, fila.ubicacion, ubicacionActiva);
          await _aplicarNota(client, 'productos_cantidad', productoId, fila.nota);

          const { id: atributoId, nuevo: atrNuevo } = await _resolverAtributo(
            client, productoId, sucursalId, atributoValor, costoUnit
          );

          if (varianteValor) {
            // Stock → variante (nivel 2); luego sincronizar hacia arriba
            const { id: varianteId, accion } = await _ajustarVariante(
              client, atributoId, varianteValor, stock, stockMinimo, precioVenta, costoUnit
            );
            nodoDelCodigo = { tabla: 'variantes_atributo', id: varianteId };
            await _recalcularStockProducto(client, productoId);
            if (accion === 'insertado') {
              resultado.insertados++;
            } else {
              resultado.actualizados++;
              resultado.unidades_sumadas += stock;
              if (stock > 0) {
                aviso(informe, {
                  hoja: 'Productos Cantidad', fila: nFila, columna: 'Stock', valor: stock,
                  tipo: AVISO.STOCK_SE_SUMA,
                  mensaje: `La variante «${atributoValor} / ${varianteValor}» de «${nombre}» ya existía: se SUMAN ${stock} unidades a lo que ya tenía.`,
                  sugerencia: 'Si vuelves a subir este archivo, se sumarán otra vez.',
                });
              }
            }
          } else {
            // Stock → atributo (nivel 1, sin sub-variantes)
            await client.query(
              `UPDATE atributos_producto SET
                 stock        = stock + $1,
                 stock_minimo = GREATEST(stock_minimo, $2),
                 precio       = COALESCE($3, precio)
               WHERE id = $4`,
              [stock, stockMinimo, precioVenta, atributoId]
            );
            nodoDelCodigo = { tabla: 'atributos_producto', id: atributoId };
            await _recalcularStockProducto(client, productoId);
            if (atrNuevo) {
              resultado.insertados++;
            } else {
              resultado.actualizados++;
              resultado.unidades_sumadas += stock;
              if (stock > 0) {
                aviso(informe, {
                  hoja: 'Productos Cantidad', fila: nFila, columna: 'Stock', valor: stock,
                  tipo: AVISO.STOCK_SE_SUMA,
                  mensaje: `El atributo «${atributoValor}» de «${nombre}» ya existía: se SUMAN ${stock} unidades a lo que ya tenía.`,
                  sugerencia: 'Si vuelves a subir este archivo, se sumarán otra vez.',
                });
              }
            }
          }
        } else {
          // ── Sin variante: comportamiento original sobre productos_cantidad ──
          const existe = await _buscarPorNombre(client, 'productos_cantidad', nombre, sucursalId);
          await _avisarSobreNombre(client, 'productos_cantidad', {
            informe, hoja: 'Productos Cantidad', fila: nFila, nombre,
            sucursalId, coincidencias: existe, vistosArchivo: nombresArchivo,
          });

          if (existe.length) {
            await client.query(
              `UPDATE productos_cantidad SET
                 stock          = stock + $1,
                 stock_minimo   = GREATEST(stock_minimo, $2),
                 costo_unitario = COALESCE($3, costo_unitario),
                 unidad_medida  = COALESCE(NULLIF($4,''), unidad_medida),
                 cliente_origen = COALESCE($5, cliente_origen),
                 proveedor_id   = COALESCE($6, proveedor_id),
                 precio         = COALESCE($7, precio),
                 linea_id       = COALESCE($8, linea_id)
               WHERE id = $9`,
              [stock, stockMinimo, costoUnit, unidad, clienteOrig, proveedorId, precioVenta, lineaId, existe[0].id]
            );
            await _aplicarUbicacion(client, 'productos_cantidad', existe[0].id, fila.ubicacion, ubicacionActiva);
            await _aplicarNota(client, 'productos_cantidad', existe[0].id, fila.nota);
            nodoDelCodigo = { tabla: 'productos_cantidad', id: existe[0].id };
            productoDeLaFila = existe[0].id;
            resultado.actualizados++;
            resultado.unidades_sumadas += stock;
            if (stock > 0) {
              aviso(informe, {
                hoja: 'Productos Cantidad', fila: nFila, columna: 'Stock', valor: stock,
                tipo: AVISO.STOCK_SE_SUMA,
                mensaje: `«${existe[0].nombre}» ya existe en esta sucursal: se SUMAN ${stock} unidades a las que ya tenía.`,
                sugerencia: 'Si vuelves a subir este archivo, se sumarán otra vez.',
              });
            }
          } else {
            const { rows: creado } = await client.query(
              `INSERT INTO productos_cantidad
                 (sucursal_id, proveedor_id, nombre, stock, stock_minimo,
                  costo_unitario, unidad_medida, cliente_origen, precio, linea_id)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
               RETURNING id`,
              [sucursalId, proveedorId, nombre, stock, stockMinimo,
               costoUnit, unidad, clienteOrig, precioVenta, lineaId]
            );
            await _aplicarUbicacion(client, 'productos_cantidad', creado[0]?.id, fila.ubicacion, ubicacionActiva);
            await _aplicarNota(client, 'productos_cantidad', creado[0]?.id, fila.nota);
            nodoDelCodigo = { tabla: 'productos_cantidad', id: creado[0]?.id };
            productoDeLaFila = creado[0]?.id;
            resultado.insertados++;
          }
        }

        // ── Código único del NODO ────────────────────────────────────────
        // El código pertenece a lo que la fila describe: si la fila trae
        // Atributo, el código es de esa talla/color, no del producto. Antes
        // todo iba a `productos_cantidad` y "ganaba la última fila", así que un
        // producto con 30 atributos terminaba con un solo código y el lector
        // solo podía abrir el árbol para que alguien eligiera a mano.
        //
        // Sin código en la fila se hereda el del mismo nodo en otra sucursal,
        // para que el escaneo funcione igual en todas las sedes.
        let codigoFinal = codigo;
        if (!codigoFinal) {
          const { codigo: heredado, bloqueadoPor } = await heredarCodigo(client, {
            negocioId, sucursalId, identidad: identidadCodigo,
          });
          codigoFinal = heredado;
          // "No hay código que heredar" y "lo hay pero está ocupado" NO son lo
          // mismo: callar el segundo deja el escaneo roto en esta sede sin que
          // nadie sepa por qué.
          if (bloqueadoPor) {
            aviso(informe, {
              hoja: 'Productos Cantidad', fila: nFila, columna: 'Codigo', valor: bloqueadoPor.codigo,
              tipo: AVISO.CODIGO_NO_APLICADO,
              mensaje: `«${etiquetaNodo}» se importó sin código: en esta sucursal el código ${bloqueadoPor.codigo} ya lo tiene «${bloqueadoPor.etiqueta}».`,
              sugerencia: 'Escribe un código distinto en el Excel, o libera el que está ocupado.',
            });
          }
        }
        // Si el código es del producto (el archivo lo repite en varias de sus
        // filas), va al producto aunque el stock haya ido a una variante.
        if (codigoEsDelProducto && productoDeLaFila) {
          nodoDelCodigo = { tabla: 'productos_cantidad', id: productoDeLaFila };
        }

        // Va en su PROPIO savepoint: este UPDATE puede chocar con el índice
        // único si otra sucursal ya tiene ese código en un nodo distinto. Antes
        // ese 23505 reventaba el savepoint de la fila entera y se perdía el
        // producto recién insertado, con un "Registro duplicado" que no decía
        // de qué.
        if (codigoFinal && nodoDelCodigo?.id) {
          await client.query('SAVEPOINT codigo_sp');
          try {
            await client.query(
              `UPDATE ${nodoDelCodigo.tabla} SET codigo = $1 WHERE id = $2`,
              [codigoFinal, nodoDelCodigo.id]
            );
            await client.query('RELEASE SAVEPOINT codigo_sp');
            await propagarCodigo(client, { negocioId, identidad: identidadCodigo, codigo: codigoFinal });
          } catch (errCodigo) {
            await client.query('ROLLBACK TO SAVEPOINT codigo_sp');
            aviso(informe, {
              hoja: 'Productos Cantidad', fila: nFila, columna: 'Codigo', valor: codigoFinal,
              tipo: AVISO.CODIGO_NO_APLICADO,
              mensaje: `La fila se importó, pero no se le pudo poner el código ${codigoFinal}: ya está tomado.`,
              sugerencia: 'Revisa el código de esta variante después de importar.',
            });
          }
        }
        await client.query('RELEASE SAVEPOINT fila_sp');
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT fila_sp');
        const msg = _mensajeSeguro(err);
        conflicto(informe, {
          hoja: 'Productos Cantidad', fila: nFila, columna: null, valor: nombre,
          tipo: CONFLICTO.ERROR_FILA,
          mensaje: `${msg} (producto «${nombre}»).`,
        });
        resultado.errores.push({ fila: nFila, error: msg });
        resultado.omitidos++;
      }
    }
  } catch (err) {
    exito = false;
    await _cerrar(ctx, false);
    throw { status: 500, message: 'Error general en la importación de cantidad' };
  }

  await _cerrar(ctx, exito);
  return resultado;
};

module.exports = { importarSerial, importarCantidad, MAX_FILAS, _numero, _formatearFecha, limpiar };
