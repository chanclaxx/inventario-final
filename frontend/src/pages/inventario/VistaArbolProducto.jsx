import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, Plus, ChevronDown, ChevronRight, ShoppingCart,
  Settings, Trash2, Layers, AlertTriangle,
} from 'lucide-react';
import {
  getArbol, crearAtributo, actualizarAtributo, eliminarAtributo,
  crearVariante, actualizarVariante, eliminarVariante,
} from '../../api/variantesProductoApi';
import { Modal }   from '../../components/ui/Modal';
import { Button }  from '../../components/ui/Button';
import { Input }   from '../../components/ui/Input';
import { Spinner } from '../../components/ui/Spinner';
import { formatCOP } from '../../utils/formatters';
import useCarritoStore from '../../store/carritoStore';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function label(nodo) {
  return nodo.tipo_nombre ? `${nodo.tipo_nombre}: ${nodo.valor}` : nodo.valor;
}

function colorStock(stock, minimo = 0) {
  if (stock === 0) return 'text-gray-300';
  if (minimo > 0 && stock <= minimo) return 'text-amber-600';
  return 'text-green-600';
}

// ─── Modal de crear/editar nodo ───────────────────────────────────────────────
// tipos: array de { id, nombre, valores[] } del negocio
// datoInicial: nodo existente cuando se edita (null cuando se crea)

function ModalNodo({ open, onClose, titulo, tipos = [], datoInicial, onGuardar, isPending, error }) {
  const [valor,    setValor]    = useState(datoInicial?.valor || '');
  const [stockMin, setStockMin] = useState(datoInicial?.stock_minimo ?? 0);
  const [precio,   setPrecio]   = useState(datoInicial?.precio || '');
  const [tipoId,   setTipoId]   = useState(String(datoInicial?.tipo_id || ''));
  const [stock,    setStock]    = useState('');

  const tipoSeleccionado  = tipos.find((t) => String(t.id) === tipoId);
  const valoresSugeridos  = tipoSeleccionado?.valores || [];

  const manejarGuardar = () => {
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

        {/* Selector de tipo */}
        {tipos.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Tipo (opcional)</label>
            <select
              value={tipoId}
              onChange={(e) => { setTipoId(e.target.value); setValor(''); }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
            >
              <option value="">Sin tipo</option>
              {tipos.map((t) => (
                <option key={t.id} value={String(t.id)}>{t.nombre}</option>
              ))}
            </select>
          </div>
        )}

        {/* Valores sugeridos del tipo seleccionado */}
        {valoresSugeridos.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600">Valor sugerido</label>
            <div className="flex flex-wrap gap-1.5">
              {valoresSugeridos.map((v) => (
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
          <Button className="flex-1" loading={isPending} onClick={manejarGuardar} disabled={!valor.trim()}>
            {datoInicial ? 'Guardar' : 'Agregar'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Fila de variante (nivel 2) ───────────────────────────────────────────────

function FilaVariante({ variante, atributo, producto, sucursalId, tipos, esAdmin, onAgregar }) {
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [errorM,   setErrorM]   = useState('');

  const invalidarArbol = () =>
    queryClient.invalidateQueries({ queryKey: ['arbol-producto', producto.id, sucursalId] });

  const mutEditar = useMutation({
    mutationFn: (datos) => actualizarVariante(variante.id, datos),
    onSuccess:  () => { invalidarArbol(); setEditando(false); },
    onError:    (e) => setErrorM(e.response?.data?.error || 'Error'),
  });
  const mutEliminar = useMutation({
    mutationFn: () => eliminarVariante(variante.id),
    onSuccess:  invalidarArbol,
    onError:    (e) => alert(e.response?.data?.error || 'Error al eliminar'),
  });

  const sinStock = variante.stock === 0;

  return (
    <div className={`flex items-center gap-3 pl-4 py-2.5 pr-3 rounded-xl border
      ${sinStock ? 'bg-gray-50 border-gray-100' : 'bg-white border-green-100'}`}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800">{label(variante)}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`text-sm font-bold tabular-nums ${colorStock(variante.stock, variante.stock_minimo)}`}>
            {variante.stock}
          </span>
          <span className="text-xs text-gray-400">uds</span>
          {variante.precio && (
            <span className="text-xs text-gray-500 ml-1">{formatCOP(variante.precio)}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {esAdmin && (
          <>
            <button onClick={() => setEditando(true)}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
              <Settings size={13} />
            </button>
            <button onClick={() => mutEliminar.mutate()} disabled={mutEliminar.isPending}
              className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
              <Trash2 size={13} />
            </button>
          </>
        )}
        <Button size="sm" disabled={sinStock} onClick={() => onAgregar(atributo, variante)}>
          <ShoppingCart size={13} />
          <span className="hidden sm:inline">{sinStock ? 'Sin stock' : 'Agregar'}</span>
        </Button>
      </div>

      {editando && (
        <ModalNodo
          open={editando}
          onClose={() => { setEditando(false); setErrorM(''); }}
          titulo={`Editar — ${label(variante)}`}
          tipos={tipos}
          datoInicial={variante}
          onGuardar={(d) => mutEditar.mutate(d)}
          isPending={mutEditar.isPending}
          error={errorM}
        />
      )}
    </div>
  );
}

// ─── Fila de atributo (nivel 1) ───────────────────────────────────────────────

function FilaAtributo({ atributo, producto, sucursalId, tipos, esAdmin }) {
  const queryClient = useQueryClient();
  const [expandido,     setExpandido]     = useState(true);
  const [modalVariante, setModalVariante] = useState(false);
  const [editando,      setEditando]      = useState(false);
  const [errorM,        setErrorM]        = useState('');

  const invalidarArbol = () =>
    queryClient.invalidateQueries({ queryKey: ['arbol-producto', producto.id, sucursalId] });

  const mutEditarAtr = useMutation({
    mutationFn: (datos) => actualizarAtributo(atributo.id, datos),
    onSuccess:  () => { invalidarArbol(); setEditando(false); },
    onError:    (e) => setErrorM(e.response?.data?.error || 'Error'),
  });
  const mutEliminarAtr = useMutation({
    mutationFn: () => eliminarAtributo(atributo.id),
    onSuccess:  invalidarArbol,
    onError:    (e) => alert(e.response?.data?.error || 'Error al eliminar'),
  });
  const mutCrearVar = useMutation({
    mutationFn: (datos) => crearVariante(atributo.id, datos),
    onSuccess:  () => { invalidarArbol(); setModalVariante(false); },
    onError:    (e) => setErrorM(e.response?.data?.error || 'Error'),
  });

  const agregarItem = useCarritoStore((s) => s.agregarItem);

  const tieneVariantes = atributo.variantes && atributo.variantes.length > 0;
  const sinStock       = atributo.stock === 0;

  const handleAgregarAtributo = () => {
    agregarItem({
      key:            `cant-${producto.id}-a-${atributo.id}`,
      tipo:           'cantidad',
      nombre:         producto.nombre,
      producto_id:    producto.id,
      atributo_id:    atributo.id,
      atributo_label: label(atributo),
      precio:         Math.round(Number(atributo.precio || producto.precio || 0)),
      stock:          atributo.stock,
      cantidad:       1,
      linea_id:       producto.linea_id || null,
    });
  };

  const handleAgregarVariante = (atr, variante) => {
    agregarItem({
      key:            `cant-${producto.id}-v-${variante.id}`,
      tipo:           'cantidad',
      nombre:         producto.nombre,
      producto_id:    producto.id,
      atributo_id:    atr.id,
      variante_id:    variante.id,
      atributo_label: label(atr),
      variante_label: label(variante),
      precio:         Math.round(Number(variante.precio || atr.precio || producto.precio || 0)),
      stock:          variante.stock,
      cantidad:       1,
      linea_id:       producto.linea_id || null,
    });
  };

  // Para variantes nuevas, excluir el tipo del atributo padre para no repetirlo
  const tiposParaVariante = tipos.filter((t) => t.id !== atributo.tipo_id);

  return (
    <div className="flex flex-col gap-1.5">
      {/* Encabezado del atributo */}
      <div className={`flex items-center gap-2 p-3 rounded-xl border
        ${sinStock ? 'bg-gray-50 border-gray-100' : 'bg-blue-50/50 border-blue-100'}`}>
        <button onClick={() => setExpandido((v) => !v)} className="text-gray-400 flex-shrink-0">
          {expandido ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800">{label(atributo)}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-sm font-bold tabular-nums ${colorStock(atributo.stock, atributo.stock_minimo)}`}>
              {atributo.stock}
            </span>
            <span className="text-xs text-gray-400">uds</span>
            {atributo.precio && (
              <span className="text-xs text-gray-500 ml-1">{formatCOP(atributo.precio)}</span>
            )}
            {atributo.stock <= atributo.stock_minimo && atributo.stock > 0 && atributo.stock_minimo > 0 && (
              <AlertTriangle size={11} className="text-amber-400" />
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {esAdmin && (
            <>
              <button onClick={() => setEditando(true)}
                className="p-1.5 rounded-lg hover:bg-white text-gray-400 hover:text-gray-600 transition-colors">
                <Settings size={13} />
              </button>
              <button onClick={() => mutEliminarAtr.mutate()} disabled={mutEliminarAtr.isPending}
                className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                <Trash2 size={13} />
              </button>
              <button onClick={() => { setModalVariante(true); setErrorM(''); }}
                className="p-1.5 rounded-lg hover:bg-blue-100 text-blue-400 hover:text-blue-600 transition-colors"
                title="Agregar variante">
                <Plus size={13} />
              </button>
            </>
          )}
          {/* Botón agregar al carrito solo si NO tiene variantes (es nodo hoja) */}
          {!tieneVariantes && (
            <Button size="sm" disabled={sinStock} onClick={handleAgregarAtributo}>
              <ShoppingCart size={13} />
              <span className="hidden sm:inline">{sinStock ? 'Sin stock' : 'Agregar'}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Variantes anidadas */}
      {expandido && tieneVariantes && (
        <div className="flex flex-col gap-1.5 ml-4">
          {atributo.variantes.map((v) => (
            <FilaVariante
              key={v.id}
              variante={v}
              atributo={atributo}
              producto={producto}
              sucursalId={sucursalId}
              tipos={tiposParaVariante}
              esAdmin={esAdmin}
              onAgregar={handleAgregarVariante}
            />
          ))}
        </div>
      )}

      {/* Modales */}
      {editando && (
        <ModalNodo
          open={editando}
          onClose={() => { setEditando(false); setErrorM(''); }}
          titulo={`Editar — ${label(atributo)}`}
          tipos={tipos}
          datoInicial={atributo}
          onGuardar={(d) => mutEditarAtr.mutate(d)}
          isPending={mutEditarAtr.isPending}
          error={errorM}
        />
      )}
      {modalVariante && (
        <ModalNodo
          open={modalVariante}
          onClose={() => { setModalVariante(false); setErrorM(''); }}
          titulo="Nueva variante"
          tipos={tiposParaVariante}
          onGuardar={(d) => mutCrearVar.mutate(d)}
          isPending={mutCrearVar.isPending}
          error={errorM}
        />
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function VistaArbolProducto({ producto, sucursalId, esAdmin, onClose }) {
  const queryClient = useQueryClient();
  const [modalAtributo, setModalAtributo] = useState(false);
  const [errorM,        setErrorM]        = useState('');

  const { data: arbol = [], isLoading } = useQuery({
    queryKey: ['arbol-producto', producto.id, sucursalId],
    queryFn:  () => getArbol(producto.id, sucursalId).then((r) => r.data.data),
    staleTime: 0,
  });

  const { data: tiposData } = useQuery({
    queryKey: ['tipos-caracteristica'],
    queryFn:  () => import('../../api/tiposCaracteristicaApi').then((m) => m.getTipos()).then((r) => r.data.data),
  });
  const tipos = tiposData || [];

  const agregarItem = useCarritoStore((s) => s.agregarItem);

  const mutCrearAtributo = useMutation({
    mutationFn: (datos) => crearAtributo(producto.id, datos),
    onSuccess:  () => {
      queryClient.invalidateQueries({ queryKey: ['arbol-producto', producto.id, sucursalId] });
      setModalAtributo(false);
    },
    onError: (e) => setErrorM(e.response?.data?.error || 'Error'),
  });

  const tieneAtributos = arbol.length > 0;

  const stockTotal = tieneAtributos
    ? arbol.reduce((s, a) => s + (Number(a.stock) || 0), 0)
    : producto.stock;

  const handleAgregarDirecto = () => {
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
  };

  return (
    /* Overlay + panel */
    <div className="fixed inset-0 z-40 flex justify-end sm:items-stretch" onClick={onClose}>
      <div
        className="relative w-full sm:w-[420px] bg-white shadow-2xl flex flex-col
          rounded-t-3xl sm:rounded-none overflow-hidden
          animate-in slide-in-from-bottom sm:slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-5 border-b border-gray-100">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Layers size={16} className="text-blue-600 flex-shrink-0" />
              <p className="font-bold text-gray-900 truncate">{producto.nombre}</p>
            </div>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className={`text-2xl font-bold tabular-nums ${colorStock(stockTotal)}`}>
                {stockTotal}
              </span>
              <span className="text-sm text-gray-400">unidades totales</span>
              {producto.precio && (
                <span className="text-sm font-semibold text-gray-600 ml-2">
                  {formatCOP(producto.precio)}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* Cuerpo */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {isLoading ? (
            <Spinner className="py-16" />
          ) : !tieneAtributos ? (
            /* Sin atributos: botón directo + opción de crear primero */
            <div className="flex flex-col gap-4">
              <p className="text-sm text-gray-400 text-center py-2">
                Este producto no tiene desglose por atributos.
              </p>
              <Button
                className="w-full"
                disabled={producto.stock === 0}
                onClick={handleAgregarDirecto}
              >
                <ShoppingCart size={15} />
                {producto.stock === 0 ? 'Sin stock' : 'Agregar al carrito'}
              </Button>
              {esAdmin && (
                <button
                  onClick={() => { setModalAtributo(true); setErrorM(''); }}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl
                    border-2 border-dashed border-gray-200 text-gray-400 hover:border-blue-300
                    hover:text-blue-500 transition-colors text-sm"
                >
                  <Plus size={14} />
                  Agregar primer atributo (ej: Talla M)
                </button>
              )}
            </div>
          ) : (
            /* Con atributos */
            <div className="flex flex-col gap-2">
              {arbol.map((atributo) => (
                <FilaAtributo
                  key={atributo.id}
                  atributo={atributo}
                  producto={producto}
                  sucursalId={sucursalId}
                  tipos={tipos}
                  esAdmin={esAdmin}
                />
              ))}

              {esAdmin && (
                <button
                  onClick={() => { setModalAtributo(true); setErrorM(''); }}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl
                    border-2 border-dashed border-gray-200 text-gray-400 hover:border-blue-300
                    hover:text-blue-500 transition-colors text-sm mt-1"
                >
                  <Plus size={14} />
                  Agregar atributo
                </button>
              )}
            </div>
          )}
        </div>

        {/* Modal agregar atributo */}
        {modalAtributo && (
          <ModalNodo
            open={modalAtributo}
            onClose={() => { setModalAtributo(false); setErrorM(''); }}
            titulo="Nuevo atributo"
            tipos={tipos}
            onGuardar={(d) => mutCrearAtributo.mutate(d)}
            isPending={mutCrearAtributo.isPending}
            error={errorM}
          />
        )}
      </div>
    </div>
  );
}
