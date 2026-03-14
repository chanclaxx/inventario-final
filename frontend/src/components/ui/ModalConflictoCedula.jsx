import { Modal }         from './Modal';
import { Button }        from './Button';
import { AlertTriangle } from 'lucide-react';

/**
 * Modal BLOQUEANTE que aparece al confirmar una factura cuando la cédula
 * ingresada ya pertenece a un cliente con datos diferentes.
 *
 * No puede cerrarse con Escape ni clic fuera — el usuario DEBE elegir
 * una de las dos opciones explícitas.
 *
 * Props:
 *   open       — boolean
 *   conflicto  — { clienteExistente, datosNuevos } | null
 *   onReescribir      — async () => void
 *   onCancelar        — () => void
 *   guardando         — boolean
 */
export function ModalConflictoCedula({ open, conflicto, onReescribir, onCancelar, guardando }) {
  // NO hacer early return antes del Modal.
  // El guard "if (!conflicto) return null" impedía el render cuando open
  // cambiaba a true simultáneamente con el set del conflicto.
  // Usamos optional chaining para acceder a los datos de forma segura.
  const clienteExistente = conflicto?.clienteExistente;
  const datosNuevos      = conflicto?.datosNuevos;

  const nombreCambio    = clienteExistente && datosNuevos
    ? clienteExistente.nombre     !== datosNuevos.nombre
    : false;
  const celularCambio   = clienteExistente && datosNuevos
    ? (clienteExistente.celular   || '') !== (datosNuevos.celular   || '')
    : false;
  const emailCambio     = clienteExistente && datosNuevos
    ? (clienteExistente.email     || '') !== (datosNuevos.email     || '')
    : false;
  const direccionCambio = clienteExistente && datosNuevos
    ? (clienteExistente.direccion || '') !== (datosNuevos.direccion || '')
    : false;

  return (
    <Modal
      open={open}
      onClose={() => {}} // bloqueante: no se cierra con clic fuera ni Escape
      title=""
      size="sm"
    >
      {/* Solo renderizar contenido cuando hay conflicto real */}
      {clienteExistente && datosNuevos && (
        <div className="flex flex-col items-center gap-4 py-2">

          {/* Icono */}
          <div className="w-14 h-14 rounded-full bg-amber-50 border-2 border-amber-200
            flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={26} className="text-amber-500" />
          </div>

          {/* Título */}
          <div className="text-center">
            <h3 className="text-base font-semibold text-gray-900">
              Esta cédula ya está registrada
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              Los datos que ingresaste son diferentes a los registrados.
            </p>
          </div>

          {/* Tabla comparativa */}
          <div className="w-full rounded-xl border border-gray-100 bg-gray-50 p-3 flex flex-col gap-2.5 text-sm">
            <div className="flex justify-between items-center gap-2">
              <span className="text-gray-400 text-xs uppercase tracking-wide w-20 flex-shrink-0">Campo</span>
              <span className="text-gray-400 text-xs uppercase tracking-wide flex-1 text-center">Registrado</span>
              <span className="text-gray-400 text-xs uppercase tracking-wide flex-1 text-center">Ingresado</span>
            </div>

            <div className="w-full h-px bg-gray-200" />

            <FilaComparacion
              label="Cédula"
              original={clienteExistente.cedula}
              nuevo={clienteExistente.cedula}
              cambio={false}
            />

            {nombreCambio && (
              <FilaComparacion
                label="Nombre"
                original={clienteExistente.nombre}
                nuevo={datosNuevos.nombre}
                cambio
              />
            )}

            {celularCambio && (
              <FilaComparacion
                label="Celular"
                original={clienteExistente.celular || '—'}
                nuevo={datosNuevos.celular || '—'}
                cambio
              />
            )}

            {emailCambio && (
              <FilaComparacion
                label="Email"
                original={clienteExistente.email || '—'}
                nuevo={datosNuevos.email || '—'}
                cambio
              />
            )}

            {direccionCambio && (
              <FilaComparacion
                label="Dirección"
                original={clienteExistente.direccion || '—'}
                nuevo={datosNuevos.direccion || '—'}
                cambio
              />
            )}
          </div>

          {/* Explicación de acciones */}
          <div className="w-full flex flex-col gap-1.5 text-xs text-gray-500 bg-gray-50
            rounded-xl px-3 py-2.5 border border-gray-100">
            <p>
              <span className="font-semibold text-blue-700">Reescribir datos:</span>
              {' '}actualiza el cliente con los datos que ingresaste y confirma la factura.
            </p>
            <p>
              <span className="font-semibold text-gray-600">Cancelar:</span>
              {' '}vuelve al formulario con los datos originales del cliente para que los revises.
            </p>
          </div>

          {/* Botones */}
          <div className="flex gap-2 w-full">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={onCancelar}
              disabled={guardando}
            >
              Cancelar
            </Button>
            <Button
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
              loading={guardando}
              onClick={onReescribir}
            >
              Reescribir datos
            </Button>
          </div>

        </div>
      )}
    </Modal>
  );
}

// ─── Fila de comparación ──────────────────────────────────────────────────────

function FilaComparacion({ label, original, nuevo, cambio }) {
  return (
    <div className="flex justify-between items-start gap-2 text-sm">
      <span className="text-gray-500 w-20 flex-shrink-0 pt-0.5">{label}</span>
      <span className={`flex-1 text-center text-right ${cambio ? 'line-through text-gray-400' : 'text-gray-700 font-mono'}`}>
        {original}
      </span>
      <span className={`flex-1 text-center text-right ${cambio ? 'font-semibold text-blue-700' : 'text-gray-700 font-mono'}`}>
        {nuevo}
      </span>
    </div>
  );
}