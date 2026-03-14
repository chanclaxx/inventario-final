import { useState, useCallback } from 'react';
import { buscarPorCedula, actualizarCliente } from '../api/clientes.api';

/**
 * Hook compartido para la lógica de búsqueda de cliente por cédula.
 *
 * Detecta si la cédula ingresada ya pertenece a otro cliente con
 * nombre diferente y expone el estado necesario para mostrar el
 * modal de conflicto.
 *
 * Uso:
 *   const {
 *     buscandoCliente,
 *     conflictoCliente,
 *     buscarCliente,
 *     resolverConflicto,
 *     descartarConflicto,
 *   } = useCedulaCliente({ form, setForm });
 */
export function useCedulaCliente({ form, setForm }) {
  const [buscandoCliente,  setBuscandoCliente]  = useState(false);
  const [conflictoCliente, setConflictoCliente] = useState(null);
  // conflictoCliente = { clienteExistente, datosNuevos } | null

  /**
   * Busca un cliente por la cédula actual del form.
   * - Si no existe: no hace nada (el backend lo crea al facturar).
   * - Si existe con el mismo nombre: autocompleta campos vacíos silenciosamente.
   * - Si existe con nombre diferente: guarda el conflicto para mostrar el modal.
   */
  const buscarCliente = useCallback(async () => {
    const cedula = form.cedula?.trim();
    if (!cedula) return;

    setBuscandoCliente(true);
    try {
      const { data } = await buscarPorCedula(cedula);
      const encontrado = data.data;
      if (!encontrado) return;

      const mismoNombre =
        encontrado.nombre.trim().toLowerCase() === form.nombre.trim().toLowerCase();

      if (mismoNombre || !form.nombre.trim()) {
        // Autocompleta campos vacíos sin preguntar
        setForm((f) => ({
          ...f,
          nombre:    f.nombre    || encontrado.nombre,
          celular:   f.celular   || encontrado.celular   || '',
          email:     f.email     || encontrado.email     || '',
          direccion: f.direccion || encontrado.direccion || '',
        }));
      } else {
        // Nombre diferente → expone el conflicto para el modal
        setConflictoCliente({
          clienteExistente: encontrado,
          datosNuevos: {
            nombre:    form.nombre,
            celular:   form.celular,
            email:     form.email,
            direccion: form.direccion,
          },
        });
      }
    } catch {
      // Cliente no encontrado — el backend lo creará al facturar
    } finally {
      setBuscandoCliente(false);
    }
  }, [form, setForm]);

  /**
   * El usuario eligió "Renombrar y actualizar":
   * actualiza el cliente en BD y pre-carga el form con los datos nuevos.
   */
  const resolverConflicto = useCallback(async () => {
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
      // Si falla la actualización igual continuamos — el servidor
      // manejará la reconciliación al guardar la factura.
    } finally {
      setConflictoCliente(null);
    }
  }, [conflictoCliente]);

  /**
   * El usuario eligió "Continuar sin actualizar":
   * descarta el conflicto y deja el form como está.
   */
  const descartarConflicto = useCallback(() => {
    setConflictoCliente(null);
  }, []);

  return {
    buscandoCliente,
    conflictoCliente,
    buscarCliente,
    resolverConflicto,
    descartarConflicto,
  };
}