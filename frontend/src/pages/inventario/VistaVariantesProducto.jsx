import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, ChevronRight, Plus, ShoppingCart,
  Settings, Trash2, Layers,
} from 'lucide-react';
import {
  getArbol,
  crearAtributo, actualizarAtributo, eliminarAtributo,
  crearVariante, actualizarVariante, eliminarVariante,
  ajustarStockAtributo, ajustarStockVariante,
} from '../../api/variantesProductoApi';
import { ModalPinEliminacion } from './ModalPinEliminacion';
import { Button }     from '../../components/ui/Button';
import { Input }      from '../../components/ui/Input';
import { Spinner }    from '../../components/ui/Spinner';
import { Modal }      from '../../components/ui/Modal';
import { formatCOP }  from '../../utils/formatters';
import useCarritoStore from '../../store/carritoStore';

function labelNodo(nodo) {
  return nodo.tipo_nombre ? `${nodo.tipo_nombre}: ${nodo.valor}` : nodo.valor;
}

function colorTextStock(stock, minimo) {
  if (stock === 0) return 'text-gray-300';
  if (minimo > 0 && stock <= minimo) return 'text-amber-600';
  return 'text-gray-900';
}

function colorBarra(stock, minimo) {
  if (stock === 0) return 'bg-gray-300';
  if (minimo > 0 && stock <= minimo) return 'bg-amber-400';
  return 'bg-green-500';
}

// ─── Modal crear/editar nodo ──────────────────────────────────────────────────
function ModalNodo({ open, onClose, titulo, tipos = [], datoInicial, onGuardar, isPending, error, onEliminar }) {
  const [valor,    setValor]    = useState(datoInicial?.valor || '');
  const [stockMin, setStockMin] = useState(datoInicial?.stock_minimo ?? 0);
  const [precio,   setPrecio]   = useState(datoInicial?.precio || '');
  const [tipoId,   setTipoId]   = useState(String(datoInicial?.tipo_id || ''));
  const [stock,    setStock]    = useState('');

  const tipoSel   = tipos.find((t) => String(t.id) === tipoId);
  const sugeridos = tipoSel?.valores || [];

  const manejar = () => {
    if (!valor.trim()) return;
    onGuardar({
      valor,
      stock_minimo: stockMin,
      precio:   precio || null,
      tipo_id:  tipoId ? Number(tipoId) : null,
      stock:    Number(stock) || undefined,
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={titulo} size="sm">
      <div className="flex flex-col gap-3">
        {tipos.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Tipo (opcional)</label>
            <select
              value={tipoId}
              onChange={(e) => { setTipoId(e.target.value); setValor(''); }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">Sin tipo</option>
              {tipos.map((t) => <option key={t.id} value={String(t.id)}>{t.nombre}</option>)}
            </select>
          </div>
        )}

        {sugeridos.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600">Valor sugerido</label>
            <div className="flex flex-wrap gap-1.5">
              {sugeridos.map((v) => (
                <button key={v} type="button" onClick={() => setValor(v)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors
                    ${valor === v
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-blue-300'}`}>
                  {v}
                </button>
              ))}
            </div>
          </div>
        )}

        <Input
          label="Valor"
          placeholder="Ej: M, Rojo, 42..."
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          autoFocus={tipos.length === 0}
        />

        {!datoInicial && (
          <Input
            label="Stock inicial"
            type="number" min="0"
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            placeholder="0"
          />
        )}

        <Input
          label="Stock mínimo"
          type="number" min="0"
          value={stockMin}
          onChange={(e) => setStockMin(Number(e.target.value))}
        />

        <Input
          label="Precio (opcional — sobreescribe el del producto)"
          type="number" min="0"
          value={precio}
          onChange={(e) => setPrecio(e.target.value)}
          placeholder="Dejar vacío para usar el precio del producto"
        />

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2 pt-1">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={isPending} onClick={manejar} disabled={!valor.trim()}>
            {datoInicial ? 'Guardar' : 'Agregar'}
          </Button>
        </div>

        {datoInicial && onEliminar && (
          <button
            type="button"
            onClick={onEliminar}
            className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl
              text-xs font-medium text-red-400 hover:text-red-600
              hover:bg-red-50 transition-colors border border-dashed border-red-200
              hover:border-red-300"
          >
            <Trash2 size={13} />
            Eliminar
          </button>
        )}
      </div>
    </Modal>
  );
}

// ─── Tarjeta de atributo o variante ──────────────────────────────────────────
function TarjetaNodo({
  nodo, tieneHijos, esAdmin,
  onDrillDown, onAgregar, onEditar, onReducir,
  precioPadre,
}) {
  const sinStock  = nodo.stock === 0;
  const stockBajo = !sinStock && nodo.stock_minimo > 0 && nodo.stock <= nodo.stock_minimo;

  const bg     = sinStock  ? 'bg-gray-50'      : stockBajo ? 'bg-amber-50/40' : 'bg-white';
  const border = sinStock  ? 'border-gray-200' : stockBajo ? 'border-amber-200' : 'border-green-100';
  const hover  = tieneHijos || esAdmin
    ? sinStock  ? 'hover:border-gray-300'
    : stockBajo ? 'hover:border-amber-300'
    : 'hover:border-blue-200'
    : '';

  const progreso   = nodo.stock_minimo > 0
    ? Math.min(nodo.stock / (nodo.stock_minimo * 2), 1)
    : nodo.stock > 0 ? 1 : 0;

  const precioMostrar = nodo.precio || precioPadre;
  const clickable     = tieneHijos || (esAdmin && !tieneHijos);

  return (
    <div
      onClick={clickable ? () => onDrillDown(nodo) : undefined}
      className={`border rounded-2xl p-4 flex flex-col gap-3 transition-colors select-none w-full
        ${bg} ${border} ${hover} ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
    >
      {/* Nombre + acciones */}
      <div className="flex items-start justify-between gap-2">
        <p className={`font-medium text-sm break-words leading-snug flex-1 min-w-0
          ${sinStock ? 'text-gray-400' : 'text-gray-900'}`}>
          {labelNodo(nodo)}
        </p>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {esAdmin && (
            <button
              onClick={(e) => { e.stopPropagation(); onEditar(); }}
              className="p-1.5 rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <Settings size={13} />
            </button>
          )}
          {esAdmin && !tieneHijos && onReducir && (
            <button
              onClick={(e) => { e.stopPropagation(); onReducir(); }}
              className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
              title="Reducir stock"
            >
              <Trash2 size={13} />
            </button>
          )}
          {tieneHijos && <ChevronRight size={15} className="text-blue-400 ml-1" />}
        </div>
      </div>

      {/* Stock + precio + barra */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-1.5">
            <span className={`text-2xl font-bold tabular-nums leading-none
              ${colorTextStock(nodo.stock, nodo.stock_minimo)}`}>
              {nodo.stock}
            </span>
            <span className="text-xs text-gray-400">
              {sinStock ? 'sin stock' : stockBajo ? 'bajo mín.' : tieneHijos ? 'total' : 'en stock'}
            </span>
          </div>
          {precioMostrar && (
            <span className="text-sm font-semibold text-gray-700">{formatCOP(precioMostrar)}</span>
          )}
        </div>

        {nodo.stock_minimo > 0 && (
          <div className="flex flex-col gap-1">
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${colorBarra(nodo.stock, nodo.stock_minimo)}`}
                style={{ width: `${progreso * 100}%` }}
              />
            </div>
            <p className="text-xs text-gray-400">Mín. {nodo.stock_minimo}</p>
          </div>
        )}

        {tieneHijos && nodo.variantes?.length > 0 && (
          <p className="text-xs text-gray-400">{nodo.variantes.length} variante(s)</p>
        )}
      </div>

      {/* Botón agregar solo en hojas (no admin o si no tiene hijos) */}
      {!tieneHijos && !esAdmin && (
        <Button size="sm" className="w-full" disabled={sinStock}
          onClick={(e) => { e.stopPropagation(); onAgregar(); }}>
          <ShoppingCart size={14} />
          {sinStock ? 'Sin stock' : 'Agregar al carrito'}
        </Button>
      )}

      {/* Admin en hoja: mostrar botón agregar también */}
      {!tieneHijos && esAdmin && (
        <Button size="sm" className="w-full" disabled={sinStock} variant="secondary"
          onClick={(e) => { e.stopPropagation(); onAgregar(); }}>
          <ShoppingCart size={14} />
          {sinStock ? 'Sin stock' : 'Agregar al carrito'}
        </Button>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export function VistaVariantesProducto({ producto, sucursalId, esAdmin, onClose }) {
  const queryClient = useQueryClient();
  const agregarItem = useCarritoStore((s) => s.agregarItem);

  const [atributoSel, setAtributoSel] = useState(null);
  const [modalNodo,   setModalNodo]   = useState(null);
  const [errorM,      setErrorM]      = useState('');

  const { data: arbol = [], isLoading } = useQuery({
    queryKey: ['arbol-producto', producto.id, sucursalId],
    queryFn:  () => getArbol(producto.id, sucursalId).then((r) => r.data.data),
    staleTime: 0,
  });

  const { data: tiposData } = useQuery({
    queryKey: ['tipos-caracteristica'],
    queryFn:  () =>
      import('../../api/tiposCaracteristicaApi')
        .then((m) => m.getTipos())
        .then((r) => r.data.data),
  });
  const tipos = tiposData || [];

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ['arbol-producto', producto.id, sucursalId] });
    queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
  };

  const cerrarModal = () => { setModalNodo(null); setErrorM(''); };

  const mutCrearAtr = useMutation({
    mutationFn: (datos) => crearAtributo(producto.id, datos),
    onSuccess:  () => { invalidar(); cerrarModal(); },
    onError:    (e) => setErrorM(e.response?.data?.error || 'Error'),
  });
  const mutEditarAtr = useMutation({
    mutationFn: ({ id, datos }) => actualizarAtributo(id, datos),
    onSuccess:  () => { invalidar(); cerrarModal(); },
    onError:    (e) => setErrorM(e.response?.data?.error || 'Error'),
  });
  const mutEliminarAtr = useMutation({
    mutationFn: (id) => eliminarAtributo(id),
    onSuccess:  invalidar,
    onError:    (e) => alert(e.response?.data?.error || 'Error al eliminar'),
  });

  const mutCrearVar = useMutation({
    mutationFn: ({ atributoId, datos }) => crearVariante(atributoId, datos),
    onSuccess:  () => { invalidar(); cerrarModal(); },
    onError:    (e) => setErrorM(e.response?.data?.error || 'Error'),
  });
  const mutEditarVar = useMutation({
    mutationFn: ({ id, datos }) => actualizarVariante(id, datos),
    onSuccess:  () => { invalidar(); cerrarModal(); },
    onError:    (e) => setErrorM(e.response?.data?.error || 'Error'),
  });
  const mutEliminarVar = useMutation({
    mutationFn: (id) => eliminarVariante(id),
    onSuccess:  invalidar,
    onError:    (e) => alert(e.response?.data?.error || 'Error al eliminar'),
  });

  const [nodoAReducir,    setNodoAReducir]    = useState(null); // { nodo, tipo: 'atributo'|'variante' }
  const [cantidadReducir, setCantidadReducir] = useState('1');

  const mutReducirNodo = useMutation({
    mutationFn: ({ id, tipo, cantidad }) =>
      tipo === 'variante'
        ? ajustarStockVariante(id, { cantidad: -Math.abs(cantidad) })
        : ajustarStockAtributo(id, { cantidad: -Math.abs(cantidad) }),
    onSuccess: () => {
      invalidar();
      setNodoAReducir(null);
      setCantidadReducir('1');
    },
  });

  const handleConfirmarReducir = () => {
    const cant = parseInt(cantidadReducir, 10);
    if (!cant || cant <= 0) throw new Error('La cantidad debe ser mayor a 0');
    if (cant > nodoAReducir.nodo.stock)
      throw new Error(`Stock insuficiente. Stock actual: ${nodoAReducir.nodo.stock}`);
    return mutReducirNodo.mutateAsync({ id: nodoAReducir.nodo.id, tipo: nodoAReducir.tipo, cantidad: cant });
  };

  const abrirReducir = (nodo, tipo) => {
    setNodoAReducir({ nodo, tipo });
    setCantidadReducir('1');
  };

  const handleAgregarAtributo = (atributo) => {
    agregarItem({
      key:            `cant-${producto.id}-a-${atributo.id}`,
      tipo:           'cantidad',
      nombre:         producto.nombre,
      producto_id:    producto.id,
      atributo_id:    atributo.id,
      atributo_label: labelNodo(atributo),
      precio:         Math.round(Number(atributo.precio || producto.precio || 0)),
      stock:          atributo.stock,
      cantidad:       1,
      linea_id:       producto.linea_id || null,
    });
  };

  const handleAgregarVariante = (variante) => {
    const atr = atributoSel || arbol.find((a) => a.variantes?.some((v) => v.id === variante.id));
    agregarItem({
      key:            `cant-${producto.id}-v-${variante.id}`,
      tipo:           'cantidad',
      nombre:         producto.nombre,
      producto_id:    producto.id,
      atributo_id:    atr?.id,
      variante_id:    variante.id,
      atributo_label: atr ? labelNodo(atr) : undefined,
      variante_label: labelNodo(variante),
      precio:         Math.round(Number(variante.precio || atr?.precio || producto.precio || 0)),
      stock:          variante.stock,
      cantidad:       1,
      linea_id:       producto.linea_id || null,
    });
  };

  // Sincronizar atributoSel con datos frescos del árbol
  const atributoActualizado = atributoSel
    ? (arbol.find((a) => a.id === atributoSel.id) ?? atributoSel)
    : null;
  const variantesActuales = atributoActualizado?.variantes || [];

  // ─── NIVEL 2: variantes del atributo seleccionado ─────────────────────────
  if (atributoSel) {
    const tiposParaVar = tipos.filter((t) => t.id !== atributoActualizado?.tipo_id);

    return (
      <div className="flex flex-col gap-4">
        {/* Breadcrumb */}
        <div className="flex flex-col gap-0.5">
          <button
            onClick={() => setAtributoSel(null)}
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-700 transition-colors w-fit"
          >
            <ChevronLeft size={14} />
            {producto.nombre}
          </button>
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-gray-900">{labelNodo(atributoActualizado)}</h3>
            {esAdmin && (
              <button
                onClick={() => { setErrorM(''); setModalNodo({ modo: 'crear-var', atributoId: atributoSel.id }); }}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
              >
                <Plus size={13} />
                Nueva variante
              </button>
            )}
          </div>
        </div>

        {/* Cards variantes */}
        {isLoading ? (
          <Spinner className="py-16" />
        ) : variantesActuales.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <p className="text-sm text-gray-400">Sin variantes todavía</p>
            {esAdmin && (
              <button
                onClick={() => { setErrorM(''); setModalNodo({ modo: 'crear-var', atributoId: atributoSel.id }); }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed
                  border-gray-200 text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors text-sm"
              >
                <Plus size={14} />
                Agregar primera variante
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {variantesActuales.map((v) => (
              <TarjetaNodo
                key={v.id}
                nodo={v}
                tieneHijos={false}
                esAdmin={esAdmin}
                precioPadre={atributoActualizado?.precio || producto.precio}
                onDrillDown={() => {}}
                onAgregar={() => handleAgregarVariante(v)}
                onEditar={() => { setErrorM(''); setModalNodo({ modo: 'editar-var', dato: v }); }}
                onReducir={() => abrirReducir(v, 'variante')}
              />
            ))}
            {esAdmin && (
              <button
                onClick={() => { setErrorM(''); setModalNodo({ modo: 'crear-var', atributoId: atributoSel.id }); }}
                className="border-2 border-dashed border-gray-200 rounded-2xl p-4
                  flex flex-col items-center justify-center gap-2
                  text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors min-h-[120px]"
              >
                <Plus size={18} />
                <span className="text-sm">Agregar variante</span>
              </button>
            )}
          </div>
        )}

        {/* Modales nivel 2 */}
        {modalNodo?.modo === 'crear-var' && (
          <ModalNodo
            open
            onClose={cerrarModal}
            titulo="Nueva variante"
            tipos={tiposParaVar}
            onGuardar={(d) => mutCrearVar.mutate({ atributoId: modalNodo.atributoId, datos: d })}
            isPending={mutCrearVar.isPending}
            error={errorM}
          />
        )}
        {modalNodo?.modo === 'editar-var' && (
          <ModalNodo
            open
            onClose={cerrarModal}
            titulo={`Editar — ${labelNodo(modalNodo.dato)}`}
            tipos={tiposParaVar}
            datoInicial={modalNodo.dato}
            onGuardar={(d) => mutEditarVar.mutate({ id: modalNodo.dato.id, datos: d })}
            isPending={mutEditarVar.isPending}
            error={errorM}
            onEliminar={() => { mutEliminarVar.mutate(modalNodo.dato.id); cerrarModal(); }}
          />
        )}

        {nodoAReducir && (
          <ModalPinEliminacion
            titulo="Reducir stock"
            descripcion={`Reducir stock de "${labelNodo(nodoAReducir.nodo)}". Stock actual: ${nodoAReducir.nodo.stock} unidades.`}
            loading={mutReducirNodo.isPending}
            onConfirm={handleConfirmarReducir}
            onClose={() => { setNodoAReducir(null); setCantidadReducir('1'); }}
            extraContent={
              <Input
                label="Cantidad a reducir"
                type="number" min="1" max={nodoAReducir.nodo.stock}
                value={cantidadReducir}
                onChange={(e) => setCantidadReducir(e.target.value)}
              />
            }
          />
        )}
      </div>
    );
  }

  // ─── NIVEL 1: atributos del producto ─────────────────────────────────────
  const stockTotal = arbol.length > 0
    ? arbol.reduce((s, a) => s + (Number(a.stock) || 0), 0)
    : producto.stock;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={onClose}
          className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-700 transition-colors"
        >
          <ChevronLeft size={14} />
          Inventario
        </button>
        {esAdmin && arbol.length > 0 && (
          <button
            onClick={() => { setErrorM(''); setModalNodo({ modo: 'crear-atr' }); }}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
          >
            <Plus size={13} />
            Nuevo atributo
          </button>
        )}
      </div>

      {/* Título producto */}
      <div className="flex items-center gap-2.5">
        <Layers size={18} className="text-blue-600 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-gray-900 leading-tight">{producto.nombre}</h2>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-sm font-bold tabular-nums
              ${stockTotal === 0 ? 'text-gray-300' : 'text-gray-600'}`}>
              {stockTotal}
            </span>
            <span className="text-xs text-gray-400">unidades totales</span>
            {producto.precio && (
              <span className="text-xs font-semibold text-gray-500 ml-1">{formatCOP(producto.precio)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Cards atributos */}
      {isLoading ? (
        <Spinner className="py-20" />
      ) : arbol.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-10">
          <p className="text-sm text-gray-400 text-center">
            Este producto no tiene atributos aún.
          </p>
          <Button
            className="w-full max-w-xs"
            disabled={producto.stock === 0}
            onClick={() => {
              agregarItem({
                key:         `cant-${producto.id}`,
                tipo:        'cantidad',
                nombre:      producto.nombre,
                producto_id: producto.id,
                precio:      Math.round(Number(producto.precio || producto.costo_unitario || 0)),
                stock:       producto.stock,
                cantidad:    1,
                linea_id:    producto.linea_id || null,
              });
              onClose();
            }}
          >
            <ShoppingCart size={14} />
            {producto.stock === 0 ? 'Sin stock' : 'Agregar al carrito'}
          </Button>
          {esAdmin && (
            <button
              onClick={() => { setErrorM(''); setModalNodo({ modo: 'crear-atr' }); }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed
                border-gray-200 text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors text-sm"
            >
              <Plus size={14} />
              Agregar primer atributo (ej: Talla M)
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {arbol.map((atributo) => {
            const tieneHijos = Array.isArray(atributo.variantes) && atributo.variantes.length > 0;
            return (
              <TarjetaNodo
                key={atributo.id}
                nodo={atributo}
                tieneHijos={tieneHijos}
                esAdmin={esAdmin}
                precioPadre={producto.precio}
                onDrillDown={() => setAtributoSel(atributo)}
                onAgregar={() => handleAgregarAtributo(atributo)}
                onEditar={() => { setErrorM(''); setModalNodo({ modo: 'editar-atr', dato: atributo }); }}
                onReducir={() => abrirReducir(atributo, 'atributo')}
              />
            );
          })}
          {esAdmin && (
            <button
              onClick={() => { setErrorM(''); setModalNodo({ modo: 'crear-atr' }); }}
              className="border-2 border-dashed border-gray-200 rounded-2xl p-4
                flex flex-col items-center justify-center gap-2
                text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors min-h-[120px]"
            >
              <Plus size={18} />
              <span className="text-sm">Agregar atributo</span>
            </button>
          )}
        </div>
      )}

      {/* Modales nivel 1 */}
      {modalNodo?.modo === 'crear-atr' && (
        <ModalNodo
          open
          onClose={cerrarModal}
          titulo="Nuevo atributo"
          tipos={tipos}
          onGuardar={(d) => mutCrearAtr.mutate(d)}
          isPending={mutCrearAtr.isPending}
          error={errorM}
        />
      )}
      {modalNodo?.modo === 'editar-atr' && (
        <ModalNodo
          open
          onClose={cerrarModal}
          titulo={`Editar — ${labelNodo(modalNodo.dato)}`}
          tipos={tipos}
          datoInicial={modalNodo.dato}
          onGuardar={(d) => mutEditarAtr.mutate({ id: modalNodo.dato.id, datos: d })}
          isPending={mutEditarAtr.isPending}
          error={errorM}
          onEliminar={() => { mutEliminarAtr.mutate(modalNodo.dato.id); cerrarModal(); }}
        />
      )}

      {nodoAReducir && (
        <ModalPinEliminacion
          titulo="Reducir stock"
          descripcion={`Reducir stock de "${labelNodo(nodoAReducir.nodo)}". Stock actual: ${nodoAReducir.nodo.stock} unidades.`}
          loading={mutReducirNodo.isPending}
          onConfirm={handleConfirmarReducir}
          onClose={() => { setNodoAReducir(null); setCantidadReducir('1'); }}
          extraContent={
            <Input
              label="Cantidad a reducir"
              type="number" min="1" max={nodoAReducir.nodo.stock}
              value={cantidadReducir}
              onChange={(e) => setCantidadReducir(e.target.value)}
            />
          }
        />
      )}
    </div>
  );
}
