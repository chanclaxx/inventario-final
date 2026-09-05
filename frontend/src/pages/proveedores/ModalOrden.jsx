import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { crearOrden, editarOrden } from '../../api/ordenesCompra.api';
import { getProductosCantidad, getProductosSerial } from '../../api/productos.api';
import { getArbol }        from '../../api/variantesProductoApi';
import { hojasDelArbol }   from './capturaMercancia.utils';
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
  Layers, ChevronLeft,
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
//
// ── Pedir la VARIANTE (`detalleNodo`) ───────────────────────────────────────
// Sin esto, una orden solo podía decir "100 cargadores" y era el bodeguero
// quien, al abrir la caja, decidía cuántos eran de 25W y cuántos de 20W. El
// pedido no tenía forma de expresar "50 y 50", así que tampoco había forma de
// saber si el proveedor mandó lo correcto.
//
// Es una CAPACIDAD, no una obligación: una misma orden mezcla líneas al nodo y
// líneas al producto, y "el producto en general" sigue siendo una respuesta
// válida — es la que dan hoy los 28 negocios. Con la feature apagada esta
// pantalla es exactamente la de antes.
//
// Solo se ofrece para productos POR CANTIDAD con árbol: los equipos con IMEI se
// piden por modelo, porque el detalle de cada unidad solo se conoce al abrir la
// caja. El backend lo rechaza igual, pero una pantalla que ofrece algo que el
// servidor niega es una pantalla que miente.
// ─────────────────────────────────────────────────────────────────────────────

function normalizar(data) {
  if (Array.isArray(data)) return data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  return [];
}

// ── Elegir QUE variante se pide ─────────────────────────────────────────────
//
// Se listan las HOJAS del arbol, igual que en el despacho de la red interna y en
// las etiquetas: si "Cargador" tiene 25W y 20W, en el estante no existe "el
// cargador" —existen las dos potencias, cada una con su stock—, y pedir el
// contenedor obliga a elegir a mano al recibir, que es justo el trabajo que esto
// viene a quitar. El backend rechaza el contenedor con NODO_CONTENEDOR.
//
// "Todos, sin especificar" sigue estando y es la primera opcion: es lo que hacen
// hoy los 28 negocios y hay pedidos donde de verdad da igual la variante.
function PanelVariantes({ producto, yaAgregados, onElegir, onVolver }) {
  const { data: arbol = [], isLoading } = useQuery({
    queryKey: ['arbol-producto', producto.id, producto.sucursal_id],
    queryFn:  () => getArbol(producto.id, producto.sucursal_id).then((r) => r.data.data),
    enabled:  Boolean(producto.sucursal_id),
    staleTime: 30_000,
  });

  const hojas = hojasDelArbol(arbol);
  const claveProducto = `cantidad-${producto.id}-p`;

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={onVolver}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors w-fit">
        <ChevronLeft size={13} /> Otro producto
      </button>

      <div className="flex items-center gap-2">
        <Layers size={14} className="text-purple-400 flex-shrink-0" />
        <span className="text-sm font-medium text-gray-800 truncate">{producto.nombre}</span>
      </div>

      {isLoading ? <Spinner className="py-6" /> : (
        <div className="max-h-52 overflow-y-auto flex flex-col gap-1">
          <button type="button" onClick={() => onElegir(null)}
            disabled={yaAgregados.has(claveProducto)}
            className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left
              transition-colors hover:bg-blue-50 text-gray-700
              disabled:bg-gray-50 disabled:text-gray-300 disabled:cursor-default">
            <span className="text-sm">Todos, sin especificar</span>
            <span className="text-xs text-gray-400">
              {yaAgregados.has(claveProducto) ? 'agregado' : 'el producto completo'}
            </span>
          </button>

          {hojas.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">
              Este producto no tiene variantes configuradas
            </p>
          ) : hojas.map((h) => {
            const clave  = `cantidad-${producto.id}-${h.key}`;
            const puesto = yaAgregados.has(clave);
            return (
              <button key={h.key} type="button" disabled={puesto}
                onClick={() => onElegir(h)}
                className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left transition-colors
                  ${puesto ? 'bg-gray-50 text-gray-300 cursor-default' : 'hover:bg-blue-50 text-gray-700'}`}>
                <span className="text-sm truncate">
                  {h.labelPadre ? `${h.labelPadre} · ` : ''}{h.label}
                </span>
                <span className="text-xs text-gray-400 flex-shrink-0 tabular-nums">
                  {puesto ? 'agregado' : `hay ${h.stock ?? 0}`}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SelectorProducto({ sucursalKey, sucursalLista, onAgregar, yaAgregados, detalleNodo }) {
  const [busqueda, setBusqueda] = useState('');
  const [tipo,     setTipo]     = useState('cantidad');
  // Que producto esta abierto por variantes. Un estado, no una pantalla aparte:
  // elegir la potencia es parte de "agregar un producto", no un paso propio.
  const [abierto,  setAbierto]  = useState(null);

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

  if (abierto) {
    return (
      <PanelVariantes
        producto={abierto}
        yaAgregados={yaAgregados}
        onVolver={() => setAbierto(null)}
        onElegir={(hoja) => { onAgregar(abierto, 'cantidad', hoja); setAbierto(null); }}
      />
    );
  }

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
          // Un producto por cantidad puede entrar VARIAS veces (una por
          // variante), asi que "ya esta" solo aplica al producto completo. Los
          // seriales siguen siendo uno por orden.
          const clave   = tipo === 'serial' ? `serial-${p.id}` : `cantidad-${p.id}-p`;
          const porNodo = detalleNodo && tipo === 'cantidad';
          const puesto  = !porNodo && yaAgregados.has(clave);
          return (
            <button key={`${tipo}-${p.id}`} type="button" disabled={puesto}
              onClick={() => (porNodo ? setAbierto(p) : onAgregar(p, tipo, null))}
              className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left transition-colors
                ${puesto ? 'bg-gray-50 text-gray-300 cursor-default' : 'hover:bg-blue-50 text-gray-700'}`}>
              <span className="text-sm truncate">{p.nombre}</span>
              <span className="text-xs text-gray-400 flex-shrink-0">
                {puesto ? 'agregado'
                  : porNodo ? 'elegir variante…'
                    : (p.costo_unitario ? formatCOP(p.costo_unitario) : '')}
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
            : linea.nodo_label
              ? <Layers size={14} className="text-purple-400 flex-shrink-0" />
              : <Package size={14} className="text-gray-300 flex-shrink-0" />}
          <div className="min-w-0">
            <span className="block text-sm font-medium text-gray-800 truncate">
              {linea.nombre_producto}
            </span>
            {/* La variante pedida. Sin esto, dos lineas del mismo producto se
                verian identicas y no habria forma de saber cual es cual. */}
            {linea.nodo_label && (
              <span className="block text-xs text-purple-600 truncate">{linea.nodo_label}</span>
            )}
          </div>
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
            onChange={(v) => onCambiar('precio_estimado', v)} placeholder="0"
            className="w-full px-2.5 py-1.5 text-sm tabular-nums border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400" />
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

export function ModalOrden({ open, proveedor, orden = null, garantiaActiva, detalleNodo = false, onClose }) {
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
      // El nodo pedido y su rotulo. `getLineas` ya devuelve los dos valores
      // resueltos; sin recuperarlos aqui, editar un borrador borraria la
      // variante en silencio y la orden se convertiria en un pedido al producto.
      variante_id:     l.variante_id ?? null,
      atributo_id:     l.atributo_id ?? null,
      nodo_label:      l.variante_valor
        ? `${l.variante_tipo_nombre ? `${l.variante_tipo_nombre}: ` : ''}${l.variante_valor}`
        : l.atributo_valor
          ? `${l.atributo_tipo_nombre ? `${l.atributo_tipo_nombre}: ` : ''}${l.atributo_valor}`
          : null,
    }))
  );
  const [fechaEsperada, setFechaEsperada] = useState(orden?.fecha_esperada?.slice(0, 10) || '');
  const [numeroFactura, setNumeroFactura] = useState(orden?.numero_factura || '');
  const [fechaFactura,  setFechaFactura]  = useState(orden?.fecha_factura?.slice(0, 10) || '');
  const [diasPlazo,     setDiasPlazo]     = useState(orden?.dias_plazo ?? '');
  const [notas,         setNotas]         = useState(orden?.notas || '');
  const [error,         setError]         = useState('');

  // ── La clave INCLUYE el nodo ───────────────────────────────────────────────
  // Antes era `tipo-producto_id` y por eso el mismo producto no podia entrar dos
  // veces: "50 de 25W y 50 de 20W" era literalmente inexpresable, aunque las
  // columnas de la BD existieran desde 20260806.
  const claveDe = (l) => l.tipo === 'serial'
    ? `serial-${l.producto_id}`
    : `cantidad-${l.producto_id}-${l.variante_id ? `v-${l.variante_id}`
      : l.atributo_id ? `a-${l.atributo_id}` : 'p'}`;

  const yaAgregados = new Set(lineas.map(claveDe));
  const total = lineas.reduce(
    (s, l) => s + Number(l.cantidad_pedida || 0) * Number(l.precio_estimado || 0), 0
  );

  const agregar = (producto, tipo, hoja) => setLineas((prev) => [...prev, {
    tipo,
    producto_id:     producto.id,
    nombre_producto: producto.nombre,
    cantidad_pedida: 1,
    precio_estimado: producto.costo_unitario ?? '',
    garantia_dias:   '',
    variante_id:     hoja?.tipo === 'variante' ? hoja.id : null,
    atributo_id:     hoja?.tipo === 'atributo' ? hoja.id : null,
    nodo_label:      hoja ? `${hoja.labelPadre ? `${hoja.labelPadre} · ` : ''}${hoja.label}` : null,
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
      // `nodo_label` NO viaja: es solo para pintar. El backend resuelve la
      // etiqueta desde la BD y la congela donde hace falta, y mandarla desde
      // aqui abriria la puerta a que el navegador escribiera un rotulo que no
      // corresponde al nodo.
      variante_id:     l.variante_id ?? null,
      atributo_id:     l.atributo_id ?? null,
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
          onAgregar={agregar} yaAgregados={yaAgregados} detalleNodo={detalleNodo}
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
              <FilaLinea key={claveDe(l)} linea={l}
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
