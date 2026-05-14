import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getTipos, crearTipo, actualizarTipo, eliminarTipo } from '../../../api/tiposCaracteristicaApi';
import { Modal }  from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { Input }  from '../../../components/ui/Input';
import { Layers, Plus, Trash2, Settings, ToggleLeft, ToggleRight, X } from 'lucide-react';

function Toggle({ enabled, onChange, label, description }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {description && <span className="text-xs text-gray-400">{description}</span>}
      </div>
      <button type="button" onClick={() => onChange(!enabled)} className="flex-shrink-0 transition-colors" aria-pressed={enabled}>
        {enabled
          ? <ToggleRight size={28} className="text-blue-600" />
          : <ToggleLeft  size={28} className="text-gray-300" />}
      </button>
    </div>
  );
}

// ─── Chip de valor con botón de borrar ────────────────────────────────────────
function ValorChip({ valor, onRemove }) {
  return (
    <span className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 border border-blue-100 text-blue-700 text-xs rounded-full">
      {valor}
      <button type="button" onClick={onRemove} className="hover:text-red-500 transition-colors ml-0.5">
        <X size={11} />
      </button>
    </span>
  );
}

// ─── Modal de crear / editar tipo ────────────────────────────────────────────
function ModalTipo({ open, onClose, editando, onSuccess }) {
  const queryClient = useQueryClient();
  const [nombre,    setNombre]    = useState(editando?.nombre || '');
  const [orden,     setOrden]     = useState(editando?.orden ?? 0);
  const [valores,   setValores]   = useState(
    Array.isArray(editando?.valores) ? [...editando.valores] : []
  );
  const [nuevoValor, setNuevoValor] = useState('');
  const [error,      setError]      = useState('');

  const mutCrear = useMutation({
    mutationFn: () => crearTipo({ nombre, valores, orden }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['tipos-caracteristica'] }); onSuccess(); },
    onError: (e) => setError(e.response?.data?.error || 'Error al crear'),
  });

  const mutEditar = useMutation({
    mutationFn: () => actualizarTipo(editando.id, { nombre, valores, orden }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['tipos-caracteristica'] }); onSuccess(); },
    onError: (e) => setError(e.response?.data?.error || 'Error al actualizar'),
  });

  const agregarValor = () => {
    const limpio = nuevoValor.trim();
    if (!limpio) return;
    if (valores.includes(limpio)) { setError('Este valor ya existe'); return; }
    setValores((v) => [...v, limpio]);
    setNuevoValor('');
    setError('');
  };

  const quitarValor = (v) => setValores((prev) => prev.filter((x) => x !== v));

  const handleGuardar = () => {
    if (!nombre.trim()) return setError('El nombre es requerido');
    editando ? mutEditar.mutate() : mutCrear.mutate();
  };

  const isPending = mutCrear.isPending || mutEditar.isPending;

  return (
    <Modal open={open} onClose={onClose} title={editando ? 'Editar tipo' : 'Nuevo tipo de característica'} size="sm">
      <div className="flex flex-col gap-4">
        <Input
          label="Nombre del tipo"
          placeholder="Ej: Talla, Color, Material, Número..."
          value={nombre}
          onChange={(e) => { setNombre(e.target.value); setError(''); }}
          autoFocus
        />
        <Input
          label="Orden (número)"
          type="number"
          value={orden}
          onChange={(e) => setOrden(Number(e.target.value))}
        />

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-700">
            Valores posibles
            <span className="text-xs text-gray-400 font-normal ml-1">(opcionales — sirven como sugerencias)</span>
          </label>

          {valores.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {valores.map((v) => (
                <ValorChip key={v} valor={v} onRemove={() => quitarValor(v)} />
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={nuevoValor}
              onChange={(e) => { setNuevoValor(e.target.value); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregarValor(); } }}
              placeholder="Ej: S, M, L, XL — presiona Enter para agregar"
              className="flex-1 px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm text-gray-900
                placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
            />
            <button
              type="button"
              onClick={agregarValor}
              className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center hover:bg-blue-700 transition-colors flex-shrink-0"
            >
              <Plus size={15} className="text-white" />
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={isPending} onClick={handleGuardar} disabled={!nombre.trim()}>
            {editando ? 'Guardar cambios' : 'Crear tipo'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export function TiposCaracteristicaConfig({ valores, set }) {
  const queryClient                   = useQueryClient();
  const [modalOpen,   setModalOpen]   = useState(false);
  const [editando,    setEditando]    = useState(null);

  const activo = valores['variantes_activo'] === '1';

  const { data: tipos = [] } = useQuery({
    queryKey: ['tipos-caracteristica'],
    queryFn:  () => getTipos().then((r) => r.data.data),
    enabled:  activo,
  });

  const mutEliminar = useMutation({
    mutationFn: (id) => eliminarTipo(id),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['tipos-caracteristica'] }),
    onError:    (e) => alert(e.response?.data?.error || 'Error al eliminar'),
  });

  const abrirNuevo  = () => { setEditando(null); setModalOpen(true); };
  const abrirEditar = (t) => { setEditando(t);   setModalOpen(true); };
  const cerrarModal = () => { setModalOpen(false); setEditando(null); };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Layers size={15} className="text-gray-400" />
        <h3 className="text-sm font-semibold text-gray-700">Variantes de producto</h3>
      </div>
      <p className="text-xs text-gray-400 -mt-2">
        Permite desglosar el stock de un producto por características como Talla o Color.
        Ideal para tiendas de ropa, calzado, o cualquier negocio con variantes.
      </p>

      <Toggle
        label="Activar variantes de producto"
        description="Habilita el árbol de atributos en productos por cantidad"
        enabled={activo}
        onChange={(val) => set('variantes_activo', val ? '1' : '0')}
      />

      {activo && (
        <div className="flex flex-col gap-3 pt-1">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-600">Tipos de característica</p>
            <button
              onClick={abrirNuevo}
              className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center hover:bg-blue-700 transition-colors"
            >
              <Plus size={15} className="text-white" />
            </button>
          </div>

          {tipos.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-3">
              Sin tipos configurados. Agrega uno (ej: Talla, Color).
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {[...tipos].sort((a, b) => a.orden - b.orden).map((tipo) => (
                <div key={tipo.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-800">{tipo.nombre}</p>
                      {tipo.orden !== 0 && (
                        <span className="text-xs text-gray-400">orden {tipo.orden}</span>
                      )}
                    </div>
                    {Array.isArray(tipo.valores) && tipo.valores.length > 0 ? (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {tipo.valores.map((v) => (
                          <span key={v} className="text-xs bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
                            {v}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 mt-1">Sin valores predefinidos</p>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={() => abrirEditar(tipo)}
                      className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <Settings size={14} />
                    </button>
                    <button
                      onClick={() => mutEliminar.mutate(tipo.id)}
                      disabled={mutEliminar.isPending}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {modalOpen && (
        <ModalTipo
          open={modalOpen}
          onClose={cerrarModal}
          editando={editando}
          onSuccess={cerrarModal}
        />
      )}
    </div>
  );
}
