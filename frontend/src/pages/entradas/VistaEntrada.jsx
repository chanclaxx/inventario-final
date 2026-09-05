import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PackagePlus, ChevronLeft, ChevronRight, Trash2, Check, AlertTriangle,
  Layers, Replace, Plus,
} from 'lucide-react';
import { registrarEntrada } from '../../api/entradas.api';
import { getProductosCantidad, getProductosSerial } from '../../api/productos.api';
import { getArbol } from '../../api/variantesProductoApi';
import api from '../../api/axios.config';
import { SearchInput } from '../../components/ui/SearchInput';
import { Button }      from '../../components/ui/Button';
import { Input }       from '../../components/ui/Input';
import { Spinner }     from '../../components/ui/Spinner';
import { Badge }       from '../../components/ui/Badge';
import { EmptyState }  from '../../components/ui/EmptyState';
import { useSucursalKey } from '../../hooks/useSucursalKey';
import { FilaImeiCompra, MultiSelectorCompra } from '../proveedores/capturaMercancia';
import {
  extraerImei, extraerColor, extraerCaracteristicas,
  parsearColoresConfig, parsearCaracteristicasConfig,
  itemSerialVacio, hojasDelArbol,
} from '../proveedores/capturaMercancia.utils';

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRAR UNA ENTRADA — la única pantalla de trabajo del bodeguero
//
// No hay una sola cifra de dinero. Él cuenta lo que llegó; administración le
// pone la plata después, contra la factura.
//
// ── Se REUSA la captura de mercancía que ya existe ──────────────────────────
// `FilaImeiCompra` y `MultiSelectorCompra` son los mismos componentes que usan
// ModalCompra (compra suelta) y ModalRecibir (recepción contra orden). Escribir
// una captura propia para bodega habría dejado a una de las tres mintiendo tras
// el primer arreglo — es el error que este repositorio ya cometió con el código
// escaneable y con las remisiones por variante.
//
// ── Qué se captura y por qué ────────────────────────────────────────────────
// · Serial → un IMEI por unidad, con su COLOR y sus CARACTERÍSTICAS si el
//   negocio los activó. Dos equipos del mismo modelo no son intercambiables:
//   sin esto, el que llegó negro y el que llegó azul entran idénticos y nadie
//   sabe después cuál es cuál.
// · Cantidad con variantes → hay que decir QUÉ variante llegó. El stock se
//   mueve en la HOJA (variante > atributo > producto) y el producto se
//   recalcula; escribirlo arriba descuadra el árbol entero. "Llegaron 5
//   brasieres" no es una entrada válida si el negocio vende por tallas.
//
// ── Cuando el pedido dijo QUÉ variante ──────────────────────────────────────
// Si la orden bajó al nodo, la línea llega precargada con esa variante y ya no
// hay nada que repartir: la pregunta se reduce a "¿llegó eso, y cuánto?".
//
// Y los dos desenlaces raros dejan de ser callejones sin salida:
//
//   · LLEGÓ OTRA → se elige la que de verdad llegó. La línea sigue respondiendo
//     al mismo pedido y queda anotada como novedad del proveedor.
//   · LLEGARON DE MÁS → se marca que se reciben. Antes esta pantalla prometía
//     que el sobrante "queda anotado en la entrada" y el backend respondía 400:
//     el bodeguero veía un mensaje tranquilizador y después un error.
//   · LLEGÓ UNA QUE NO PEDISTE → se pidieron 50 blancos y 50 verdes, y además
//     llegaron 20 rosados. No es sustitución (nadie dejó de mandar lo pedido) ni
//     exceso de una línea (no hay línea de rosado): es mercancía adicional, y
//     entra en LA MISMA entrada como una línea suelta, sin `orden_linea_id`.
//     Queda como novedad del proveedor.
//
// El selector de "otra variante" siempre excluye los nodos que YA están en la
// entrada: dos líneas del mismo nodo se sumarían al recibir y nadie sabría por
// qué el inventario subió el doble.
// ─────────────────────────────────────────────────────────────────────────────

const norm = (r) => (Array.isArray(r) ? r : (Array.isArray(r?.items) ? r.items : []));

// El nodo que pidió la orden, ya rotulado. `getOrdenesParaRecibir` devuelve
// variante_id/atributo_id desde 20260806; lo que faltaba era que alguien los
// escribiera al crear la orden y que esta pantalla los leyera.
const nodoPedido = (l) => {
  if (l.variante_id) return { key: `v-${l.variante_id}`, variante_id: l.variante_id, atributo_id: null, label: l.variante_valor };
  if (l.atributo_id) return { key: `a-${l.atributo_id}`, variante_id: null, atributo_id: l.atributo_id, label: l.atributo_valor };
  return null;
};

// Tope de campos de IMEI por línea. No es una regla de negocio: cada unidad
// pinta un input, y un dedazo en el campo de cantidad congelaría la pantalla.
const MAX_IMEI = 200;

// ── Una línea de la entrada ─────────────────────────────────────────────────
function FilaLinea({
  linea, sucursalId, onCambiar, onQuitar, onAgregarExtra, nodosUsados,
  variantesActivo, coloresActivo, coloresConfig, caracteristicasActivo, caracteristicasLista,
}) {
  const esSerial  = linea.tipo === 'serial';
  const pedida    = linea.pedida ?? null;

  // El árbol solo se pide para productos por cantidad y con la feature activa.
  const { data: arbol = [], isLoading: cargandoArbol } = useQuery({
    queryKey: ['arbol-producto', linea.producto_id, sucursalId],
    queryFn:  () => getArbol(linea.producto_id, sucursalId).then((r) => r.data.data),
    enabled:  !esSerial && variantesActivo && !!sucursalId,
    staleTime: 30_000,
  });

  const hojas      = useMemo(() => hojasDelArbol(arbol), [arbol]);
  const tieneArbol = hojas.length > 0;

  // Unidades de la línea: con árbol es la suma de lo repartido por variante.
  // Con un nodo pedido no se reparte nada: ya se sabe QUE se pidio, asi que la
  // cantidad sale de una sola casilla igual que en un producto sin variantes.
  //
  // Una línea EXTRA (llegó sin estar en el pedido) también tiene su nodo fijo y
  // usa la misma casilla, pero no es un "pedido": no hay nada contra qué
  // compararla y no puede sustituir a nada.
  const pedido = linea.esExtra ? null : nodoPedido(linea);
  const nodoFijo = pedido || (linea.esExtra ? nodoPedido(linea) : null);

  const unidades = esSerial
    ? linea.items.filter((i) => extraerImei(i).trim()).length
    : (tieneArbol && !pedido)
      ? Object.values(linea.nodos || {}).reduce((n, d) => n + (Number(d?.cantidad) || 0), 0)
      : Number(linea.cantidad) || 0;

  const difiere = pedida != null && unidades !== pedida;
  const faltan  = pedida != null && unidades < pedida;
  const sobran  = pedida != null && unidades > pedida;

  // ── Cambiar la cantidad no puede borrar lo ya escrito ────────────────────
  // Antes la casilla reconstruía el arreglo con la longitud nueva, así que
  // corregir "12" por "1" —o simplemente vaciar el campo para volver a
  // escribir— se llevaba por delante todos los IMEI capturados. Ahora el texto
  // vive aparte (para poder quedar vacío mientras se escribe) y al reducir solo
  // se quitan las casillas VACÍAS del final: las que ya tienen un IMEI se
  // conservan y se avisa, porque borrar el trabajo de alguien no puede ser un
  // efecto secundario de teclear un número.
  const [textoCantidad, setTextoCantidad] = useState(String(linea.items.length));
  const [conservados,   setConservados]   = useState(0);

  const cambiarCantidad = (txt) => {
    setTextoCantidad(txt);
    if (txt.trim() === '') return;          // sigue escribiendo
    const n = Math.max(0, Math.min(MAX_IMEI, Number(txt) || 0));
    const vacio = () => itemSerialVacio(coloresActivo, caracteristicasActivo, caracteristicasLista);

    if (n >= linea.items.length) {
      setConservados(0);
      onCambiar(linea.key, {
        items: [...linea.items, ...Array.from({ length: n - linea.items.length }, vacio)],
      });
      return;
    }
    const quedan = linea.items.filter((it, i) => i < n || extraerImei(it).trim());
    setConservados(quedan.length - n);
    onCambiar(linea.key, { items: quedan });
  };

  return (
    <div className="border border-gray-100 rounded-xl p-3 flex flex-col gap-2.5 bg-white">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 break-words">{linea.nombre_producto}</p>
          {/* La variante que pidio la orden. Va en su propia linea y en morado
              porque es lo que hay que COMPARAR contra la caja: enterrarla entre
              los badges la volveria decorado. */}
          {pedido && (
            <p className="text-xs text-purple-600 mt-0.5 flex items-center gap-1">
              <Layers size={11} className="flex-shrink-0" />
              {linea.nodoSust
                ? <>llegó <span className="font-medium">{linea.nodoSust.label}</span>
                    <span className="text-purple-400">· pediste {pedido.label}</span></>
                : <>pediste <span className="font-medium">{pedido.label}</span></>}
            </p>
          )}
          {linea.esExtra && (
            <p className="text-xs text-amber-600 mt-0.5 flex items-center gap-1">
              <Layers size={11} className="flex-shrink-0" />
              <span className="font-medium">{nodoPedido(linea)?.label}</span>
              <span className="text-amber-500">· no venía en el pedido</span>
            </p>
          )}
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {pedida != null
              ? <span className="text-xs text-gray-400">Pedido: {pedida}</span>
              : <span className="text-xs text-gray-400">no venía en el pedido</span>}
            {esSerial && <Badge variant="blue">por IMEI</Badge>}
            {tieneArbol && !pedido && <Badge variant="purple">por variante</Badge>}
          </div>
        </div>
        <button
          onClick={() => onQuitar(linea.key)}
          title="Quitar de la entrada"
          className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
        >
          <Trash2 size={15} />
        </button>
      </div>

      {/* ── Serial: un IMEI por unidad ─────────────────────────────────── */}
      {esSerial && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs text-gray-500">¿Cuántos llegaron?</label>
            <input
              type="number" min="0" max={MAX_IMEI}
              value={textoCantidad}
              onChange={(e) => cambiarCantidad(e.target.value)}
              // Al salir, la casilla muestra la verdad: cuántas filas hay.
              onBlur={() => setTextoCantidad(String(linea.items.length))}
              className="w-20 px-2.5 py-1.5 bg-white border-2 border-green-500 rounded-lg
                text-sm font-semibold text-gray-800 text-center tabular-nums
                focus:outline-none focus:ring-2 focus:ring-green-400"
            />
            <span className="text-xs text-gray-400">{unidades} con IMEI</span>
            {conservados > 0 && (
              <span className="text-xs text-amber-600">
                se conservaron {conservados} que ya tenían IMEI — bórralos con la papelera
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1 max-h-56 overflow-y-auto pr-1">
            {linea.items.map((item, i) => (
              <FilaImeiCompra
                key={i}
                index={i}
                item={item}
                coloresActivo={coloresActivo}
                coloresConfig={coloresConfig}
                caracteristicasActivo={caracteristicasActivo}
                caracteristicasLista={caracteristicasLista}
                onChange={(v) => {
                  const items = [...linea.items];
                  items[i] = v;
                  onCambiar(linea.key, { items });
                }}
                onEliminar={() => onCambiar(linea.key, {
                  items: linea.items.filter((_, j) => j !== i),
                })}
                mostrarEliminar={linea.items.length > 1}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Cantidad con variantes: hay que decir cuál llegó ───────────── */}
      {!esSerial && variantesActivo && cargandoArbol && <Spinner className="py-3 scale-75" />}
      {!esSerial && tieneArbol && !nodoFijo && !cargandoArbol && (
        <MultiSelectorCompra
          hojas={hojas}
          nodosData={linea.nodos || {}}
          mostrarCosto={false}
          onActualizar={(key, datos) => onCambiar(linea.key, {
            nodos: { ...(linea.nodos || {}), [key]: datos },
          })}
        />
      )}

      {/* ── Una sola casilla: sin variantes, o con la variante ya pedida ─ */}
      {!esSerial && (!tieneArbol || nodoFijo) && !cargandoArbol && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Llegó</label>
          <input
            type="number" min="0"
            value={linea.cantidad}
            onChange={(e) => onCambiar(linea.key, { cantidad: Math.max(0, Number(e.target.value) || 0) })}
            className="w-20 px-2.5 py-1.5 bg-white border-2 border-green-500 rounded-lg
              text-sm font-semibold text-gray-800 text-center tabular-nums
              focus:outline-none focus:ring-2 focus:ring-green-400"
          />
        </div>
      )}

      {/* ── Llegó otra variante ────────────────────────────────────────── */}
      {pedido && tieneArbol && !cargandoArbol && (
        <div className="flex flex-col gap-1.5">
          {!linea.eligiendoNodo && !linea.agregandoExtra ? (
            <div className="flex items-center gap-3 flex-wrap">
              <button type="button"
                onClick={() => onCambiar(linea.key, { eligiendoNodo: true })}
                className="flex items-center gap-1.5 text-xs font-medium text-purple-600
                           hover:text-purple-700 transition-colors w-fit">
                <Replace size={12} /> {linea.nodoSust ? 'Cambiar la que llegó' : 'Llegó otra variante'}
              </button>
              {/* Lo que llegó ADEMÁS de lo pedido. Va aquí, junto a su producto,
                  y no en el buscador de arriba: el bodeguero está mirando la
                  caja de los audífonos, no buscando un producto nuevo. */}
              <button type="button"
                onClick={() => onCambiar(linea.key, { agregandoExtra: true })}
                className="flex items-center gap-1.5 text-xs font-medium text-amber-600
                           hover:text-amber-700 transition-colors w-fit">
                <Plus size={12} /> Llegó otra que no pediste
              </button>
            </div>
          ) : linea.agregandoExtra ? (
            <div className="border border-amber-200 bg-amber-50/40 rounded-lg p-2 flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-amber-800">¿Cuál llegó de más?</p>
                <button type="button" onClick={() => onCambiar(linea.key, { agregandoExtra: false })}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                  cancelar
                </button>
              </div>
              <div className="max-h-36 overflow-y-auto flex flex-col gap-0.5">
                {hojas.filter((h) => !nodosUsados.has(h.key)).length === 0 ? (
                  <p className="text-xs text-gray-400 py-1.5">
                    Todas las variantes de este producto ya están en la entrada.
                  </p>
                ) : hojas.filter((h) => !nodosUsados.has(h.key)).map((h) => (
                  <button key={h.key} type="button"
                    onClick={() => {
                      onAgregarExtra(linea, h);
                      onCambiar(linea.key, { agregandoExtra: false });
                    }}
                    className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md
                               text-left text-xs text-gray-700 hover:bg-white transition-colors">
                    <span className="truncate">
                      {h.labelPadre ? `${h.labelPadre} · ` : ''}{h.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="border border-purple-200 bg-purple-50/40 rounded-lg p-2 flex flex-col gap-1">
              <p className="text-xs text-purple-700">¿Cuál llegó de verdad?</p>
              <div className="max-h-36 overflow-y-auto flex flex-col gap-0.5">
                {hojas.map((h) => {
                  const esPedida = h.key === pedido.key;
                  return (
                    <button key={h.key} type="button"
                      onClick={() => onCambiar(linea.key, {
                        nodoSust: esPedida ? null : h, eligiendoNodo: false,
                      })}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md
                                 text-left text-xs text-gray-700 hover:bg-white transition-colors">
                      <span className="truncate">
                        {h.labelPadre ? `${h.labelPadre} · ` : ''}{h.label}
                      </span>
                      {esPedida && <span className="text-gray-400 flex-shrink-0">la que pediste</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── El faltante se registra solo; el SOBRANTE hay que aceptarlo ──
          Antes esta pantalla decía que el sobrante "queda anotado en la entrada"
          y el backend respondía 400 mandando a "recibirlas como compra aparte":
          el bodeguero leía un mensaje tranquilizador y después un error. */}
      {difiere && faltan && (
        <p className="text-xs font-medium text-amber-600">
          faltan {pedida - unidades}
          <span className="text-gray-400 font-normal"> · queda pendiente en el pedido</span>
        </p>
      )}
      {sobran && (
        <label className="flex items-start gap-2 bg-purple-50 rounded-lg px-2.5 py-2 cursor-pointer">
          <input type="checkbox" checked={Boolean(linea.excedenteOk)}
            onChange={(e) => onCambiar(linea.key, { excedenteOk: e.target.checked })}
            className="w-4 h-4 mt-0.5 rounded accent-purple-600 flex-shrink-0" />
          <span className="text-xs text-purple-800">
            Llegaron {unidades - pedida} de más. Me quedo con ellas.
            <span className="block text-purple-600 mt-0.5">
              Si se las vas a devolver, baja el número a {pedida}.
            </span>
          </span>
        </label>
      )}
    </div>
  );
}

// ── La vista ────────────────────────────────────────────────────────────────
export function VistaEntrada({ orden, onVolver, onListo }) {
  const queryClient = useQueryClient();
  const { sucursalKey, sucursalLista } = useSucursalKey();
  const [busqueda, setBusqueda] = useState('');
  const [notas,    setNotas]    = useState('');
  const [error,    setError]    = useState('');

  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
    staleTime: 60_000,
  });
  const variantesActivo       = configData?.variantes_activo              === '1';
  const coloresActivo         = configData?.colores_serial_activo         === '1';
  const caracteristicasActivo = configData?.caracteristicas_serial_activo === '1';
  const coloresConfig         = parsearColoresConfig(configData);
  const caracteristicasLista  = parsearCaracteristicasConfig(configData);

  const { data: cantData } = useQuery({
    queryKey: ['productos-cantidad', ...sucursalKey],
    queryFn:  () => getProductosCantidad().then((r) => norm(r.data.data)),
    enabled:  sucursalLista,
  });
  const { data: serialData } = useQuery({
    queryKey: ['productos-serial', ...sucursalKey],
    queryFn:  () => getProductosSerial().then((r) => norm(r.data.data)),
    enabled:  sucursalLista,
  });

  const productos = norm(cantData);
  const sucursalId = productos[0]?.sucursal_id ?? norm(serialData)[0]?.sucursal_id ?? null;

  const nuevaLinea = (base) => ({
    variante_id: null, atributo_id: null, orden_linea_id: null, pedida: null,
    cantidad: 1, items: [], nodos: {},
    // La variante que de verdad llegó, cuando no es la pedida, y el sí explícito
    // al sobrante. Ninguna de las dos se guarda en la BD: sin el flag el backend
    // responde 409, así que el solo hecho de que la línea entre ya prueba que
    // alguien lo confirmó.
    nodoSust: null, eligiendoNodo: false, excedenteOk: false,
    // Llegó sin estar en el pedido. Es una marca EXPLÍCITA y no algo deducido de
    // "no tiene orden_linea_id": en una entrada sin pedido TODAS las líneas
    // carecen de él y ninguna es una novedad — es el mismo criterio por el que
    // `es_entrada` se marca en vez de deducirse de "sin proveedor".
    esExtra: false, agregandoExtra: false,
    ...base,
  });

  // Con orden, la lista arranca llena con lo que falta por llegar.
  const [lineas, setLineas] = useState(() => {
    if (!orden) return [];
    return (orden.lineas || [])
      .filter((l) => l.pendiente > 0 && l.producto_id)
      .map((l) => nuevaLinea({
        key:             `oc-${l.orden_linea_id}`,
        producto_id:     l.producto_id,
        nombre_producto: l.nombre,
        tipo:            l.tipo,
        orden_linea_id:  l.orden_linea_id,
        // El nodo que pidió la orden. Sin arrastrarlo, la línea llegaría
        // precargada al producto y el bodeguero tendría que volver a elegir la
        // variante que el pedido ya dijo.
        variante_id:     l.variante_id ?? null,
        atributo_id:     l.atributo_id ?? null,
        variante_valor:  l.variante_valor ?? null,
        atributo_valor:  l.atributo_valor ?? null,
        pedida:          l.pendiente,
        cantidad:        l.pendiente,
        // Un serial pedido arranca con sus casillas de IMEI listas.
        items: l.tipo === 'serial'
          ? Array.from({ length: Math.min(l.pendiente, MAX_IMEI) },
              () => itemSerialVacio(false, false, []))
          : [],
      }));
  });

  const catalogo = useMemo(() => ([
    ...norm(cantData).map((p)   => ({ id: p.id, nombre: p.nombre, tipo: 'cantidad', codigo: p.codigo })),
    ...norm(serialData).map((p) => ({ id: p.id, nombre: p.nombre, tipo: 'serial',   codigo: null })),
  ]), [cantData, serialData]);

  const resultados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (q.length < 2) return [];
    return catalogo
      .filter((p) => p.nombre.toLowerCase().includes(q) || (p.codigo || '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [busqueda, catalogo]);

  const agregar = (p) => {
    const key = `p-${p.tipo}-${p.id}`;
    setBusqueda('');
    setLineas((ls) => {
      if (ls.some((l) => l.key === key)) return ls;   // ya está: no se duplica
      return [...ls, nuevaLinea({
        key, producto_id: p.id, nombre_producto: p.nombre, tipo: p.tipo,
        items: p.tipo === 'serial'
          ? [itemSerialVacio(coloresActivo, caracteristicasActivo, caracteristicasLista)]
          : [],
      })];
    });
  };

  // Los nodos que YA están en la entrada para un producto. El selector de "otra
  // que no pediste" los excluye: dos líneas del mismo nodo se sumarían al recibir
  // y nadie sabría después por qué el inventario subió el doble.
  //
  // Se calcula sobre `lineas` en cada render y no se memoiza: son unas pocas
  // decenas de filas y un caché aquí se quedaría viejo justo después de agregar
  // una, que es el único momento en que importa.
  const nodosUsadosDe = (productoId) => new Set(
    lineas
      .filter((l) => l.producto_id === productoId)
      .map((l) => (l.variante_id ? `v-${l.variante_id}`
        : l.atributo_id ? `a-${l.atributo_id}` : null))
      .filter(Boolean)
  );

  // ── Llegó una variante que no se pidió ────────────────────────────────────
  //
  // Línea NUEVA, sin `orden_linea_id`: no responde a ninguna línea del pedido y
  // por eso no puede consumir su pendiente. El backend la recibe igual y la
  // registra como novedad del proveedor.
  //
  // Se inserta JUSTO DEBAJO de la línea desde la que se agregó, no al final: son
  // el mismo producto y leerlas separadas por diez filas obliga a buscar.
  const agregarExtra = (origen, hoja) => {
    const key = `extra-${origen.producto_id}-${hoja.key}`;
    const etq = `${hoja.labelPadre ? `${hoja.labelPadre} · ` : ''}${hoja.label}`;
    setLineas((ls) => {
      if (ls.some((l) => l.key === key)) return ls;
      const nueva = nuevaLinea({
        key,
        producto_id:     origen.producto_id,
        nombre_producto: origen.nombre_producto,
        tipo:            origen.tipo,
        esExtra:         true,
        cantidad:        1,
        variante_id:     hoja.tipo === 'variante' ? hoja.id : null,
        atributo_id:     hoja.tipo === 'atributo' ? hoja.id : null,
        // Con el padre delante: en un arbol de tres niveles "38MM" a secas no
        // identifica nada — la 38MM negra y la 38MM cafe son dos nodos.
        variante_valor:  hoja.tipo === 'variante' ? etq : null,
        atributo_valor:  hoja.tipo === 'atributo' ? etq : null,
      });
      const i = ls.findIndex((l) => l.key === origen.key);
      return i < 0 ? [...ls, nueva] : [...ls.slice(0, i + 1), nueva, ...ls.slice(i + 1)];
    });
  };

  const cambiar = (key, parche) =>
    setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...parche } : l)));

  const quitar = (key) => setLineas((ls) => ls.filter((l) => l.key !== key));

  // ── El payload ────────────────────────────────────────────────────────────
  // Ni un precio ni un proveedor: los resuelve el backend a partir de la orden o
  // del último costo conocido del NODO. Si algún día aparece una cifra aquí, el
  // diseño se torció.
  const construirPayload = () => {
    const salida = [];
    for (const l of lineas) {
      const comun = {
        producto_id: l.producto_id,
        nombre_producto: l.nombre_producto,
        orden_linea_id: l.orden_linea_id,
        // `excedente_ok` solo viaja cuando se marcó. Mandarlo siempre en true
        // convertiría la casilla en decorado y el backend dejaría pasar en
        // silencio justo lo que se quiere que alguien mire.
        ...(l.excedenteOk ? { excedente_ok: true } : {}),
      };

      if (l.tipo === 'serial') {
        const conImei = l.items.filter((i) => extraerImei(i).trim());
        const vistos = new Set();
        for (const item of conImei) {
          const imei = extraerImei(item).trim();
          if (vistos.has(imei)) throw new Error(`El IMEI ${imei} está repetido en la entrada`);
          vistos.add(imei);
          const caract = extraerCaracteristicas(item);
          salida.push({
            ...comun,
            cantidad: 1,
            imei,
            color: extraerColor(item) || null,
            caracteristicas: Object.keys(caract).some((k) => caract[k]?.trim?.()) ? caract : null,
          });
        }
        if (l.items.length > 0 && conImei.length === 0) {
          throw new Error(`Escribe los IMEI de "${l.nombre_producto}"`);
        }
        continue;
      }

      // ── Nodo fijo: el que pidió la orden, o el de una línea extra ──────
      const nodo = nodoPedido(l);
      if (nodo) {
        const cant = Number(l.cantidad) || 0;
        if (cant > 0) {
          // Una línea EXTRA no sustituye a nada —no responde a ninguna línea del
          // pedido—, así que jamás manda `sustituye`. Mandarlo haría que el
          // backend la atribuyera a un pendiente que no le corresponde.
          const sust = l.esExtra ? null : (l.nodoSust || null);
          salida.push({
            ...comun,
            cantidad: cant,
            variante_id: sust ? (sust.tipo === 'variante' ? sust.id : null) : nodo.variante_id,
            atributo_id: sust ? (sust.tipo === 'atributo' ? sust.id : null) : nodo.atributo_id,
            ...(sust ? { sustituye: true } : {}),
          });
        }
        continue;
      }

      const nodos = Object.values(l.nodos || {}).filter((d) => Number(d?.cantidad) > 0);
      if (nodos.length > 0) {
        // Con variantes, el stock se mueve en la HOJA. El backend rechaza la
        // línea si el producto tiene variantes activas y no se dice cuál.
        for (const d of nodos) {
          salida.push({
            ...comun,
            cantidad: Number(d.cantidad),
            variante_id: d.tipo === 'variante' ? d.id : null,
            atributo_id: d.tipo === 'atributo' ? d.id : null,
          });
        }
        continue;
      }

      const cant = Number(l.cantidad) || 0;
      if (cant > 0) salida.push({ ...comun, cantidad: cant });
    }
    return salida;
  };

  const totalUnidades = (() => {
    try { return construirPayload().reduce((n, l) => n + l.cantidad, 0); }
    catch { return 0; }
  })();

  const mut = useMutation({
    mutationFn: () => {
      const payload = construirPayload();
      if (!payload.length) throw new Error('No hay nada que registrar');
      return registrarEntrada({
        lineas: payload,
        orden_compra_id: orden?.id || null,
        notas: notas.trim() || null,
      });
    },
    onSuccess: (res) => {
      for (const k of ['entradas', 'entradas-ordenes', 'productos-cantidad', 'productos-serial', 'arbol-producto']) {
        queryClient.invalidateQueries({ queryKey: [k], exact: false });
      }
      onListo(res.data?.message || 'Entrada registrada');
    },
    onError: (e) => setError(e.response?.data?.error || e.message || 'No se pudo registrar la entrada'),
  });

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={onVolver}
        className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-700 transition-colors w-fit"
      >
        <ChevronLeft size={14} /> Entradas
      </button>

      <div>
        <h1 className="text-xl font-bold text-gray-900">
          {orden ? `Recibir pedido OC-${String(orden.numero ?? orden.id).padStart(4, '0')}` : 'Entrada nueva'}
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Escribe o escanea lo que llegó y cuántas unidades.
        </p>
      </div>

      <SearchInput
        value={busqueda}
        onChange={setBusqueda}
        placeholder="Escanea el código o busca el producto..."
      />

      {resultados.length > 0 && (
        <div className="flex flex-col gap-1 border border-gray-100 rounded-xl p-1.5 bg-white">
          {resultados.map((p) => (
            <button
              key={`${p.tipo}-${p.id}`}
              onClick={() => agregar(p)}
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg
                text-left text-sm hover:bg-green-50 transition-colors"
            >
              <span className="text-gray-800">{p.nombre}</span>
              <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />
            </button>
          ))}
        </div>
      )}
      {busqueda.trim().length >= 2 && resultados.length === 0 && (
        <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50
          border border-amber-100 rounded-xl px-3 py-2.5">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            No hay ningún producto con ese nombre en el catálogo. Pídele a
            administración que lo cree y vuelve a intentarlo — desde bodega no se
            crean productos, para no acabar con dos versiones del mismo.
          </span>
        </div>
      )}

      {lineas.length === 0 ? (
        <EmptyState icon={PackagePlus}
          titulo="Nada todavía"
          descripcion="Busca arriba el primer producto que llegó." />
      ) : (
        <div className="flex flex-col gap-2">
          {lineas.map((l) => (
            <FilaLinea
              key={l.key}
              linea={l}
              sucursalId={sucursalId}
              onCambiar={cambiar}
              onQuitar={quitar}
              onAgregarExtra={agregarExtra}
              nodosUsados={nodosUsadosDe(l.producto_id)}
              variantesActivo={variantesActivo}
              coloresActivo={coloresActivo}
              coloresConfig={coloresConfig}
              caracteristicasActivo={caracteristicasActivo}
              caracteristicasLista={caracteristicasLista}
            />
          ))}
        </div>
      )}

      <Input
        label="Nota (opcional)"
        placeholder="Ej: la caja 2 llegó abierta"
        value={notas}
        onChange={(e) => setNotas(e.target.value)}
      />

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
        <span className="text-sm text-gray-500 tabular-nums">
          {totalUnidades} unidad(es) · {lineas.length} producto(s)
        </span>
        <Button
          loading={mut.isPending}
          disabled={totalUnidades === 0}
          onClick={() => { setError(''); mut.mutate(); }}
        >
          <Check size={15} /> Registrar entrada
        </Button>
      </div>
    </div>
  );
}

export default VistaEntrada;
