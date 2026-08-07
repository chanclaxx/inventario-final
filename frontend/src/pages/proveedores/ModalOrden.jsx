import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { crearOrden, editarOrden } from '../../api/ordenesCompra.api';
import { getProductosCantidad, getProductosSerial } from '../../api/productos.api';
import { formatCOP }   from '../../utils/formatters';
import { Modal }       from '../../components/ui/Modal';
import { Button }      from '../../components/ui/Button';
import { Input }       from '../../components/ui/Input';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { SearchInput } from '../../components/ui/SearchInput';
import { Spinner }     from '../../components/ui/Spinner';
import { useSucursalKey } from '../../hooks/useSucursalKey';
import {
  Plus, Trash2, Package, Smartphone, CalendarClock, Info, ShieldCheck,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// CREAR / EDITAR UNA ORDEN DE COMPRA
//
// Dos cosas que el usuario NO tiene que entender para usar esto:
//
//   · Los equipos con IMEI se piden por MODELO Y CANTIDAD, no por IMEI. El IMEI
//     solo se conoce cuando se abre la caja, así que se captura al recibir.
//   · El precio es un ESTIMADO. El costo real del inventario sale del precio
//     que se registre al recibir — si el estimado mandara, una orden mal
//     cotizada corrompería la utilidad de las ventas.
//
// La factura es opcional aquí: una orden es un pedido, no una deuda. Solo en el
// modo de cargo "al facturar la orden" hace falta antes de poder recibir, y en
// ese caso el aviso lo dice.
// ─────────────────────────────────────────────────────────────────────────────

function normalizar(data) {
  if (Array.isArray(data)) return data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  return [];
}

function SelectorProducto({ sucursalKey, sucursalLista, onAgregar, yaAgregados }) {
  const [busqueda, setBusqueda] = useState('');
  const [tipo,     setTipo]     = useState('cantidad');

  const { data: cantidadData, isLoading: cargandoCant } = useQuery({
    queryKey: ['productos-cantidad', ...sucursalKey],
    queryFn:  () => getProductosCantidad().then((r) => normalizar(r.data.data)),
    enabled:  sucursalLista && tipo === 'cantidad',
  });

  const { data: serialData, isLoading: cargandoSer } = useQuery({
    queryKey: ['productos-serial', ...sucursalKey],
    queryFn:  () => getProductosSerial().then((r) => normalizar(r.data.data)),
    enabled:  sucursalLista && tipo === 'serial',
  });

  const fuente = tipo === 'cantidad' ? normalizar(cantidadData) : normalizar(serialData);
  const cargando = tipo === 'cantidad' ? cargandoCant : cargandoSer;

  const texto = busqueda.trim().toLowerCase();
  const lista = fuente
    .filter((p) => !texto || (p.nombre || '').toLowerCase().includes(texto))
    .slice(0, 40);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        {[
          { id: 'cantidad', label: 'Por cantidad', Icn: Package },
          { id: 'serial',   label: 'Con IMEI',     Icn: Smartphone },
        ].map((opcion) => {
          const Icn = opcion.Icn;
          return (
            <button key={opcion.id} type="button" onClick={() => setTipo(opcion.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all
                ${tipo === opcion.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <Icn size={13} /> {opcion.label}
            </button>
          );
        })}
      </div>

      <SearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar producto…" />

      {tipo === 'serial' && (
        <div className="bg-blue-50 rounded-xl px-3 py-2 flex items-start gap-2">
          <Info size={13} className="text-blue-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700">
            Los equipos se piden por modelo y cantidad. Los IMEI se capturan cuando llegue
            la mercancía, que es cuando se conocen.
          </p>
        </div>
      )}

      <div className="max-h-52 overflow-y-auto flex flex-col gap-1">
        {cargando ? <Spinner className="py-8" /> : lista.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6">
            {texto ? 'Ningún producto coincide' : 'No hay productos en esta sucursal'}
          </p>
        ) : lista.map((p) => {
          const clave = `${tipo}-${p.id}`;
          const puesto = yaAgregados.has(clave);
          return (
            <button key={clave} type="button" disabled={puesto}
              onClick={() => onAgregar(p, tipo)}
              className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left transition-colors
                ${puesto ? 'bg-gray-50 text-gray-300 cursor-default' : 'hover:bg-blue-50 text-gray-700'}`}>
              <span className="text-sm truncate">{p.nombre}</span>
              <span className="text-xs text-gray-400 flex-shrink-0">
                {puesto ? 'agregado' : (p.costo_unitario ? formatCOP(p.costo_unitario) : '')}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FilaLinea({ linea, onCambiar, onQuitar, garantiaActiva }) {
  return (
    <div className="border border-gray-200 rounded-xl p-3 flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {linea.tipo === 'serial'
            ? <Smartphone size={14} className="text-gray-300 flex-shrink-0" />
            : <Package size={14} className="text-gray-300 flex-shrink-0" />}
          <span className="text-sm font-medium text-gray-800 truncate">{linea.nombre_producto}</span>
        </div>
        <button type="button" onClick={onQuitar}
          className="p-1 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0">
          <Trash2 size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-400">Cantidad</label>
          <input type="number" min="1" value={linea.cantidad_pedida}
            onChange={(e) => onCambiar('cantidad_pedida', e.target.value)}
            className="w-full px-2.5 py-1.5 text-sm tabular-nums border border-gray-200 rounded-lg
                       focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-400">Precio estimado</label>
          <InputMoneda value={linea.precio_estimado}
            onChange={(v) => onCambiar('precio_estimado', v)} placeholder="0" />
        </div>
      </div>

      {garantiaActiva && (
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs text-gray-400 flex items-center gap-1.5">
            <ShieldCheck size={12} className="text-gray-300" />
            Garantía del proveedor
          </label>
          <div className="flex items-center gap-1.5">
            <input type="number" min="0" max="3650" value={linea.garantia_dias ?? ''}
              placeholder="—"
              onChange={(e) => onCambiar('garantia_dias', e.target.value)}
              className="w-16 px-2 py-1 text-sm text-right tabular-nums border border-gray-200 rounded-lg
                         focus:outline-none focus:ring-1 focus:ring-blue-400" />
            <span className="text-xs text-gray-400">días</span>
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 text-right tabular-nums">
        {formatCOP(Number(linea.cantidad_pedida || 0) * Number(linea.precio_estimado || 0))}
      </p>
    </div>
  );
}

export function ModalOrden({ open, proveedor, orden = null, garantiaActiva, onClose }) {
  const queryClient = useQueryClient();
  const { sucursalKey, sucursalLista } = useSucursalKey();
  const editando = Boolean(orden);

  const [lineas, setLineas] = useState(() =>
    (orden?.lineas || []).map((l) => ({
      tipo:            l.tipo,
      producto_id:     l.producto_id,
      nombre_producto: l.nombre_producto,
      cantidad_pedida: l.cantidad_pedida,
      precio_estimado: l.precio_estimado ?? '',
      garantia_dias:   l.garantia_dias ?? '',
    }))
  );
  const [fechaEsperada, setFechaEsperada] = useState(orden?.fecha_esperada?.slice(0, 10) || '');
  const [numeroFactura, setNumeroFactura] = useState(orden?.numero_factura || '');
  const [fechaFactura,  setFechaFactura]  = useState(orden?.fecha_factura?.slice(0, 10) || '');
  const [diasPlazo,     setDiasPlazo]     = useState(orden?.dias_plazo ?? '');
  const [notas,         setNotas]         = useState(orden?.notas || '');
  const [error,         setError]         = useState('');

  const yaAgregados = new Set(lineas.map((l) => `${l.tipo}-${l.producto_id}`));
  const total = lineas.reduce(
    (s, l) => s + Number(l.cantidad_pedida || 0) * Number(l.precio_estimado || 0), 0
  );

  const agregar = (producto, tipo) => setLineas((prev) => [...prev, {
    tipo,
    producto_id:     producto.id,
    nombre_producto: producto.nombre,
    cantidad_pedida: 1,
    precio_estimado: producto.costo_unitario ?? '',
    garantia_dias:   '',
  }]);

  const cambiar = (idx, campo, valor) =>
    setLineas((prev) => prev.map((l, i) => i === idx ? { ...l, [campo]: valor } : l));

  const quitar = (idx) => setLineas((prev) => prev.filter((_, i) => i !== idx));

  const payload = (emitir) => ({
    proveedor_id:   proveedor.id,
    emitir,
    fecha_esperada: fechaEsperada || null,
    numero_factura: numeroFactura.trim() || null,
    fecha_factura:  fechaFactura  || null,
    dias_plazo:     diasPlazo !== '' ? Number(diasPlazo) : null,
    notas:          notas.trim() || null,
    lineas: lineas.map((l) => ({
      tipo:            l.tipo,
      producto_id:     l.producto_id,
      nombre_producto: l.nombre_producto,
      cantidad_pedida: Number(l.cantidad_pedida),
      precio_estimado: l.precio_estimado !== '' ? Number(l.precio_estimado) : null,
      garantia_dias:   l.garantia_dias   !== '' ? Number(l.garantia_dias)   : null,
    })),
  });

  const mut = useMutation({
    mutationFn: ({ emitir }) => editando
      ? editarOrden(orden.id, payload(emitir))
      : crearOrden(payload(emitir)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ordenes-compra'], exact: false });
      onClose();
    },
    onError: (e) => setError(e.response?.data?.error || 'No se pudo guardar la orden'),
  });

  const guardar = (emitir) => {
    setError('');
    if (lineas.length === 0) {
      setError('Agrega al menos un producto a la orden');
      return;
    }
    if (lineas.some((l) => !Number(l.cantidad_pedida) || Number(l.cantidad_pedida) < 1)) {
      setError('Todas las líneas necesitan una cantidad mayor a cero');
      return;
    }
    mut.mutate({ emitir });
  };

  return (
    <Modal open={open} onClose={onClose} size="xl"
      title={editando ? `Orden #${orden.numero ?? orden.id}` : `Nueva orden — ${proveedor?.nombre}`}>
      <div className="flex flex-col gap-5">

        <SelectorProducto
          sucursalKey={sucursalKey} sucursalLista={sucursalLista}
          onAgregar={agregar} yaAgregados={yaAgregados}
        />

        {lineas.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Lo que pediste
              </span>
              <span className="text-sm font-semibold text-gray-800 tabular-nums">{formatCOP(total)}</span>
            </div>
            {lineas.map((l, i) => (
              <FilaLinea key={`${l.tipo}-${l.producto_id}`} linea={l}
                garantiaActiva={garantiaActiva}
                onCambiar={(campo, valor) => cambiar(i, campo, valor)}
                onQuitar={() => quitar(i)} />
            ))}
          </div>
        )}

        <div className="border-t border-gray-100 pt-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <CalendarClock size={14} className="text-gray-400" />
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Entrega y pago
            </span>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">¿Cuándo debería llegar?</label>
              <input type="date" value={fechaEsperada}
                onChange={(e) => setFechaEsperada(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-200 rounded-xl text-gray-600
                           focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <Input label="N° de factura" value={numeroFactura}
              onChange={(e) => setNumeroFactura(e.target.value)}
              placeholder="Opcional — si ya te la dieron" />
          </div>

          {numeroFactura.trim() && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400">Fecha de la factura</label>
                <input type="date" value={fechaFactura}
                  onChange={(e) => setFechaFactura(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-xl text-gray-600
                             focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400">Plazo para pagar (días)</label>
                <input type="number" min="0" max="365" value={diasPlazo}
                  placeholder="30"
                  onChange={(e) => setDiasPlazo(e.target.value)}
                  className="px-3 py-2 text-sm tabular-nums border border-gray-200 rounded-xl
                             focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Notas</label>
            <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2}
              placeholder="Lo que quieras recordar de este pedido"
              className="px-3 py-2 text-sm border border-gray-200 rounded-xl resize-none
                         focus:outline-none focus:ring-1 focus:ring-blue-400" />
          </div>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          {(!editando || orden.estado === 'Borrador') && (
            <Button variant="ghost" loading={mut.isPending} onClick={() => guardar(false)}>
              Guardar borrador
            </Button>
          )}
          <Button loading={mut.isPending} onClick={() => guardar(true)}>
            <Plus size={15} /> {editando ? 'Guardar y emitir' : 'Emitir orden'}
          </Button>
        </div>

        <p className="text-xs text-gray-400 text-center">
          Mientras sea borrador puedes cambiarla. Al emitirla queda en firme y ya
          se puede recibir mercancía contra ella.
        </p>
      </div>
    </Modal>
  );
}
