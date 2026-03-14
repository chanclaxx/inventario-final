import { useState, useCallback } from 'react';
import { buscarPorCedula, actualizarCliente } from '../api/clientes.api';

export function useCedulaCliente() {
  const [conflictoCliente, setConflictoCliente] = useState(null);

  const verificarCedula = useCallback(async (form) => {
    const cedula = form.cedula?.trim();
    if (!cedula) return true;

    try {
      console.log('[useCedulaCliente] Buscando cédula:', cedula);
      const { data } = await buscarPorCedula(cedula);
      console.log('[useCedulaCliente] Respuesta:', data);

      const encontrado = data.data;
      if (!encontrado) {
        console.log('[useCedulaCliente] Cliente no encontrado → continuar');
        return true;
      }

      const hayDiferencia =
        encontrado.nombre.trim().toLowerCase() !== (form.nombre    || '').trim().toLowerCase() ||
        (encontrado.celular  || '')             !== (form.celular   || '')                      ||
        (encontrado.email    || '')             !== (form.email     || '')                      ||
        (encontrado.direccion|| '')             !== (form.direccion || '');

      console.log('[useCedulaCliente] hayDiferencia:', hayDiferencia, {
        nombreBD:    encontrado.nombre,
        nombreForm:  form.nombre,
        celularBD:   encontrado.celular,
        celularForm: form.celular,
      });

      if (!hayDiferencia) {
        console.log('[useCedulaCliente] Sin diferencia → continuar');
        return true;
      }

      console.log('[useCedulaCliente] Conflicto detectado → mostrando modal');
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

    } catch (e) {
      console.error('[useCedulaCliente] Error en verificarCedula:', e);
      return true;
    }
  }, []);

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
    } catch (e) {
      console.error('[useCedulaCliente] Error al reescribir cliente:', e);
    } finally {
      setConflictoCliente(null);
    }
  }, [conflictoCliente]);

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

  return { conflictoCliente, verificarCedula, reescribirCliente, cancelarConflicto };
}