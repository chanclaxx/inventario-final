import { useState, useCallback } from 'react';
import { buscarPorCedula, actualizarCliente } from '../api/clientes.api';

/**
 * Hook compartido para la lógica de cédula única por cliente.
 *
 * El flujo ocurre al momento de confirmar la factura (en handleSubmit),
 * no al perder el foco del campo cédula.
 *
 * 1. verificarCedula(form) — llamar ANTES de ejecutar la mutación:
 *    - Cédula no existe en BD   → retorna true  (el backend crea el cliente)
 *    - Existe, mismos datos     → retorna true  (sin cambios necesarios)
 *    - Existe, datos distintos  → guarda el conflicto, retorna false
 *      → el componente detiene el submit y muestra <ModalConflictoCedula>
 *
 * 2. Usuario elige "Reescribir datos":
 *    - reescribirCliente() actualiza el cliente en BD y libera el conflicto
 *    - El componente reintenta el submit automáticamente
 *
 * 3. Usuario elige "Cancelar":
 *    - cancelarConflicto(setForm) restaura el form con los datos del cliente
 *      registrado en BD (el usuario debe revisar y volver a confirmar)
 *    - No se hace ningún cambio en BD
 *
 * Uso:
 *   const {
 *     conflictoCliente,   // { clienteExistente, datosNuevos } | null
 *     verificarCedula,    // async (form) => boolean
 *     reescribirCliente,  // async () => void
 *     cancelarConflicto,  // (setForm) => void
 *   } = useCedulaCliente();
 */
export function useCedulaCliente() {
  const [conflictoCliente, setConflictoCliente] = useState(null);
  // conflictoCliente = { clienteExistente, datosNuevos } | null

  /**
   * Verifica si la cédula del form colisiona con un cliente existente.
   * Retorna true si el submit puede continuar, false si debe detenerse.
   */
  const verificarCedula = useCallback(async (form) => {
    const cedula = form.cedula?.trim();
    if (!cedula) return true;

    try {
      const { data } = await buscarPorCedula(cedula);
      const encontrado = data.data;
      if (!encontrado) return true;

      // Comparar todos los campos relevantes
      const hayDiferencia =
        encontrado.nombre.trim().toLowerCase() !== (form.nombre    || '').trim().toLowerCase() ||
        (encontrado.celular  || '')             !== (form.celular   || '')                      ||
        (encontrado.email    || '')             !== (form.email     || '')                      ||
        (encontrado.direccion|| '')             !== (form.direccion || '');

      if (!hayDiferencia) return true;

      // Hay diferencia → bloquear submit y guardar conflicto
      setConflictoCliente({
        clienteExistente: encontrado,
        datosNuevos: {
          nombre:    form.nombre    || '',
          celular:   form.celular   || '',
          email:     form.email     || '',
          direccion: form.direccion || '',
        },
      });
      return false;

    } catch {
      // Error de red o 404 → no bloqueamos, el backend decide
      return true;
    }
  }, []);

  /**
   * El usuario eligió "Reescribir datos":
   * actualiza el cliente en BD con los datos nuevos y libera el conflicto.
   * El componente debe reintentar el submit después de llamar esto.
   */
  const reescribirCliente = useCallback(async () => {
    if (!conflictoCliente) return;
    const { clienteExistente, datosNuevos } = conflictoCliente;

    try {
      await actualizarCliente(clienteExistente.id, {
        nombre:    datosNuevos.nombre,
        celular:   datosNuevos.celular   || clienteExistente.celular,
        email:     datosNuevos.email     || clienteExistente.email,
        direccion: datosNuevos.direccion || clienteExistente.direccion,
      });
    } catch {
      // Si falla la actualización igual liberamos — el submit continúa
    } finally {
      setConflictoCliente(null);
    }
  }, [conflictoCliente]);

  /**
   * El usuario eligió "Cancelar":
   * restaura el form con los datos originales del cliente en BD.
   * No modifica nada en el servidor.
   * El usuario debe revisar los datos y volver a confirmar.
   */
  const cancelarConflicto = useCallback((setForm) => {
    if (!conflictoCliente) return;
    const { clienteExistente } = conflictoCliente;

    setForm((f) => ({
      ...f,
      nombre:    clienteExistente.nombre    || '',
      celular:   clienteExistente.celular   || '',
      email:     clienteExistente.email     || '',
      direccion: clienteExistente.direccion || '',
    }));

    setConflictoCliente(null);
  }, [conflictoCliente]);

  return {
    conflictoCliente,
    verificarCedula,
    reescribirCliente,
    cancelarConflicto,
  };
}