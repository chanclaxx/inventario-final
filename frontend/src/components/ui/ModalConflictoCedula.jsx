import { Modal }  from './Modal';
import { Button } from './Button';
import { AlertTriangle } from 'lucide-react';

/**
 * Modal bloqueante que aparece cuando la cédula ingresada ya pertenece
 * a un cliente con nombre diferente.
 *
 * Props:
 *   open              — boolean
 *   conflicto         — { clienteExistente, datosNuevos }
 *   onRenombrar       — () => void  → actualiza cliente y continúa
 *   onContinuarSinActualizar — () => void  → ignora y continúa con datos escritos
 */
export function ModalConflictoCedula({ open, conflicto, onRenombrar, onContinuarSinActualizar }) {
  if (!conflicto) return null;

  const { clienteExistente, datosNuevos } = conflicto;

  return (
    <Modal open={open} onClose={onContinuarSinActualizar} title="" size="sm">
      <div className="flex flex-col items-center gap-4 py-2">

        {/* Icono */}
        <div className="w-14 h-14 rounded-full bg-amber-50 border-2 border-amber-200
          flex items-center justify-center flex-shrink-0">
          <AlertTriangle size={26} className="text-amber-500" />
        </div>

        {/* Título */}
        <div className="text-center">
          <h3 className="text-base font-semibold text-gray-900">
            Cédula ya registrada
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            Esta cédula pertenece a un cliente con un nombre diferente.
          </p>
        </div>

        {/* Comparación */}
        <div className="w-full rounded-xl border border-gray-100 bg-gray-50 p-3 flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Cédula</span>
            <span className="font-mono font-medium text-gray-900">
              {clienteExistente.cedula}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Nombre registrado</span>
            <span className="font-medium text-gray-900 text-right max-w-[55%]">
              {clienteExistente.nombre}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Nombre ingresado</span>
            <span className="font-medium text-amber-700 text-right max-w-[55%]">
              {datosNuevos.nombre}
            </span>
          </div>
          {clienteExistente.celular && (
            <div className="flex justify-between">
              <span className="text-gray-500">Celular registrado</span>
              <span className="text-gray-700">{clienteExistente.celular}</span>
            </div>
          )}
        </div>

        {/* Descripción de las acciones */}
        <div className="w-full flex flex-col gap-1.5 text-xs text-gray-500">
          <p>
            <span className="font-semibold text-purple-700">Renombrar:</span>
            {' '}actualiza el nombre, celular, email y dirección del cliente en el sistema.
          </p>
          <p>
            <span className="font-semibold text-gray-600">Continuar sin actualizar:</span>
            {' '}la factura se guardará con los datos que escribiste, sin modificar el cliente.
          </p>
        </div>

        {/* Botones */}
        <div className="flex gap-2 w-full">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={onContinuarSinActualizar}
          >
            Continuar sin actualizar
          </Button>
          <Button
            className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
            onClick={onRenombrar}
          >
            Renombrar y actualizar
          </Button>
        </div>

      </div>
    </Modal>
  );
}