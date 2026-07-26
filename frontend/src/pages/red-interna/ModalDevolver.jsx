import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { devolverABodega } from '../../api/redInterna.api';
import { Modal }  from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Undo2, Package, ShoppingBag, AlertTriangle } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// DEVOLVER A BODEGA — desde el carrito de inventario del local.
//
// La devolución es inmediata (el equipo va en la mano de quien la registra),
// así que no hay estado de tránsito: se confirma y la mercancía sale de la
// consignación del local en la misma transacción.
// ─────────────────────────────────────────────────────────────────────────────

export function ModalDevolver({ items, bodegaNombre = 'la bodega', onCerrar, onListo }) {
  const [notas, setNotas] = useState('');
  const [error, setError] = useState('');

  const enviar = useMutation({
    mutationFn: () => devolverABodega({
      lineas: items.map((i) => (i.tipo === 'serial'
        ? { tipo: 'serial',   serial_id: i.serial_id, nombre_producto: i.nombre }
        : { tipo: 'cantidad', producto_id: i.producto_id, cantidad: i.cantidad || 1 })),
      notas: notas.trim() || null,
    }).then((r) => r.data.data),
    onSuccess: onListo,
    onError: (err) => setError(err.response?.data?.error || 'No se pudo registrar la devolución'),
  });

  return (
    <Modal open onClose={onCerrar} title={`Devolver a ${bodegaNombre}`} size="md">
      <div className="flex flex-col gap-4">
        <div className="border border-gray-100 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
          {items.map((i) => {
            const esSerial = i.tipo === 'serial';
            const Icono = esSerial ? Package : ShoppingBag;
            return (
              <div key={i.key}
                className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-50 last:border-0">
                <Icono size={15} className={`flex-shrink-0 ${esSerial ? 'text-blue-500' : 'text-green-500'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{i.nombre}</p>
                  <p className="text-xs text-gray-400 font-mono">
                    {esSerial ? i.imei : `${i.cantidad || 1} unidad(es)`}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <input
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          placeholder="Motivo (opcional) — no rotó, dañado, cambio de local…"
          className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm
            placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <div className="bg-blue-50 rounded-xl px-4 py-3">
          <p className="text-xs text-blue-700">
            Sale de tu inventario y de tu consignación de inmediato.
            Si ya lo habías vendido, no aparecerá aquí.
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-500 flex items-center gap-1.5">
            <AlertTriangle size={14} /> {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCerrar}>Cancelar</Button>
          <Button className="flex-1" loading={enviar.isPending} onClick={() => enviar.mutate()}>
            <Undo2 size={15} /> Devolver {items.length} producto(s)
          </Button>
        </div>
      </div>
    </Modal>
  );
}
