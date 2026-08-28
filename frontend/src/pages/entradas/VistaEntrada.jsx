import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PackagePlus, ChevronLeft, ChevronRight, Trash2, Check, AlertTriangle } from 'lucide-react';
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
// ─────────────────────────────────────────────────────────────────────────────

const norm = (r) => (Array.isArray(r) ? r : (Array.isArray(r?.items) ? r.items : []));

// Tope de campos de IMEI por línea. No es una regla de negocio: cada unidad
// pinta un input, y un dedazo en el campo de cantidad congelaría la pantalla.
const MAX_IMEI = 200;

// ── Una línea de la entrada ─────────────────────────────────────────────────
function FilaLinea({
  linea, sucursalId, onCambiar, onQuitar,
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
  const unidades = esSerial
    ? linea.items.filter((i) => extraerImei(i).trim()).length
    : tieneArbol
      ? Object.values(linea.nodos || {}).reduce((n, d) => n + (Number(d?.cantidad) || 0), 0)
      : Number(linea.cantidad) || 0;

  const difiere = pedida != null && unidades !== pedida;
  const faltan  = pedida != null && unidades < pedida;

  return (
    <div className="border border-gray-100 rounded-xl p-3 flex flex-col gap-2.5 bg-white">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 break-words">{linea.nombre_producto}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {pedida != null
              ? <span className="text-xs text-gray-400">Pedido: {pedida}</span>
              : <span className="text-xs text-gray-400">no venía en el pedido</span>}
            {esSerial && <Badge variant="blue">por IMEI</Badge>}
            {tieneArbol && <Badge variant="purple">por variante</Badge>}
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
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">¿Cuántos llegaron?</label>
            <input
              type="number" min="0" max={MAX_IMEI}
              value={linea.items.length}
              onChange={(e) => {
                const n = Math.max(0, Math.min(MAX_IMEI, Number(e.target.value) || 0));
                const vacio = () => itemSerialVacio(coloresActivo, caracteristicasActivo, caracteristicasLista);
                const items = Array.from({ length: n }, (_, i) => linea.items[i] ?? vacio());
                onCambiar(linea.key, { items });
              }}
              className="w-20 px-2.5 py-1.5 bg-white border-2 border-green-500 rounded-lg
                text-sm font-semibold text-gray-800 text-center tabular-nums
                focus:outline-none focus:ring-2 focus:ring-green-400"
            />
            <span className="text-xs text-gray-400">{unidades} con IMEI</span>
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
      {!esSerial && tieneArbol && !cargandoArbol && (
        <MultiSelectorCompra
          hojas={hojas}
          nodosData={linea.nodos || {}}
          mostrarCosto={false}
          onActualizar={(key, datos) => onCambiar(linea.key, {
            nodos: { ...(linea.nodos || {}), [key]: datos },
          })}
        />
      )}

      {/* ── Cantidad sin variantes: una sola casilla ───────────────────── */}
      {!esSerial && !tieneArbol && !cargandoArbol && (
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

      {/* El faltante y el sobrante NO son otro flujo: poner una cantidad
          distinta a la pedida ya los reporta, y viajan solos en la entrada. */}
      {difiere && (
        <p className={`text-xs font-medium ${faltan ? 'text-amber-600' : 'text-purple-600'}`}>
          {faltan ? `faltan ${pedida - unidades}` : `sobran ${unidades - pedida}`}
          <span className="text-gray-400 font-normal"> · queda anotado en la entrada</span>
        </p>
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
    cantidad: 1, items: [], nodos: {}, ...base,
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
