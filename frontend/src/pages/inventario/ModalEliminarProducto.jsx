// src/pages/productos/ModalEliminarProducto.jsx
import { useState }                    from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Trash2, Eye, EyeOff } from 'lucide-react';
import { Modal }  from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input }  from '../../components/ui/Input';
import { verificarPin }                from '../../api/config.api';
import { eliminarProductoSerial, eliminarProductoCantidad } from '../../api/productos.api';
import { ModalAdvertenciaEliminarProducto } from './ModalAdvertenciaEliminarProducto';

// ─── Tipos soportados ─────────────────────────────────────────────────────────
export const TIPO_PRODUCTO_SERIAL   = 'serial';
export const TIPO_PRODUCTO_CANTIDAD = 'cantidad';

// ─── Helpers internos ─────────────────────────────────────────────────────────
const _mutationFnPorTipo = (tipo, id, forzar = false) => {
  if (tipo === TIPO_PRODUCTO_SERIAL)   return eliminarProductoSerial(id, forzar);
  if (tipo === TIPO_PRODUCTO_CANTIDAD) return eliminarProductoCantidad(id);
  throw new Error(`Tipo de producto desconocido: ${tipo}`);
};

const _queryKeysPorTipo = (tipo) => {
  if (tipo === TIPO_PRODUCTO_SERIAL)   return ['productos-serial'];
  if (tipo === TIPO_PRODUCTO_CANTIDAD) return ['productos-cantidad'];
  return [];
};

// ─── Modal principal ──────────────────────────────────────────────────────────

export function ModalEliminarProducto({ producto, tipo, onClose, onSuccess }) {
  const queryClient = useQueryClient();

  const [pin,         setPin]         = useState('');
  const [verPin,      setVerPin]      = useState(false);
  const [error,       setError]       = useState('');
  const [verificando, setVerificando] = useState(false);

  // Estado para mostrar modal de advertencia cuando hay seriales comprometidos
  const [advertencia, setAdvertencia] = useState(null); // null | { detalle }

  const stockActual = Number(producto.stock ?? 0);
  const tieneStock  = tipo === TIPO_PRODUCTO_CANTIDAD && stockActual > 0;

  // ── Mutación de eliminación ───────────────────────────────────────────────
  const mutation = useMutation({
    mutationFn: (forzar = false) => _mutationFnPorTipo(tipo, producto.id, forzar),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: _queryKeysPorTipo(tipo), exact: false });
      onSuccess?.();
      onClose();
    },
    onError: (err) => {
      const code    = err.response?.data?.code;
      const detalle = err.response?.data?.detalle;

      // Si hay seriales comprometidos o disponibles → mostrar advertencia
      if (
        (code === 'SERIALES_COMPROMETIDOS' || code === 'SERIALES_DISPONIBLES') &&
        detalle
      ) {
        setAdvertencia({ detalle });
        return;
      }

      setError(err.response?.data?.error || 'Error al eliminar el producto');
    },
  });

  // ── Verificar PIN y luego intentar eliminar ───────────────────────────────
  const handleConfirmar = async () => {
    if (!pin.trim()) { setError('Ingresa el PIN'); return; }

    setVerificando(true);
    setError('');

    try {
      const res = await verificarPin(pin.trim());
      if (!res.data.valido) { setError('PIN incorrecto'); return; }
      // Primera llamada sin forzar — el backend dirá si hay seriales comprometidos
      mutation.mutate(false);
    } catch {
      setError('Error al verificar el PIN. Intenta de nuevo.');
    } finally {
      setVerificando(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleConfirmar();
  };

  // ── Confirmar eliminación forzada (desde modal de advertencia) ────────────
  const handleForzarEliminacion = () => {
    setAdvertencia(null);
    mutation.mutate(true);
  };

  return (
    <>
      <Modal open onClose={onClose} title="Eliminar producto" size="sm">
        <div className="flex flex-col gap-4">

          {/* Descripción del producto */}
          <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            <Trash2 size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-semibold text-red-700">{producto.nombre}</p>
              <p className="text-xs text-red-500">
                Esta acción es permanente y no se puede deshacer.
              </p>
            </div>
          </div>

          {/* Advertencia de stock (solo tipo cantidad) */}
          {tieneStock && (
            <div className="flex items-start gap-3 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3">
              <AlertTriangle size={16} className="text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-700">
                Este producto tiene{' '}
                <span className="font-semibold">
                  {stockActual} unidad{stockActual !== 1 ? 'es' : ''}
                </span>{' '}
                en stock. Al eliminarlo se perderá todo el inventario asociado.
              </p>
            </div>
          )}

          {/* PIN de seguridad */}
          <div className="relative">
            <Input
              label="PIN de seguridad"
              type={verPin ? 'text' : 'password'}
              placeholder="••••"
              value={pin}
              onChange={(e) => { setPin(e.target.value); setError(''); }}
              onKeyDown={handleKeyDown}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setVerPin((v) => !v)}
              className="absolute right-3 top-8 text-gray-400 hover:text-gray-600 transition-colors"
              tabIndex={-1}
            >
              {verPin ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {error && <p className="text-sm text-red-500 -mt-1">{error}</p>}

          {/* Acciones */}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={onClose}
              disabled={verificando || mutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              loading={verificando || mutation.isPending}
              onClick={handleConfirmar}
              disabled={!pin.trim()}
            >
              <Trash2 size={14} />
              Eliminar
            </Button>
          </div>

        </div>
      </Modal>

      {/* Modal de advertencia cuando hay seriales comprometidos */}
      {advertencia && (
        <ModalAdvertenciaEliminarProducto
          detalle={advertencia.detalle}
          producto={producto}
          loading={mutation.isPending}
          onConfirmar={handleForzarEliminacion}
          onCancelar={() => setAdvertencia(null)}
        />
      )}
    </>
  );
}