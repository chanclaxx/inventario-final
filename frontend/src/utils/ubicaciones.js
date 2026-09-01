import {
  Warehouse, Rows3, Store, Box, Archive, Route, LayoutGrid, MapPin,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers compartidos de ubicaciones.
//
// Viven fuera de las pantallas porque la lista y el mapa (fase 2) necesitan lo
// mismo: el icono de un tipo, el árbol aplanado y los descendientes de un nodo.
// Duplicarlos dejaría a uno de los dos mintiendo tras el primer arreglo, que es
// exactamente lo que pasó con las dos listas de módulos.
// ─────────────────────────────────────────────────────────────────────────────

// El `tipo` es una ETIQUETA VISUAL, nunca comportamiento — así lo define la
// migración. Por eso esta lista vive en el frontend y agregarle "nevera" no
// toca el backend ni la base: solo cambia el icono que se dibuja.
export const TIPOS_UBICACION = [
  { id: 'bodega',    label: 'Bodega',    Icn: Warehouse  },
  { id: 'estante',   label: 'Estante',   Icn: Rows3      },
  { id: 'vitrina',   label: 'Vitrina',   Icn: Store      },
  { id: 'cajon',     label: 'Cajón',     Icn: Archive    },
  { id: 'caja',      label: 'Caja',      Icn: Box        },
  { id: 'pasillo',   label: 'Pasillo',   Icn: Route      },
  { id: 'zona',      label: 'Zona',      Icn: LayoutGrid },
];

/**
 * Mismo catálogo indexado por id.
 *
 * Se usa SIEMPRE al pintar —`ICONOS_UBICACION[tipo] ?? ICONO_POR_DEFECTO`— en
 * vez de una función que devuelva el componente: para el linter, una llamada
 * durante el render puede estar creando un componente nuevo en cada pasada
 * (`react-hooks/static-components`), mientras que un acceso a propiedad se ve
 * estable. Es el mismo patrón que ya usa la barra de pestañas del inventario.
 */
export const ICONOS_UBICACION = Object.fromEntries(
  TIPOS_UBICACION.map((t) => [t.id, t.Icn])
);

export const ICONO_POR_DEFECTO = MapPin;

export const etiquetaDeTipo = (tipo) =>
  TIPOS_UBICACION.find((t) => t.id === tipo)?.label ?? null;

// Paleta corta a propósito. Un selector de color libre sobre un mapa produce
// bodegas de catorce colores que no dicen nada; siete tonos distinguibles entre
// sí bastan para agrupar zonas de un vistazo.
// El `hex` existe porque el mapa se dibuja en SVG y `fill` no entiende clases
// de Tailwind. Son los mismos tonos 500 que las clases de al lado: si se
// separan, la misma ubicación sale de un color en la lista y de otro en el mapa.
export const COLORES_UBICACION = [
  { id: 'slate',  clase: 'bg-slate-500',   anillo: 'ring-slate-500',   hex: '#64748b' },
  { id: 'blue',   clase: 'bg-blue-500',    anillo: 'ring-blue-500',    hex: '#3b82f6' },
  { id: 'teal',   clase: 'bg-teal-500',    anillo: 'ring-teal-500',    hex: '#14b8a6' },
  { id: 'green',  clase: 'bg-green-500',   anillo: 'ring-green-500',   hex: '#22c55e' },
  { id: 'amber',  clase: 'bg-amber-500',   anillo: 'ring-amber-500',   hex: '#f59e0b' },
  { id: 'rose',   clase: 'bg-rose-500',    anillo: 'ring-rose-500',    hex: '#f43f5e' },
  { id: 'violet', clase: 'bg-violet-500',  anillo: 'ring-violet-500',  hex: '#8b5cf6' },
];

export const claseColor = (color) =>
  COLORES_UBICACION.find((c) => c.id === color)?.clase ?? 'bg-gray-300';

export const colorHex = (color) =>
  COLORES_UBICACION.find((c) => c.id === color)?.hex ?? '#94a3b8';

/**
 * Árbol → lista plana con `profundidad`, en el orden en que se ve en pantalla.
 * Alimenta los desplegables (padre, destino del movimiento), donde una lista
 * indentada se lee mejor que un árbol desplegable dentro de un `<select>`.
 */
export const aplanarArbol = (nodos, profundidad = 0) =>
  (nodos ?? []).flatMap((n) => [
    { ...n, profundidad },
    ...aplanarArbol(n.hijas, profundidad + 1),
  ]);

/**
 * Ids de un nodo y todo lo que cuelga de él.
 *
 * Sirve para no ofrecer como "padre" una ubicación que está DENTRO de la que se
 * está editando: mover "Bodega A" dentro de su propio "Estante 1" deja un ciclo
 * y cualquier recorrido del árbol se cuelga. El backend lo rechaza igual —esta
 * es la mitad amable, que evita ofrecer una opción que va a fallar.
 */
export const ramaDe = (nodos, id) => {
  const encontrado = [];
  const recorrer = (lista, dentro) => {
    for (const n of lista ?? []) {
      const aqui = dentro || Number(n.id) === Number(id);
      if (aqui) encontrado.push(Number(n.id));
      recorrer(n.hijas, aqui);
    }
  };
  recorrer(nodos, false);
  return new Set(encontrado);
};

/**
 * Cadena de ancestros hasta un nodo, la raíz primero: [Bodega A, Estante 1, Nivel 2].
 *
 * Se calcula sobre el árbol que ya está en memoria en vez de pedirlo al
 * servidor: las migas de pan cambian en cada clic y no vale un viaje. El
 * backend también las devuelve en `GET /ubicaciones/:id`, para quien entre por
 * enlace directo.
 */
export const rutaDe = (nodos, id) => {
  const buscar = (lista, camino) => {
    for (const n of lista ?? []) {
      const aqui = [...camino, n];
      if (Number(n.id) === Number(id)) return aqui;
      const dentro = buscar(n.hijas, aqui);
      if (dentro) return dentro;
    }
    return null;
  };
  return buscar(nodos, []) ?? [];
};

/**
 * Etiqueta de un nodo del inventario dentro de una ubicación.
 * "Correa deportiva" · "Talla: 38MM · Color: Negro" · "IMEI 3331…"
 */
export const NIVELES = {
  producto:   { label: 'Producto',   clase: 'bg-gray-100 text-gray-600'    },
  atributo:   { label: 'Atributo',   clase: 'bg-indigo-50 text-indigo-600' },
  variante:   { label: 'Variante',   clase: 'bg-violet-50 text-violet-600' },
  referencia: { label: 'Referencia', clase: 'bg-sky-50 text-sky-600'       },
  unidad:     { label: 'IMEI',       clase: 'bg-emerald-50 text-emerald-700' },
};

// Estados de inventario. `parcial` no es un estado del producto sino de la
// UBICACIÓN: parte de sus ramas o de sus unidades está en otro sitio, y la
// pantalla tiene que poder decirlo en vez de mentir con el total.
export const ESTADOS = {
  ok:         { label: 'En stock',  clase: 'bg-green-50 text-green-700'   },
  bajo:       { label: 'Stock bajo', clase: 'bg-amber-50 text-amber-700'  },
  agotado:    { label: 'Agotado',   clase: 'bg-gray-100 text-gray-500'    },
  disponible: { label: 'Disponible', clase: 'bg-green-50 text-green-700'  },
  vendido:    { label: 'Vendido',   clase: 'bg-gray-100 text-gray-500'    },
  prestado:   { label: 'Prestado',  clase: 'bg-blue-50 text-blue-700'     },
};

// ── Geometría del mapa ───────────────────────────────────────────────────────
//
// El lienzo es cuadrado y va de 0 a 1000 en los dos ejes, y cada ubicación es
// el lienzo de sus hijas: entrar en una resetea el sistema de coordenadas. Son
// unidades RELATIVAS, nunca píxeles — la misma bodega se ve en un celular de
// 360px y en un monitor, y guardar píxeles ataría el mapa al aparato donde
// alguien lo dibujó.

export const MUNDO = 1000;

/** Rejilla del editor. Alinear a mano rectángulos de una bodega es trabajo tonto. */
export const REJILLA = 25;

const tieneGeometria = (n) =>
  [n.pos_x, n.pos_y, n.ancho, n.alto].every((v) => v !== null && v !== undefined);

/**
 * Coloca las ubicaciones de un nivel sobre el lienzo.
 *
 * Las que ya tienen geometría se respetan tal cual; **las que no, se acomodan
 * solas en cuadrícula**. Que el mapa sea opcional es lo que permite empezar a
 * usar ubicaciones hoy y dibujarlo el mes que viene: nadie arranca frente a un
 * lienzo en blanco, y una ubicación recién creada aparece en el mapa sin que
 * nadie la coloque.
 *
 * Las automáticas NO pisan a las dibujadas: se salta cualquier casilla cuyo
 * centro caiga dentro de un rectángulo ya colocado.
 */
export const disponerEnLienzo = (nodos = []) => {
  const colocados = nodos.filter(tieneGeometria).map((n) => ({
    ...n,
    x: Number(n.pos_x), y: Number(n.pos_y),
    w: Number(n.ancho), h: Number(n.alto),
    auto: false,
  }));

  const libres = nodos.filter((n) => !tieneGeometria(n));
  if (!libres.length) return colocados;

  // Cuadrícula holgada: con pocas ubicaciones, cajas grandes y legibles.
  const columnas = Math.min(5, Math.max(2, Math.ceil(Math.sqrt(nodos.length))));
  const lado     = MUNDO / columnas;
  const margen   = lado * 0.08;

  const dentroDeAlguno = (cx, cy) => colocados.some(
    (c) => cx >= c.x && cx <= c.x + c.w && cy >= c.y && cy <= c.y + c.h
  );

  const auto = [];
  let indice = 0;

  // Se recorren filas hasta acomodar a todos; si el lienzo se llena, se sigue
  // hacia abajo — un mapa largo se hace scroll, uno con cajas encimadas no se
  // arregla solo.
  for (let fila = 0; auto.length < libres.length && fila < 40; fila += 1) {
    for (let col = 0; col < columnas && auto.length < libres.length; col += 1) {
      const x = col * lado + margen;
      const y = fila * lado + margen;
      const w = lado - margen * 2;
      const h = lado - margen * 2;
      if (dentroDeAlguno(x + w / 2, y + h / 2)) continue;
      auto.push({ ...libres[indice], x, y, w, h, auto: true });
      indice += 1;
    }
  }

  return [...colocados, ...auto];
};

/** Ajusta un valor a la rejilla del editor, sin salirse del lienzo. */
export const aRejilla = (valor, minimo = 0, maximo = MUNDO) =>
  Math.min(maximo, Math.max(minimo, Math.round(valor / REJILLA) * REJILLA));

// ── La cámara ────────────────────────────────────────────────────────────────
//
// Vive aquí y no en el componente porque es aritmética pura, y un signo al revés
// no se ve leyendo el código: se ve como "la animación hace algo raro" cuando ya
// está en producción. Separada, se comprueba con números.

const MARGEN_ENCUADRE = 40;

/**
 * Qué trozo del lienzo se muestra.
 *
 * Mirando, se ajusta al CONTENIDO: con tres ubicaciones dibujadas en una
 * esquina, un lienzo fijo de 1000×1000 dejaría el mapa diminuto en mitad de una
 * pantalla vacía.
 *
 * EDITANDO se muestra el lienzo entero: si el encuadre siguiera al contenido,
 * mover una caja movería los límites y con ellos todo lo demás — el mapa se
 * escaparía debajo del dedo justo mientras se intenta acomodarlo.
 */
export const encuadreDe = (nodos = [], editando = false) => {
  if (editando || !nodos.length) return { x: 0, y: 0, w: MUNDO, h: MUNDO };

  const x1 = Math.min(...nodos.map((n) => n.x));
  const y1 = Math.min(...nodos.map((n) => n.y));
  const x2 = Math.max(...nodos.map((n) => n.x + n.w));
  const y2 = Math.max(...nodos.map((n) => n.y + n.h));

  return {
    x: x1 - MARGEN_ENCUADRE,
    y: y1 - MARGEN_ENCUADRE,
    w: Math.max(x2 - x1 + MARGEN_ENCUADRE * 2, 1),
    h: Math.max(y2 - y1 + MARGEN_ENCUADRE * 2, 1),
  };
};

/**
 * Cámara que lleva un rectángulo a llenar la vista.
 *
 * Se escala por el lado que primero se queda sin sitio (`min`, no `max`): con
 * `max` una caja alargada se saldría por los lados en vez de entrar completa.
 */
export const camaraHacia = (rect, vista) => ({
  escala: Math.min(vista.w / rect.w, vista.h / rect.h),
  cx:  rect.x + rect.w / 2,
  cy:  rect.y + rect.h / 2,
  vcx: vista.x + vista.w / 2,
  vcy: vista.y + vista.h / 2,
});

/** La misma cámara como `transform` de CSS. En SVG, `px` son unidades del lienzo. */
export const transformCamara = (c) =>
  `translate(${c.vcx}px, ${c.vcy}px) scale(${c.escala}) translate(${-c.cx}px, ${-c.cy}px)`;

/** Dónde acaba un punto del lienzo tras aplicar la cámara. Para poder probarla. */
export const aplicarCamara = (c, p) => ({
  x: (p.x - c.cx) * c.escala + c.vcx,
  y: (p.y - c.cy) * c.escala + c.vcy,
});

/** Clave estable de un nodo, para selección múltiple y para React. */
export const claveNodo = (item) => `${item.nivel}:${item.nodo_id}`;

/**
 * Tope de filas que se piden por lista. Es el máximo que acepta el backend.
 *
 * Vive aquí y no en cada pantalla porque la pestaña y el panel COMPARTEN la
 * queryKey de "sin ubicar" (para que el contador no cueste una petición extra),
 * y si pidieran límites distintos el resultado dependería de cuál se montara
 * primero — el contador diría 200 o 500 según el día.
 */
export const TOPE_LISTA = 500;

// ── Ruta de recogida ─────────────────────────────────────────────────────────
//
// Una lista de productos (el carrito de una venta, un préstamo, un traslado)
// ordenada según el recorrido físico de la bodega, para cruzarla UNA vez en vez
// de una por producto. En una bodega grande esa es la diferencia entre diez
// minutos y media hora.

/**
 * Traducción de una línea del carrito al nodo del árbol de ubicaciones.
 *
 * Es un contrato que cruza módulos: el carrito lo llenan nueve pantallas
 * distintas y ninguna sabe nada de ubicaciones. Vive aquí, en un solo sitio,
 * para que arreglarlo no deje a ocho mintiendo.
 *
 * Se baja al nodo MÁS ESPECÍFICO que traiga la línea: si el carrito dice qué
 * talla se vende, la ruta lleva al cajón de esa talla y no al del producto.
 */
export const nodoDeItemCarrito = (item) => {
  if (!item) return null;
  if (item.tipo === 'serial') {
    return item.serial_id ? { nivel: 'unidad', id: Number(item.serial_id) } : null;
  }
  if (item.variante_id) return { nivel: 'variante', id: Number(item.variante_id) };
  if (item.atributo_id) return { nivel: 'atributo', id: Number(item.atributo_id) };
  if (item.producto_id) return { nivel: 'producto', id: Number(item.producto_id) };
  return null;
};

const _todasDibujadas = (nodos) =>
  nodos.length > 0 && nodos.every((n) => n.pos_x !== null && n.pos_x !== undefined
                                      && n.pos_y !== null && n.pos_y !== undefined);

/**
 * Ids de las ubicaciones en orden de CAMINATA, recorriendo el árbol en
 * profundidad: se termina una bodega antes de pasar a la siguiente, que es como
 * se camina de verdad.
 *
 * Dentro de un nivel manda la geometría —arriba-abajo, izquierda-derecha— pero
 * SOLO si están dibujadas TODAS: con la mitad colocada a mano y la mitad
 * automática, el orden por posición sería un zigzag sin sentido. Si falta
 * alguna, se respeta el orden del árbol (`orden` y luego nombre), que el admin
 * puede ajustar y que al menos es predecible.
 */
export const ordenRecorrido = (arbol = []) => {
  const ids = [];

  const recorrer = (nodos) => {
    const lista = _todasDibujadas(nodos)
      ? [...nodos].sort((a, b) => (Number(a.pos_y) - Number(b.pos_y))
                               || (Number(a.pos_x) - Number(b.pos_x)))
      : nodos;

    for (const n of lista) {
      ids.push(Number(n.id));
      recorrer(n.hijas ?? []);
    }
  };

  recorrer(arbol);
  return ids;
};

/**
 * Agrupa las líneas por ubicación y devuelve las paradas en orden de recorrido.
 *
 * Lo que NO tiene sitio va al final, en su propia parada: es lo que hay que
 * buscar a ojo, y enterrarlo entre las demás haría perder justo lo que más
 * tiempo cuesta.
 */
export const agruparPorRuta = (lineas = [], arbol = []) => {
  const orden = ordenRecorrido(arbol);
  const grupos = new Map();

  for (const linea of lineas) {
    const clave = linea.ubicacion_id ? Number(linea.ubicacion_id) : null;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(linea);
  }

  const paradas = [];
  for (const id of orden) {
    if (grupos.has(id)) {
      paradas.push({
        ubicacion_id: id,
        ruta: rutaDe(arbol, id).map((r) => r.nombre),
        items: grupos.get(id),
      });
      grupos.delete(id);
    }
  }

  // Una ubicación que ya no está en el árbol (dada de baja entre que se armó el
  // carrito y se pidió la ruta) no puede desaparecer con sus productos dentro.
  for (const [id, items] of grupos) {
    if (id !== null) paradas.push({ ubicacion_id: id, ruta: [], items });
  }
  if (grupos.has(null)) {
    paradas.push({ ubicacion_id: null, ruta: [], items: grupos.get(null) });
  }

  return paradas;
};
