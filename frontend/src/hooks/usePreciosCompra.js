import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { guardarPreciosNodos } from '../api/listasPrecios.api';
import { useListasPrecios } from './useListasPrecios';
import { claveNodo, clavesVigentes, nodosAGuardar } from '../utils/preciosCompra';

// ─────────────────────────────────────────────────────────────────────────────
// Estado de los PRECIOS DE VENTA que se editan durante una compra.
//
// Vive en la pantalla de la compra (no en la sección) porque la compra puede
// tener pasos —en «Compra a proveedor» los precios se ven en el paso de los
// productos y se guardan al confirmar el pago—, y desmontar la sección no puede
// borrar lo que se escribió.
//
// `guardar(lineas)` se llama DENTRO de la mutación de la compra y ANTES de
// registrarla: si los precios no se pueden guardar (sin permiso, un precio
// fuera de rango), la compra todavía no existe y el usuario lo corrige en la
// misma ventana. Al revés, una compra registrada con los precios a medio
// guardar obligaría a explicarle qué quedó y qué no. Si los precios se guardan
// y la compra falla, no se pierde nada: los precios son del producto, no de la
// compra, y reintentar no los escribe dos veces.
//
// Con las listas apagadas, o sin permiso para editarlas, `guardar` no hace
// nada: la compra es exactamente la de siempre.
// ─────────────────────────────────────────────────────────────────────────────
export function usePreciosCompra() {
  const { activo, listas, puedeEditar } = useListasPrecios();
  const queryClient = useQueryClient();
  const [cambios, setCambios] = useState({});

  const cambiar = (nodo, listaId, valor) => {
    const clave = claveNodo(nodo.nivel, nodo.id);
    setCambios((prev) => ({
      ...prev,
      [clave]: {
        nivel:   nodo.nivel,
        id:      nodo.id,
        base:    prev[clave]?.base ?? nodo.precios ?? null,
        valores: { ...(prev[clave]?.valores || {}), [listaId]: valor },
      },
    }));
  };

  const pendientes = (lineas) => (activo && puedeEditar
    ? nodosAGuardar(cambios, listas, clavesVigentes(lineas))
    : []);

  const guardar = async (lineas) => {
    const nodos = pendientes(lineas);
    if (!nodos.length) return 0;
    try {
      await guardarPreciosNodos(nodos);
    } catch (e) {
      const motivo = e?.response?.data?.error || 'error de conexión';
      // Con la forma de un error de axios, para que el `onError` de cada
      // pantalla lo muestre sin saber de dónde vino.
      throw Object.assign(new Error(motivo), {
        response: { data: { error: `No se guardaron los precios de venta: ${motivo}. Todavía no se registró nada.` } },
      });
    }
    queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
    queryClient.invalidateQueries({ queryKey: ['productos-serial'],   exact: false });
    queryClient.invalidateQueries({ queryKey: ['arbol-producto'],     exact: false });
    queryClient.invalidateQueries({ queryKey: ['precios-compra'],     exact: false });
    setCambios({});
    return nodos.length;
  };

  return { activo, listas, puedeEditar, cambios, cambiar, pendientes, guardar };
}

export default usePreciosCompra;
