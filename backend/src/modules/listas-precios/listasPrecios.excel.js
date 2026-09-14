const XLSX = require('xlsx');
const { COLUMNAS_FIJAS } = require('./listasPrecios.plantilla');
const { MAX_PRECIO } = require('../../utils/listasPrecios.util');

// ─────────────────────────────────────────────────────────────────────────────
// LEER EL EXCEL DE PRECIOS — la MISMA función para el informe y para aplicar.
//
// Es la regla que ya sostiene la importación de inventario: «nunca escribir un
// validador paralelo, se desincroniza del importador y acaba mintiendo». Aquí
// `resolverLibro` hace todo el trabajo —leer, casar contra el inventario,
// decidir qué cambia— y devuelve las escrituras JUNTO con el informe. El
// endpoint de analizar devuelve el informe y tira las escrituras; el de importar
// aplica esas mismas escrituras. No hay dos caminos que puedan discrepar.
//
// Aquí no hace falta el truco del ROLLBACK que usa la importación de inventario,
// y es por una diferencia real: aquella CREA productos y su validación depende
// de lo que vaya creando. Esto solo actualiza una columna de filas que ya
// existen, así que resolver es una lectura pura y el informe es exacto sin
// escribir nada.
// ─────────────────────────────────────────────────────────────────────────────

const HOJA_INSTRUCCIONES = 'instrucciones';

/** Normalización SOLO para avisar y para el respaldo por nombre. Nunca decide. */
const NORM = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[\s_-]+/g, ' ').trim();

/**
 * Un precio de una celda.
 *   null  → la casilla está vacía o en cero: "sin precio en esta lista".
 *   número→ utilizable.
 *   undefined → hay algo escrito que NO es un precio: se reporta, no se adivina.
 */
const leerPrecio = (celda) => {
  if (celda === null || celda === undefined) return null;
  const texto = String(celda).trim();
  if (texto === '') return null;
  // "12.500", "$ 12.500", "12500,00" — lo que de verdad escribe la gente.
  const limpio = texto.replace(/[$\s]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const n = Number(limpio);
  if (!Number.isFinite(n)) return undefined;
  if (n === 0) return null;
  if (n < 0 || n > MAX_PRECIO) return undefined;
  return Math.round(n);
};

/**
 * Dos mapas de precios en forma comparable.
 *
 * NO se puede comparar con `JSON.stringify` a secas y esto no es un detalle:
 * Postgres devuelve un `jsonb` con SUS claves en SU orden —ordena por longitud
 * y luego por bytes, así que da {final, mayor, pasamano}— mientras que el mapa
 * nuevo se arma recorriendo las listas en el orden en que las configuró el
 * negocio: {pasamano, mayor, final}. Mismo contenido, cadena distinta.
 *
 * Con la comparación ingenua, el informe decía «438 cambios» sobre un archivo
 * en el que se habían tocado CUATRO precios. Eso no es un número feo: es un
 * informe que miente justo donde el usuario decide si aplicar o no, y de paso
 * reescribe 1.300 filas que nadie pidió tocar.
 */
const canonico = (precios) => {
  if (!precios) return 'null';
  return JSON.stringify(
    Object.keys(precios).sort().map((k) => [k, Number(precios[k])])
  );
};

/** Del token `p123` al nodo. Devuelve null si no tiene la forma esperada. */
const leerToken = (valor) => {
  const t = String(valor ?? '').trim().toLowerCase();
  const m = /^([pavs])(\d+)$/.exec(t);
  if (!m) return null;
  const nivel = { p: 'producto', a: 'atributo', v: 'variante', s: 'serial' }[m[1]];
  return { nivel, id: Number(m[2]) };
};

/**
 * Resuelve el libro contra el inventario real.
 *
 * `porSucursal` = Map(sucursalId → { nombre, nodos }) — lo que hay hoy en la BD.
 * Devuelve { informe, escrituras }.
 */
function resolverLibro(buffer, { listas, porSucursal }) {
  const wb = XLSX.read(buffer, { type: 'buffer' });

  const informe = {
    hojas: [], conflictos: [], avisos: [],
    total_filas: 0, con_cambio: 0, sin_cambio: 0,
  };
  const escrituras = [];

  // Índices de la BD: por token (exacto) y por nombre normalizado (respaldo).
  const indices = new Map();
  for (const [sucId, datos] of porSucursal) {
    const porToken  = new Map();
    const porNombre = new Map();
    for (const n of datos.nodos) {
      porToken.set(n.token, n);
      if (n.nivel === 'producto') {
        const k = NORM(n.nombre);
        if (!porNombre.has(k)) porNombre.set(k, []);
        porNombre.get(k).push(n);
      }
    }
    indices.set(sucId, { porToken, porNombre, nombre: datos.nombre });
  }

  // Qué hoja del Excel es qué sucursal. Se casa por NOMBRE de hoja, que es como
  // la generó la plantilla; una hoja que no corresponda a ninguna sucursal se
  // reporta en vez de ignorarse — un archivo del negocio de al lado, o una hoja
  // renombrada, tienen que verse.
  const porNombreHoja = new Map();
  for (const [sucId, idx] of indices) porNombreHoja.set(NORM(idx.nombre).slice(0, 31), sucId);

  for (const nombreHoja of wb.SheetNames) {
    if (NORM(nombreHoja) === HOJA_INSTRUCCIONES) continue;

    const sucursalId = porNombreHoja.get(NORM(nombreHoja).slice(0, 31));
    if (!sucursalId) {
      informe.conflictos.push({
        tipo: 'HOJA_DESCONOCIDA', hoja: nombreHoja,
        mensaje: `La hoja «${nombreHoja}» no corresponde a ninguna sucursal. `
          + 'Vuelve a descargar la plantilla y no le cambies el nombre a las hojas.',
      });
      continue;
    }

    const idx   = indices.get(sucursalId);
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[nombreHoja], { defval: null });
    const resumen = { hoja: nombreHoja, sucursal_id: sucursalId, filas: filas.length, cambios: 0 };

    // Las columnas de precio se identifican por el NOMBRE de la lista. Si el
    // admin renombró una lista después de bajar el archivo, su columna deja de
    // reconocerse: se reporta, porque escribir esa columna en la lista
    // equivocada sería cambiarle el precio a media venta sin que nadie lo pida.
    const cabeceras = Object.keys(filas[0] || {});
    const columnaDe = new Map();
    for (const l of listas) {
      const col = cabeceras.find((c) => NORM(c) === NORM(l.nombre));
      if (col) columnaDe.set(l.id, col);
      else informe.avisos.push({
        tipo: 'COLUMNA_FALTANTE', hoja: nombreHoja,
        mensaje: `La hoja «${nombreHoja}» no tiene la columna «${l.nombre}»: esa lista se deja como está.`,
      });
    }
    const desconocidas = cabeceras.filter((c) =>
      !COLUMNAS_FIJAS.some((f) => NORM(f) === NORM(c))
      && !listas.some((l) => NORM(l.nombre) === NORM(c)));
    for (const c of desconocidas) {
      informe.avisos.push({
        tipo: 'COLUMNA_IGNORADA', hoja: nombreHoja,
        mensaje: `La columna «${c}» no es ninguna de tus listas y se ignora.`,
      });
    }

    const yaVistos = new Set();

    for (const [i, fila] of filas.entries()) {
      informe.total_filas++;
      const numFila = i + 2;   // +1 por la cabecera, +1 porque Excel cuenta desde 1
      const etiqueta = [fila.Producto, fila.Detalle].filter(Boolean).join(' · ') || `fila ${numFila}`;

      // ── A qué nodo va esta fila ──────────────────────────────────────────
      let nodo = null;
      const token = leerToken(fila.ID);
      if (token) {
        nodo = idx.porToken.get(`${fila.ID}`.trim().toLowerCase());
      }
      if (!nodo && token) {
        informe.conflictos.push({
          tipo: 'NO_EXISTE', hoja: nombreHoja, fila: numFila, producto: etiqueta,
          mensaje: `«${etiqueta}» ya no existe en esta sucursal (¿lo borraron?). La fila se salta.`,
        });
        continue;
      }
      if (!nodo) {
        // Sin token: respaldo por nombre. Es una CONJETURA y se dice.
        const candidatos = idx.porNombre.get(NORM(fila.Producto)) || [];
        if (candidatos.length === 0) {
          informe.conflictos.push({
            tipo: 'SIN_COINCIDENCIA', hoja: nombreHoja, fila: numFila, producto: etiqueta,
            mensaje: `No hay ningún producto llamado «${fila.Producto}» en esta sucursal. La fila se salta.`,
          });
          continue;
        }
        if (candidatos.length > 1) {
          informe.conflictos.push({
            tipo: 'AMBIGUO', hoja: nombreHoja, fila: numFila, producto: etiqueta,
            mensaje: `Hay ${candidatos.length} productos llamados «${fila.Producto}» en esta sucursal. `
              + 'No se puede saber cuál es: la fila se salta.',
          });
          continue;
        }
        nodo = candidatos[0];
        informe.avisos.push({
          tipo: 'SIN_ID', hoja: nombreHoja, fila: numFila, producto: etiqueta,
          mensaje: `«${etiqueta}» no traía ID y se emparejó por nombre.`,
        });
      }

      // La misma fila dos veces deja el resultado dependiendo del orden.
      const clave = `${sucursalId}:${nodo.token}`;
      if (yaVistos.has(clave)) {
        informe.conflictos.push({
          tipo: 'FILA_REPETIDA', hoja: nombreHoja, fila: numFila, producto: etiqueta,
          mensaje: `«${etiqueta}» aparece más de una vez en la hoja. Solo se aplica la primera.`,
        });
        continue;
      }
      yaVistos.add(clave);

      // ── Qué precios quedan ───────────────────────────────────────────────
      const precios = {};
      let ilegible = false;
      for (const l of listas) {
        const col = columnaDe.get(l.id);
        if (col === undefined) {
          // Columna ausente: se conserva lo que ya estaba, no se borra.
          const actual = nodo.precios?.[l.id];
          if (Number.isFinite(Number(actual)) && Number(actual) > 0) precios[l.id] = Number(actual);
          continue;
        }
        const v = leerPrecio(fila[col]);
        if (v === undefined) {
          informe.conflictos.push({
            tipo: 'PRECIO_INVALIDO', hoja: nombreHoja, fila: numFila, producto: etiqueta,
            mensaje: `«${fila[col]}» no es un precio válido en la columna «${l.nombre}». La fila se salta.`,
          });
          ilegible = true;
          break;
        }
        if (v !== null) precios[l.id] = v;
      }
      if (ilegible) continue;

      const nuevo    = Object.keys(precios).length ? precios : null;
      const anterior = nodo.precios || null;
      if (canonico(nuevo) === canonico(anterior)) {
        informe.sin_cambio++;
        continue;
      }

      informe.con_cambio++;
      resumen.cambios++;
      escrituras.push({ sucursalId, nivel: nodo.nivel, id: nodo.id, precios: nuevo });

      // Quitarle TODOS los precios a un producto lo devuelve a su precio de
      // siempre. Es legítimo, pero es lo que más sorprende al ver el resultado,
      // así que se dice antes.
      if (nuevo === null && anterior !== null) {
        informe.avisos.push({
          tipo: 'SE_QUEDA_SIN_PRECIOS', hoja: nombreHoja, fila: numFila, producto: etiqueta,
          mensaje: `«${etiqueta}» se queda sin precios de lista y volverá a su precio normal.`,
        });
      }
    }

    informe.hojas.push(resumen);
  }

  if (informe.hojas.length === 0) {
    informe.conflictos.push({
      tipo: 'SIN_HOJAS',
      mensaje: 'El archivo no tiene ninguna hoja que corresponda a una sucursal tuya.',
    });
  }

  return { informe, escrituras };
}

module.exports = { resolverLibro, leerPrecio, leerToken, canonico, NORM };
