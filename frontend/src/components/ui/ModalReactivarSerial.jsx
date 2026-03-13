// ═══════════════════════════════════════════════════════════════════
// ARCHIVO: src/components/ui/ModalReactivarSerial.jsx
// ═══════════════════════════════════════════════════════════════════
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

/**
 * Modal de confirmación cuando se detecta que un IMEI ya existe en el negocio.
 * Le pregunta al usuario si desea reactivar ese serial en el inventario.
 *
 * Props:
 *   open          — boolean
 *   serial        — objeto con datos del serial encontrado
 *   onReactivar   — fn() → usuario confirma reactivación
 *   onCancelar    — fn() → usuario descarta, limpia el campo IMEI
 */
export function ModalReactivarSerial({ open, serial, onReactivar, onCancelar }) {
  if (!serial) return null;

  const estadoLabel = serial.vendido
    ? 'Vendido'
    : serial.prestado
    ? 'Prestado'
    : 'En inventario';

  const estadoColor = serial.vendido
    ? 'text-red-600 bg-red-50 border-red-200'
    : serial.prestado
    ? 'text-yellow-700 bg-yellow-50 border-yellow-200'
    : 'text-green-700 bg-green-50 border-green-200';

  return (
    <Modal open={open} onClose={onCancelar} title="" size="sm">
      <div className="flex flex-col items-center gap-4 py-2">

        {/* Ícono de alerta */}
        <div className="w-14 h-14 rounded-full bg-amber-50 border-2 border-amber-200
          flex items-center justify-center">
          <AlertTriangle size={26} className="text-amber-500" />
        </div>

        {/* Título */}
        <div className="text-center">
          <h3 className="text-base font-semibold text-gray-900">
            IMEI ya registrado en el negocio
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            Este equipo aparece en el historial del inventario
          </p>
        </div>

        {/* Datos del serial encontrado */}
        <div className="w-full rounded-xl border border-gray-100 bg-gray-50 p-3 flex flex-col gap-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">IMEI</span>
            <span className="font-mono font-medium text-gray-900">{serial.imei}</span>
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Producto</span>
            <span className="font-medium text-gray-900 text-right max-w-[60%]">
              {serial.producto_nombre}
              {serial.marca ? ` · ${serial.marca}` : ''}
            </span>
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Sucursal</span>
            <span className="text-gray-700">{serial.sucursal_nombre}</span>
          </div>

          {serial.cliente_origen && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Cliente origen</span>
              <span className="text-gray-700">{serial.cliente_origen}</span>
            </div>
          )}

          <div className="flex justify-between text-sm items-center">
            <span className="text-gray-500">Estado actual</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${estadoColor}`}>
              {estadoLabel}
            </span>
          </div>
        </div>

        {/* Pregunta clave */}
        <p className="text-sm text-center text-gray-700 leading-relaxed">
          ¿Deseas <span className="font-semibold text-purple-700">reactivar este serial</span> en
          el inventario? Se marcará como disponible nuevamente.
        </p>

        {/* Acciones */}
        <div className="flex gap-2 w-full">
          <Button
            variant="secondary"
            className="flex-1 flex items-center justify-center gap-1.5"
            onClick={onCancelar}
          >
            <X size={14} />
            Cancelar
          </Button>
          <Button
            className="flex-1 flex items-center justify-center gap-1.5
              bg-purple-600 hover:bg-purple-700 text-white"
            onClick={onReactivar}
          >
            <RefreshCw size={14} />
            Sí, reactivar
          </Button>
        </div>
      </div>
    </Modal>
  );
}


// ═══════════════════════════════════════════════════════════════════
// ARCHIVO: src/features/ventas/RetomaSerial.jsx  (reemplaza el actual)
// ═══════════════════════════════════════════════════════════════════


/*
 * NOTA IMPORTANTE — Apertura automática del modal:
 * En el componente real, agrega este useEffect para abrir el modal
 * automáticamente cuando el IMEI es encontrado:
 *
 *   import { useEffect } from 'react';
 *
 *   useEffect(() => {
 *     if (estado.tipo === 'encontrado') {
 *       setModalReactivar(true);
 *     }
 *   }, [estado.tipo]);
 *
 * El patrón inline no funciona durante el render; el useEffect sí.
 */