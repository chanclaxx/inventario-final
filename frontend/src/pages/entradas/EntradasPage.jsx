import { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PackagePlus, ChevronLeft, ChevronRight, Trash2, Check, Clock,
  ClipboardList, AlertTriangle, FileCheck2,
} from 'lucide-react';
import {
  getEntradas, getOrdenesParaRecibir, registrarEntrada,
  getEntradasPorConfirmar, confirmarEntrada,
} from '../../api/entradas.api';
import { getCompraById }  from '../../api/compras.api';
import { getProveedores } from '../../api/proveedores.api';
import { Modal }          from '../../components/ui/Modal';
import { InputMoneda }    from '../../components/ui/InputMoneda';
import { useAuth }        from '../../context/useAuth';
import { getProductosCantidad, getProductosSerial } from '../../api/productos.api';
import { SearchInput } from '../../components/ui/SearchInput';
import { Button }      from '../../components/ui/Button';
import { Input }       from '../../components/ui/Input';
import { Spinner }     from '../../components/ui/Spinner';
import { Badge }       from '../../components/ui/Badge';
import { EmptyState }  from '../../components/ui/EmptyState';
import { formatFechaHora, formatCOP } from '../../utils/formatters';
import { useSucursalKey }  from '../../hooks/useSucursalKey';

// ─────────────────────────────────────────────────────────────────────────────
// ENTRADAS DE BODEGA
//
// La pantalla del bodeguero. No hay una sola cifra de dinero: ni costo, ni
// precio de compra, ni proveedor. Él cuenta lo que llegó; administración le
// pone la plata después, contra la factura del proveedor.
//
// ── Una sola pantalla para los dos casos ────────────────────────────────────
// Con pedido y sin pedido NO son flujos distintos: tocar un pedido abre esta
// misma vista con las líneas ya cargadas, y "Registrar entrada" la abre vacía.
// El pedido es un atajo que llena la lista, no un modo aparte. Eso es lo que
// evita la pregunta "¿esto tiene orden o no?" y el segundo tipo de documento.
//
// ── Bodega no crea productos ────────────────────────────────────────────────
// Es deliberado: de los nombres casi iguales salen los duplicados que hoy hay en
// producción. Si algo llega y no está en el catálogo, el backend responde con un
// mensaje que dice a quién pedírselo, en vez de solo negarse.
// ─────────────────────────────────────────────────────────────────────────────

const norm = (r) => (Array.isArray(r) ? r : (Array.isArray(r?.items) ? r.items : []));

// ── Una línea de la entrada ─────────────────────────────────────────────────
function FilaLinea({ linea, onCantidad, onImei, onQuitar }) {
  const pedida    = linea.pedida ?? null;
  const cantidad  = Number(linea.cantidad) || 0;
  const difiere   = pedida != null && cantidad !== pedida;
  const faltan    = pedida != null && cantidad < pedida;

  return (
    <div className="border border-gray-100 rounded-xl p-3 flex flex-col gap-2 bg-white">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 break-words">{linea.nombre_producto}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {linea.etiqueta_nodo && (
              <span className="text-xs text-gray-400">{linea.etiqueta_nodo}</span>
            )}
            {pedida != null && (
              <span className="text-xs text-gray-400">Pedido: {pedida}</span>
            )}
            {linea.tipo === 'serial' && (
              <Badge variant="blue">IMEI</Badge>
            )}
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

      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs text-gray-500">Llegó</label>
        <input
          type="number" min="0"
          value={linea.cantidad}
          onChange={(e) => onCantidad(linea.key, e.target.value)}
          className="w-20 px-2.5 py-1.5 bg-white border-2 border-green-500 rounded-lg
            text-sm font-semibold text-gray-800 text-center tabular-nums
            focus:outline-none focus:ring-2 focus:ring-green-400"
        />
        {/* El faltante y el sobrante NO son otro flujo: escribir una cantidad
            distinta a la pedida YA es reportarlos, y viajan solos en la entrada. */}
        {difiere && (
          <span className={`text-xs font-medium ${faltan ? 'text-amber-600' : 'text-purple-600'}`}>
            {faltan ? `faltan ${pedida - cantidad}` : `sobran ${cantidad - pedida}`}
            <span className="text-gray-400 font-normal"> · queda anotado</span>
          </span>
        )}
        {pedida == null && (
          <span className="text-xs text-gray-400">no venía en el pedido</span>
        )}
      </div>

      {/* Los seriales entran de a uno: cada IMEI es su propia unidad. */}
      {linea.tipo === 'serial' && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-gray-500">
            IMEI de cada equipo ({linea.imeis.filter(Boolean).length} de {cantidad})
          </label>
          <div className="flex flex-col gap-1 max-h-44 overflow-y-auto pr-1">
            {Array.from({ length: cantidad }).map((_, i) => (
              <Input
                key={i}
                placeholder={`IMEI ${i + 1}`}
                value={linea.imeis[i] || ''}
                onChange={(e) => onImei(linea.key, i, e.target.value)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Vista: registrar una entrada ────────────────────────────────────────────
function VistaEntrada({ orden, onVolver, onListo }) {
  const queryClient = useQueryClient();
  const sucursalKey = useSucursalKey();
  const [busqueda, setBusqueda] = useState('');
  const [notas,    setNotas]    = useState('');
  const [error,    setError]    = useState('');
  const buscadorRef = useRef(null);

  // Con orden, la lista arranca llena con lo que falta por llegar.
  const [lineas, setLineas] = useState(() => {
    if (!orden) return [];
    return (orden.lineas || [])
      .filter((l) => l.pendiente > 0 && l.producto_id)
      .map((l) => ({
        key:             `oc-${l.orden_linea_id}`,
        producto_id:     l.producto_id,
        nombre_producto: l.nombre,
        tipo:            l.tipo,
        variante_id:     l.variante_id || null,
        atributo_id:     l.atributo_id || null,
        orden_linea_id:  l.orden_linea_id,
        pedida:          l.pendiente,
        cantidad:        l.pendiente,
        imeis:           [],
      }));
  });

  const { data: cantData } = useQuery({
    queryKey: ['productos-cantidad', ...sucursalKey],
    queryFn:  () => getProductosCantidad().then((r) => norm(r.data.data)),
  });
  const { data: serialData } = useQuery({
    queryKey: ['productos-serial', ...sucursalKey],
    queryFn:  () => getProductosSerial().then((r) => norm(r.data.data)),
  });

  // El catálogo entero, ya sin distinguir tipo: el producto sabe si lleva IMEI,
  // así que al bodeguero nunca se le pregunta.
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
    buscadorRef.current?.focus?.();
    setLineas((ls) => {
      const ya = ls.find((l) => l.key === key);
      if (ya) {
        return ls.map((l) => l.key === key ? { ...l, cantidad: Number(l.cantidad) + 1 } : l);
      }
      return [...ls, {
        key, producto_id: p.id, nombre_producto: p.nombre, tipo: p.tipo,
        variante_id: null, atributo_id: null, orden_linea_id: null,
        pedida: null, cantidad: 1, imeis: [],
      }];
    });
  };

  const setCantidad = (key, valor) => setLineas((ls) => ls.map((l) => {
    if (l.key !== key) return l;
    const n = Math.max(0, Number(valor) || 0);
    // Al bajar la cantidad se recortan los IMEI sobrantes: dejar colgando el de
    // una unidad que ya no llegó mandaría un equipo inexistente al inventario.
    return { ...l, cantidad: n, imeis: l.imeis.slice(0, n) };
  }));

  const setImei = (key, i, valor) => setLineas((ls) => ls.map((l) => {
    if (l.key !== key) return l;
    const imeis = [...l.imeis];
    imeis[i] = valor.trim();
    return { ...l, imeis };
  }));

  const quitar = (key) => setLineas((ls) => ls.filter((l) => l.key !== key));

  const totalUnidades = lineas.reduce((n, l) => n + (Number(l.cantidad) || 0), 0);

  const mut = useMutation({
    mutationFn: () => {
      // Un serial es una línea POR IMEI: así lo espera registrarCompra y así se
      // identifica cada unidad después.
      const payload = [];
      for (const l of lineas) {
        const cant = Number(l.cantidad) || 0;
        if (cant <= 0) continue;
        if (l.tipo === 'serial') {
          const imeis = l.imeis.filter((x) => x && x.trim());
          if (imeis.length !== cant) {
            throw new Error(`Faltan IMEI en "${l.nombre_producto}": ${imeis.length} de ${cant}`);
          }
          for (const imei of imeis) {
            payload.push({
              producto_id: l.producto_id, nombre_producto: l.nombre_producto,
              cantidad: 1, imei, orden_linea_id: l.orden_linea_id,
            });
          }
        } else {
          payload.push({
            producto_id: l.producto_id, nombre_producto: l.nombre_producto,
            cantidad: cant, variante_id: l.variante_id, atributo_id: l.atributo_id,
            orden_linea_id: l.orden_linea_id,
          });
        }
      }
      if (!payload.length) throw new Error('No hay nada que registrar');
      return registrarEntrada({
        lineas: payload,
        orden_compra_id: orden?.id || null,
        notas: notas.trim() || null,
      });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['entradas'],            exact: false });
      queryClient.invalidateQueries({ queryKey: ['entradas-ordenes'],    exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'],  exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-serial'],    exact: false });
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

      <div ref={buscadorRef}>
        <SearchInput
          value={busqueda}
          onChange={setBusqueda}
          placeholder="Escanea el código o busca el producto..."
        />
      </div>

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
            <FilaLinea key={l.key} linea={l}
              onCantidad={setCantidad} onImei={setImei} onQuitar={quitar} />
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

// ── Confirmar una entrada contra la factura del proveedor ───────────────────
//
// Solo administración. Aquí es donde la entrada deja de ser "lo que llegó" y
// pasa a ser una compra con su plata: proveedor, precios reales y número de
// factura. Los precios vienen precargados con el valor provisional que resolvió
// el backend (el estimado de la orden o el último costo conocido), así que si
// la factura coincide basta con guardar.
//
// Al guardar corre `editarPreciosCompra`, que ya cascadea en una sola
// transacción al costo promedio, al costo de cada serial, al total de la compra
// y a la deuda con el proveedor. No se reimplementa nada de eso.
function ModalConfirmar({ entrada, onCerrar, onListo }) {
  const [proveedorId, setProveedorId] = useState(entrada.proveedor_id ? String(entrada.proveedor_id) : '');
  const [numFactura,  setNumFactura]  = useState(entrada.numero_factura || '');
  const [precios,     setPrecios]     = useState({});
  const [error,       setError]       = useState('');

  const { data: detalle, isLoading } = useQuery({
    queryKey: ['entrada-detalle', entrada.id],
    queryFn:  () => getCompraById(entrada.id).then((r) => r.data.data),
  });

  const { data: proveedores = [] } = useQuery({
    queryKey: ['proveedores'],
    queryFn:  () => getProveedores().then((r) => norm(r.data.data)),
    enabled:  !entrada.proveedor_id,
  });

  const precioDe = (l) => (l.id in precios ? precios[l.id] : Number(l.precio_unitario) || 0);

  const mut = useMutation({
    mutationFn: () => confirmarEntrada(entrada.id, {
      proveedor_id:   proveedorId ? Number(proveedorId) : null,
      numero_factura: numFactura.trim() || null,
      // Solo viajan las líneas que de verdad cambiaron: `editarPreciosCompra`
      // omite las iguales, pero mandarlas todas obligaría a rechazar las de
      // precio 0 (un producto que nunca tuvo costo) y no dejaría confirmar.
      lineas: (detalle?.lineas || [])
        .filter((l) => precioDe(l) > 0 && precioDe(l) !== Number(l.precio_unitario))
        .map((l) => ({ linea_id: l.id, precio_unitario: precioDe(l) })),
    }),
    onSuccess: () => onListo(`Entrada #${entrada.numero ?? entrada.id} confirmada`),
    onError:   (e) => setError(e.response?.data?.error || 'No se pudo confirmar'),
  });

  return (
    <Modal open onClose={onCerrar} title={`Confirmar entrada #${entrada.numero ?? entrada.id}`} size="md">
      {isLoading ? <Spinner className="py-12" /> : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
            Recibida por {entrada.recibida_por || 'bodega'} el {formatFechaHora(entrada.fecha)}.
            Los precios están precargados con el valor provisional; corrígelos con
            los de la factura.
          </p>

          {!entrada.proveedor_id && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Proveedor</label>
              <select
                value={proveedorId}
                onChange={(e) => setProveedorId(e.target.value)}
                className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm
                  text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Selecciona el proveedor</option>
                {proveedores.map((pr) => <option key={pr.id} value={pr.id}>{pr.nombre}</option>)}
              </select>
              <p className="text-xs text-gray-400">
                Esta entrada llegó sin pedido, así que nadie sabe todavía de quién vino.
              </p>
            </div>
          )}

          <Input
            label="Número de factura del proveedor (opcional)"
            value={numFactura}
            onChange={(e) => setNumFactura(e.target.value)}
            placeholder="Ej: FV-10245"
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">Precio de compra por línea</label>
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
              {(detalle?.lineas || []).map((l) => (
                <div key={l.id} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700 truncate">{l.nombre_producto}</p>
                    <p className="text-[11px] text-gray-400 tabular-nums">
                      {l.imei ? l.imei : `${l.cantidad} uds`}
                      {Number(l.precio_unitario) > 0
                        ? ` · provisional ${formatCOP(l.precio_unitario)}`
                        : ' · sin costo previo'}
                    </p>
                  </div>
                  <div className="w-32 flex-shrink-0">
                    <InputMoneda
                      value={precioDe(l)}
                      onChange={(v) => setPrecios((prev) => ({ ...prev, [l.id]: Number(v) || 0 }))}
                      placeholder="0"
                      className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-xl
                        text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" className="flex-1" onClick={onCerrar}>Cancelar</Button>
            <Button
              className="flex-1"
              loading={mut.isPending}
              disabled={!entrada.proveedor_id && !proveedorId}
              onClick={() => { setError(''); mut.mutate(); }}
            >
              <Check size={15} /> Confirmar
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Vista: la lista ─────────────────────────────────────────────────────────
export default function EntradasPage() {
  const [vista, setVista] = useState(null);   // null | { orden }
  const [aviso, setAviso] = useState('');
  const [confirmando, setConfirmando] = useState(null);
  const sucursalKey = useSucursalKey();
  const queryClient = useQueryClient();
  const { esAdminNegocio } = useAuth();
  const esAdmin = esAdminNegocio();

  const { data: ordenes = [], isLoading: cargandoOrdenes } = useQuery({
    queryKey: ['entradas-ordenes', ...sucursalKey],
    queryFn:  () => getOrdenesParaRecibir().then((r) => r.data.data || []),
  });

  const { data: entradas = [], isLoading } = useQuery({
    queryKey: ['entradas', ...sucursalKey],
    queryFn:  () => getEntradas().then((r) => r.data.data || []),
  });

  // La bandeja solo la pide administración: la ruta exige el permiso de ver
  // compras y responde con proveedor y totales.
  const { data: porConfirmar = [] } = useQuery({
    queryKey: ['entradas-por-confirmar', ...sucursalKey],
    queryFn:  () => getEntradasPorConfirmar().then((r) => r.data.data || []),
    enabled:  esAdmin,
  });

  if (vista) {
    return (
      <VistaEntrada
        orden={vista.orden}
        onVolver={() => setVista(null)}
        onListo={(msg) => { setVista(null); setAviso(msg); setTimeout(() => setAviso(''), 4000); }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Entradas</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Lo que llega a la bodega. Los precios los pone administración.
          </p>
        </div>
        <Button onClick={() => setVista({ orden: null })}>
          <PackagePlus size={15} /> Registrar entrada
        </Button>
      </div>

      {aviso && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-xl px-3 py-2.5">
          {aviso}
        </p>
      )}

      {/* Bandeja de administración. No es un módulo aparte: es una sección más
          de esta pantalla, visible solo para quien puede decidir plata. */}
      {esAdmin && porConfirmar.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Por confirmar ({porConfirmar.length})
          </p>
          {porConfirmar.map((e) => (
            <div key={e.id}
              className="flex items-center justify-between gap-3 p-3 rounded-xl
                border border-amber-200 bg-amber-50/50">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800">
                  Entrada #{String(e.numero ?? e.id).padStart(4, '0')}
                </p>
                <p className="text-xs text-gray-500">
                  {formatFechaHora(e.fecha)} · {e.unidades} uds
                  {e.recibida_por && ` · ${e.recibida_por}`}
                  {e.orden_numero
                    ? ` · OC-${String(e.orden_numero).padStart(4, '0')}`
                    : ' · sin pedido'}
                </p>
                <p className="text-xs mt-0.5">
                  {!e.proveedor_id
                    ? <span className="text-amber-700 font-medium">falta el proveedor</span>
                    : <span className="text-gray-400">{e.proveedor_nombre}</span>}
                  {e.dias_esperando > 0 && (
                    <span className="text-gray-400"> · {e.dias_esperando} día(s) esperando</span>
                  )}
                </p>
              </div>
              <Button size="sm" onClick={() => setConfirmando(e)}>
                <FileCheck2 size={14} /> Confirmar
              </Button>
            </div>
          ))}
        </div>
      )}

      {confirmando && (
        <ModalConfirmar
          entrada={confirmando}
          onCerrar={() => setConfirmando(null)}
          onListo={(msg) => {
            setConfirmando(null);
            setAviso(msg);
            setTimeout(() => setAviso(''), 4000);
            queryClient.invalidateQueries({ queryKey: ['entradas-por-confirmar'], exact: false });
            queryClient.invalidateQueries({ queryKey: ['entradas'],               exact: false });
          }}
        />
      )}

      {/* Pedidos por llegar — el atajo que llena la lista, no otro flujo. */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Pedidos por llegar
        </p>
        {cargandoOrdenes ? <Spinner className="py-6" /> : ordenes.length === 0 ? (
          <p className="text-sm text-gray-400 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
            No hay pedidos pendientes. Si llegó algo sin pedido, usa «Registrar entrada».
          </p>
        ) : ordenes.map((o) => {
          const pendiente = (o.lineas || []).reduce((n, l) => n + Math.max(0, l.pendiente), 0);
          const pedida    = (o.lineas || []).reduce((n, l) => n + l.pedida, 0);
          return (
            <button
              key={o.id}
              onClick={() => setVista({ orden: o })}
              className="flex items-center justify-between gap-3 p-3 rounded-xl border
                border-gray-100 bg-white hover:border-green-300 hover:bg-green-50/40
                transition-colors text-left"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800">
                  OC-{String(o.numero ?? o.id).padStart(4, '0')}
                </p>
                <p className="text-xs text-gray-400">
                  {(o.lineas || []).length} producto(s)
                  {o.fecha_esperada && ` · esperado ${String(o.fecha_esperada).slice(0, 10)}`}
                </p>
              </div>
              <span className="text-xs text-gray-500 tabular-nums flex-shrink-0">
                faltan {pendiente} de {pedida} &nbsp;›
              </span>
            </button>
          );
        })}
      </div>

      {/* Lo ya registrado. El estado dice si administración ya le puso la
          factura: es toda la trazabilidad que el bodeguero necesita. */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Últimas entradas
        </p>
        {isLoading ? <Spinner className="py-8" /> : entradas.length === 0 ? (
          <EmptyState icon={ClipboardList}
            titulo="Sin entradas todavía"
            descripcion="Lo que registres va a aparecer aquí." />
        ) : entradas.map((e) => (
          <div key={e.id}
            className="flex items-center justify-between gap-3 p-3 rounded-xl
              border border-gray-100 bg-white">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800">
                Entrada #{String(e.numero ?? e.id).padStart(4, '0')}
                {e.estado === 'Cancelada' && <span className="ml-2 text-xs text-red-500">cancelada</span>}
              </p>
              <p className="text-xs text-gray-400">
                {formatFechaHora(e.fecha)} · {e.unidades} uds
                {e.recibida_por && ` · ${e.recibida_por}`}
                {e.orden_numero && ` · OC-${String(e.orden_numero).padStart(4, '0')}`}
              </p>
            </div>
            {e.factura_confirmada
              ? <Badge variant="green">confirmada</Badge>
              : <span className="flex items-center gap-1 text-xs text-amber-600 flex-shrink-0">
                  <Clock size={11} /> por confirmar
                </span>}
          </div>
        ))}
      </div>
    </div>
  );
}
