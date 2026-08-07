import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { crearCompra } from '../../api/compras.api';
import { formatCOP }   from '../../utils/formatters';
import { Modal }       from '../../components/ui/Modal';
import { Button }      from '../../components/ui/Button';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { useMetodosPago } from '../../hooks/useMetodosPago';
import {
  Package, Smartphone, Minus, Plus, PackageCheck, AlertTriangle, ShieldCheck,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// RECIBIR MERCANCÍA CONTRA UNA ORDEN
//
// La pantalla que define si toda la feature se usa o no. Cinco decisiones la
// sostienen:
//
//   1. PRECARGADA, no vacía. Cada línea trae lo que falta. El caso normal
//      (llegó todo) es tocar un botón; recibir parcial es bajar un número.
//   2. UN SOLO NÚMERO por línea. No hay "recibido / aceptado / rechazado": lo
//      que no llegó queda pendiente, y punto.
//   3. El faltante NO PIDE EXPLICACIÓN. Se registra solo.
//   4. La garantía se HEREDA Y SE CALLA. Visible, editable, jamás obligatoria.
//   5. Al confirmar se llama a `POST /compras`. El usuario cree que "recibió";
//      el sistema hace exactamente lo que ya hacía —inventario, costo promedio,
//      deuda con el proveedor— con el mismo código probado.
//
// Los seriales son el único caso especial: el IMEI solo se conoce al abrir la
// caja, así que la cantidad recibida sale de cuántos IMEI se capturaron.
// ─────────────────────────────────────────────────────────────────────────────

function Stepper({ valor, max, onCambiar, disabled }) {
  const n = Number(valor) || 0;
  const set = (v) => onCambiar(String(Math.max(0, Math.min(max, v))));

  return (
    <div className={`flex items-stretch border border-gray-200 rounded-lg overflow-hidden bg-gray-50
      ${disabled ? 'opacity-40' : ''}`}>
      <button type="button" disabled={disabled || n <= 0} onClick={() => set(n - 1)}
        aria-label="Quitar uno"
        className="w-9 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors
                   disabled:opacity-30 disabled:hover:bg-transparent">
        <Minus size={14} className="mx-auto" />
      </button>
      <input type="number" min="0" max={max} value={valor} disabled={disabled}
        onChange={(e) => set(Number(e.target.value))}
        className="flex-1 w-14 text-center text-sm font-semibold tabular-nums bg-white
                   border-x border-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400" />
      <button type="button" disabled={disabled || n >= max} onClick={() => set(n + 1)}
        aria-label="Agregar uno"
        className="w-9 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors
                   disabled:opacity-30 disabled:hover:bg-transparent">
        <Plus size={14} className="mx-auto" />
      </button>
    </div>
  );
}

/**
 * Captura de IMEI para una línea de seriales. La cantidad recibida es cuántos
 * IMEI se escribieron: no hay forma de recibir 5 equipos sin decir cuáles son.
 */
function CapturaImeis({ imeis, max, onCambiar }) {
  const [texto, setTexto] = useState(imeis.join('\n'));

  const aplicar = (valor) => {
    setTexto(valor);
    const lista = valor.split(/[\n,;\s]+/).map((s) => s.trim()).filter(Boolean);
    onCambiar(lista.slice(0, max));
  };

  const sobran = texto.split(/[\n,;\s]+/).filter(Boolean).length > max;

  return (
    <div className="flex flex-col gap-1.5">
      <textarea value={texto} onChange={(e) => aplicar(e.target.value)} rows={3}
        placeholder={`Pega o escanea hasta ${max} IMEI, uno por línea`}
        className="px-2.5 py-2 text-xs font-mono border border-gray-200 rounded-lg resize-y
                   focus:outline-none focus:ring-1 focus:ring-blue-400" />
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400 tabular-nums">
          {imeis.length} de {max} capturados
        </span>
        {sobran && (
          <span className="text-xs text-amber-600">Solo caben {max} en esta entrega</span>
        )}
      </div>
    </div>
  );
}

function FilaRecepcion({ linea, estado, onCambiar, garantiaActiva }) {
  const pendiente = Number(linea.pendiente);
  const agotada   = pendiente <= 0;
  const esSerial  = linea.tipo === 'serial';
  const recibidas = esSerial ? estado.imeis.length : Number(estado.cantidad || 0);

  return (
    <div className={`border rounded-xl p-3 flex flex-col gap-2.5 transition-colors
      ${agotada ? 'border-gray-100 bg-gray-50' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {esSerial
              ? <Smartphone size={14} className="text-gray-300 flex-shrink-0" />
              : <Package size={14} className="text-gray-300 flex-shrink-0" />}
            <span className={`text-sm font-medium truncate ${agotada ? 'text-gray-400' : 'text-gray-800'}`}>
              {linea.nombre_producto}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5 tabular-nums">
            {agotada
              ? 'Ya llegó completa'
              : `Pediste ${linea.cantidad_pedida} · ya llegaron ${linea.recibida} · faltan ${pendiente}`}
          </p>
        </div>

        {!agotada && !esSerial && (
          <div className="flex flex-col gap-1 w-36 flex-shrink-0">
            <Stepper valor={estado.cantidad} max={pendiente}
              onCambiar={(v) => onCambiar('cantidad', v)} />
            <span className="text-xs text-gray-400 text-center tabular-nums">
              {recibidas === pendiente ? 'completa'
                : recibidas === 0      ? 'no llegó'
                  : `faltarán ${pendiente - recibidas}`}
            </span>
          </div>
        )}
      </div>

      {!agotada && esSerial && (
        <CapturaImeis imeis={estado.imeis} max={pendiente}
          onCambiar={(lista) => onCambiar('imeis', lista)} />
      )}

      {!agotada && recibidas > 0 && (
        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-100">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Precio real</label>
            <InputMoneda value={estado.precio} onChange={(v) => onCambiar('precio', v)} placeholder="0" />
            {linea.precio_estimado != null && Number(linea.precio_estimado) > 0
              && Number(estado.precio) > 0
              && Math.abs(Number(estado.precio) - Number(linea.precio_estimado)) > 0.5 && (
              <span className="text-xs text-amber-600">
                Cotizaste {formatCOP(linea.precio_estimado)}
              </span>
            )}
          </div>
          {garantiaActiva && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400 flex items-center gap-1">
                <ShieldCheck size={11} className="text-gray-300" /> Garantía
              </label>
              <div className="flex items-center gap-1.5">
                <input type="number" min="0" max="3650" value={estado.garantia}
                  placeholder="—"
                  onChange={(e) => onCambiar('garantia', e.target.value)}
                  className="w-16 px-2 py-1.5 text-sm text-right tabular-nums border border-gray-200 rounded-lg
                             focus:outline-none focus:ring-1 focus:ring-blue-400" />
                <span className="text-xs text-gray-400">días</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ModalRecibir({ open, orden, garantiaActiva, onClose, onRecibida }) {
  const queryClient = useQueryClient();
  const metodosPago = useMetodosPago();

  const lineas = (orden?.lineas || []).filter((l) => Number(l.pendiente) > 0);

  // Precargado con lo que falta: el caso normal es confirmar sin tocar nada.
  const [estados, setEstados] = useState(() =>
    Object.fromEntries((orden?.lineas || []).map((l) => [l.id, {
      cantidad: l.tipo === 'serial' ? '0' : String(Math.max(0, Number(l.pendiente))),
      imeis:    [],
      precio:   l.precio_estimado ?? '',
      garantia: l.garantia_dias ?? '',
    }]))
  );
  const [numeroFactura, setNumeroFactura] = useState(orden?.numero_factura || '');
  const [pagoAhora,     setPagoAhora]     = useState(false);
  const [metodo,        setMetodo]        = useState(() => metodosPago[0]?.id ?? 'Efectivo');
  const [valorPago,     setValorPago]     = useState('');
  const [error,         setError]         = useState('');

  const cambiar = (lineaId, campo, valor) =>
    setEstados((prev) => ({ ...prev, [lineaId]: { ...prev[lineaId], [campo]: valor } }));

  const recibirTodo = () => setEstados((prev) => {
    const copia = { ...prev };
    for (const l of lineas) {
      // Los seriales no se pueden autocompletar: hay que decir cuáles llegaron.
      if (l.tipo === 'serial') continue;
      copia[l.id] = { ...copia[l.id], cantidad: String(l.pendiente) };
    }
    return copia;
  });

  // Lo que de verdad se va a enviar. Una línea de seriales se expande en una
  // fila por IMEI, igual que hace el registro de compra normal.
  const construirLineas = () => {
    const out = [];
    for (const l of lineas) {
      const e = estados[l.id] || {};
      const precio = Number(e.precio || 0);
      const garantia = e.garantia !== '' && e.garantia != null ? Number(e.garantia) : null;

      if (l.tipo === 'serial') {
        for (const imei of e.imeis) {
          out.push({
            nombre_producto: l.nombre_producto,
            producto_id:     l.producto_id,
            imei,
            cantidad:        1,
            precio_unitario: precio,
            orden_linea_id:  l.id,
            garantia_dias:   garantia,
          });
        }
      } else {
        const cantidad = Number(e.cantidad || 0);
        if (cantidad > 0) {
          out.push({
            nombre_producto: l.nombre_producto,
            producto_id:     l.producto_id,
            cantidad,
            precio_unitario: precio,
            orden_linea_id:  l.id,
            garantia_dias:   garantia,
          });
        }
      }
    }
    return out;
  };

  const lineasEnvio = construirLineas();
  const unidades = lineasEnvio.reduce((s, l) => s + Number(l.cantidad), 0);
  const total    = lineasEnvio.reduce((s, l) => s + Number(l.cantidad) * Number(l.precio_unitario || 0), 0);
  const quedanPendientes = lineas.some((l) => {
    const e = estados[l.id] || {};
    const rec = l.tipo === 'serial' ? e.imeis.length : Number(e.cantidad || 0);
    return rec < Number(l.pendiente);
  });

  const mut = useMutation({
    mutationFn: () => crearCompra({
      proveedor_id:    orden.proveedor_id,
      orden_compra_id: orden.id,
      numero_factura:  numeroFactura.trim() || null,
      total,
      lineas:          lineasEnvio,
      pagos: pagoAhora && Number(valorPago) > 0
        ? [{ metodo, valor: Number(valorPago) }]
        : [],
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ordenes-compra'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['compras'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-serial'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['acreedores'], exact: false });
      onRecibida?.();
      onClose();
    },
    onError: (e) => setError(e.response?.data?.error || 'No se pudo registrar la recepción'),
  });

  const confirmar = () => {
    setError('');
    if (lineasEnvio.length === 0) {
      setError('No marcaste nada como recibido');
      return;
    }
    if (lineasEnvio.some((l) => !(Number(l.precio_unitario) > 0))) {
      setError('Cada producto que llegó necesita su precio');
      return;
    }
    mut.mutate();
  };

  if (!orden) return null;

  return (
    <Modal open={open} onClose={onClose} size="xl"
      title={`Recibir — Orden #${orden.numero ?? orden.id}`}>
      <div className="flex flex-col gap-4">

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-gray-500">{orden.proveedor_nombre}</p>
          {lineas.length > 0 && lineas.some((l) => l.tipo !== 'serial') && (
            <button type="button" onClick={recibirTodo}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors">
              Llegó todo
            </button>
          )}
        </div>

        {lineas.length === 0 ? (
          <div className="bg-green-50 rounded-xl px-4 py-6 text-center">
            <PackageCheck size={24} className="text-green-500 mx-auto mb-2" />
            <p className="text-sm text-green-800 font-medium">Esta orden ya llegó completa</p>
            <p className="text-xs text-green-600 mt-0.5">No queda nada por recibir</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {(orden.lineas || []).map((l) => (
              <FilaRecepcion key={l.id} linea={l} estado={estados[l.id] || {}}
                garantiaActiva={garantiaActiva}
                onCambiar={(campo, valor) => cambiar(l.id, campo, valor)} />
            ))}
          </div>
        )}

        {lineasEnvio.length > 0 && (
          <>
            <div className="border-t border-gray-100 pt-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400">N° de factura de esta entrega</label>
                <input value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)}
                  placeholder="Opcional"
                  className="px-3 py-2 text-sm border border-gray-200 rounded-xl
                             focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={pagoAhora}
                  onChange={(e) => setPagoAhora(e.target.checked)}
                  className="w-4 h-4 rounded accent-blue-600" />
                <span className="text-sm text-gray-700">Le pagué algo al recibir</span>
              </label>

              {pagoAhora && (
                <div className="grid grid-cols-2 gap-2 pl-6">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400">Cuánto</label>
                    <InputMoneda value={valorPago} onChange={setValorPago} placeholder="0" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400">Cómo</label>
                    <select value={metodo} onChange={(e) => setMetodo(e.target.value)}
                      className="px-3 py-2 text-sm border border-gray-200 rounded-xl bg-white
                                 focus:outline-none focus:ring-1 focus:ring-blue-400">
                      {metodosPago.map((m) => (
                        <option key={m.id} value={m.id}>{m.label ?? m.id}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {quedanPendientes && (
              <div className="bg-amber-50 rounded-xl px-3 py-2.5 flex items-start gap-2">
                <AlertTriangle size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800">
                  Lo que no llegó queda pendiente en la orden. No tienes que hacer nada más:
                  cuando llegue, vuelves a entrar aquí.
                </p>
              </div>
            )}

            <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
              <span className="text-xs text-gray-500 tabular-nums">
                {unidades} {unidades === 1 ? 'unidad' : 'unidades'}
              </span>
              <div className="text-right">
                <p className="text-xs text-gray-400">Se le carga al proveedor</p>
                <p className="text-base font-bold text-gray-900 tabular-nums">{formatCOP(total)}</p>
              </div>
            </div>
          </>
        )}

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={mut.isPending} disabled={lineasEnvio.length === 0} onClick={confirmar}>
            <PackageCheck size={15} /> Confirmar recepción
          </Button>
        </div>
      </div>
    </Modal>
  );
}
