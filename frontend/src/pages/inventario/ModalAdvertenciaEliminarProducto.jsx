// src/pages/productos/ModalAdvertenciaEliminarProducto.jsx
import { Modal }  from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { AlertTriangle } from 'lucide-react';

/**
 * Modal que aparece cuando se intenta eliminar un producto serial
 * que tiene seriales vendidos o prestados.
 *
 * Props:
 *   detalle   — { disponibles, prestados, vendidos, total }
 *   producto  — { nombre }
 *   loading   — boolean
 *   onConfirmar — callback cuando el usuario acepta el riesgo
 *   onCancelar  — callback para cerrar sin hacer nada
 */
export function ModalAdvertenciaEliminarProducto({ detalle, producto, loading, onConfirmar, onCancelar }) {
  const tieneVendidos  = detalle.vendidos  > 0;
  const tienePrestados = detalle.prestados > 0;

  return (
    <Modal open onClose={onCancelar} title="Advertencia — Seriales comprometidos" size="sm">
      <div className="flex flex-col gap-4">

        {/* Ícono y resumen */}
        <div className="flex flex-col items-center gap-3 py-2">
          <div className="w-14 h-14 rounded-full bg-red-50 border-2 border-red-200
            flex items-center justify-center">
            <AlertTriangle size={26} className="text-red-500" />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-gray-900">
              {producto?.nombre}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Este producto tiene seriales que no son simplemente disponibles
            </p>
          </div>
        </div>

        {/* Contadores */}
        <div className="grid grid-cols-3 gap-2">
          {detalle.disponibles > 0 && (
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-gray-700">{detalle.disponibles}</p>
              <p className="text-xs text-gray-400">Disponible{detalle.disponibles !== 1 ? 's' : ''}</p>
            </div>
          )}
          {tienePrestados && (
            <div className="bg-blue-50 rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-blue-600">{detalle.prestados}</p>
              <p className="text-xs text-blue-400">Prestado{detalle.prestados !== 1 ? 's' : ''}</p>
            </div>
          )}
          {tieneVendidos && (
            <div className="bg-red-50 rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-red-600">{detalle.vendidos}</p>
              <p className="text-xs text-red-400">Vendido{detalle.vendidos !== 1 ? 's' : ''}</p>
            </div>
          )}
        </div>

        {/* Advertencias según tipo */}
        <div className="flex flex-col gap-2">
          {tieneVendidos && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <p className="text-xs font-semibold text-red-700 mb-1">
                ⚠️ {detalle.vendidos} serial{detalle.vendidos !== 1 ? 'es' : ''} vendido{detalle.vendidos !== 1 ? 's' : ''}
              </p>
              <p className="text-xs text-red-600 leading-relaxed">
                Al eliminar, las facturas asociadas a estos IMEI quedarán sin referencia de costo.
                No podrás actualizar el costo de compra desde reportes ni rastrear el serial.
              </p>
            </div>
          )}
          {tienePrestados && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
              <p className="text-xs font-semibold text-blue-700 mb-1">
                ⚠️ {detalle.prestados} serial{detalle.prestados !== 1 ? 'es' : ''} prestado{detalle.prestados !== 1 ? 's' : ''}
              </p>
              <p className="text-xs text-blue-600 leading-relaxed">
                Al eliminar, los préstamos activos de estos equipos quedarán sin referencia.
                No podrás hacer seguimiento del equipo prestado.
              </p>
            </div>
          )}
        </div>

        {/* Confirmación final */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-600 leading-relaxed">
            Si de todas formas deseas eliminar el producto y <strong>todos sus seriales</strong>,
            presiona confirmar. Esta acción <strong>no se puede deshacer</strong>.
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button
            className="flex-1 bg-red-600 hover:bg-red-700 text-white"
            loading={loading}
            onClick={onConfirmar}
          >
            Entiendo el riesgo, eliminar
          </Button>
        </div>
      </div>
    </Modal>
  );
}