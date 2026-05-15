import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, PackageX, RotateCcw } from 'lucide-react';
import { Modal }       from '../../components/ui/Modal';
import { Button }      from '../../components/ui/Button';
import { Input }       from '../../components/ui/Input';
import { Spinner }     from '../../components/ui/Spinner';
import { formatCOP }   from '../../utils/formatters';
import { getFacturaById }         from '../../api/facturas.api';
import { devolverLineasCredito }  from '../../api/facturas.api';
import { verificarPin }           from '../../api/config.api';

// ─── FilaLinea ────────────────────────────────────────────────────────────────

function FilaLinea({ linea, seleccionada, cantidad, onToggle, onCantidad }) {
  const disponible = Number(linea.cantidad) - Number(linea.cantidad_devuelta || 0);
  const esSerial   = !!linea.imei;
  const yaDevuelta = disponible === 0;

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-xl border transition-all
        ${yaDevuelta
          ? 'bg-gray-50 border-gray-100 opacity-50 cursor-not-allowed'
          : seleccionada
            ? 'bg-orange-50 border-orange-300'
            : 'bg-white border-gray-200 hover:border-gray-300 cursor-pointer'}`}
      onClick={() => !yaDevuelta && onToggle(linea.id)}
    >
      <input
        type="checkbox"
        checked={seleccionada && !yaDevuelta}
        disabled={yaDevuelta}
        onChange={() => !yaDevuelta && onToggle(linea.id)}
        onClick={(e) => e.stopPropagation()}
        className="mt-0.5 accent-orange-500 cursor-pointer"
      />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{linea.nombre_producto}</p>
        {linea.imei && (
          <p className="text-xs text-gray-400 font-mono">{linea.imei}</p>
        )}
        <p className="text-xs text-gray-500 mt-0.5">
          {formatCOP(Number(linea.precio))}
          {!esSerial && (
            <span className="ml-2 text-gray-400">
              × {linea.cantidad}
              {Number(linea.cantidad_devuelta) > 0 && (
                <span className="text-orange-500 ml-1">
                  ({linea.cantidad_devuelta} ya devuelto{Number(linea.cantidad_devuelta) > 1 ? 's' : ''})
                </span>
              )}
            </span>
          )}
        </p>
        {yaDevuelta && (
          <p className="text-xs text-green-600 mt-0.5">✓ Devuelto completamente</p>
        )}
      </div>

      {/* Selector de cantidad para productos por cantidad (no seriales) */}
      {seleccionada && !esSerial && disponible > 1 && (
        <div className="flex flex-col items-end gap-1" onClick={(e) => e.stopPropagation()}>
          <label className="text-[11px] text-gray-500">Cant. a devolver</label>
          <input
            type="number"
            min={1}
            max={disponible}
            value={cantidad}
            onChange={(e) => {
              const v = Math.min(Math.max(1, Number(e.target.value)), disponible);
              onCantidad(linea.id, v);
            }}
            className="w-16 px-2 py-1 text-sm text-center border border-orange-300 rounded-lg
              bg-white focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
          <p className="text-[11px] text-gray-400">máx {disponible}</p>
        </div>
      )}

      {/* Precio total de la línea seleccionada */}
      {seleccionada && !yaDevuelta && (
        <div className="flex-shrink-0 text-right">
          <p className="text-sm font-semibold text-orange-700">
            {formatCOP(Number(linea.precio) * (esSerial ? 1 : cantidad))}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Modal principal ──────────────────────────────────────────────────────────

export function ModalDevolucionParcialCredito({ credito, onClose }) {
  const queryClient = useQueryClient();

  const { data: detalleFactura, isLoading } = useQuery({
    queryKey: ['factura-devolucion', credito.factura_id],
    queryFn:  () => getFacturaById(credito.factura_id).then((r) => r.data.data),
    staleTime: 0,
  });

  const [seleccionadas, setSeleccionadas] = useState({});
  const [cantidades,    setCantidades]    = useState({});
  const [pin,           setPin]           = useState('');
  const [error,         setError]         = useState('');
  const [verificando,   setVerificando]   = useState(false);
  const [paso,          setPaso]          = useState('seleccion'); // 'seleccion' | 'confirmar'

  const lineas = detalleFactura?.lineas || [];

  const handleToggle = (lineaId) => {
    setSeleccionadas((prev) => {
      const nueva = { ...prev };
      if (nueva[lineaId]) {
        delete nueva[lineaId];
      } else {
        nueva[lineaId] = true;
        // Cantidad por defecto = disponible completo
        const linea = lineas.find((l) => l.id === lineaId);
        if (linea) {
          const disponible = Number(linea.cantidad) - Number(linea.cantidad_devuelta || 0);
          setCantidades((c) => ({ ...c, [lineaId]: disponible }));
        }
      }
      return nueva;
    });
  };

  const handleCantidad = (lineaId, valor) => {
    setCantidades((prev) => ({ ...prev, [lineaId]: valor }));
  };

  const lineasSeleccionadas = lineas.filter((l) => seleccionadas[l.id]);

  const totalDevuelto = lineasSeleccionadas.reduce((s, l) => {
    const cantidad = l.imei ? 1 : (cantidades[l.id] || 1);
    return s + Number(l.precio) * cantidad;
  }, 0);

  const nuevaDeudaCredito = Math.max(
    0,
    Number(credito.valor_total) - totalDevuelto
    - Number(credito.cuota_inicial || 0)
    - Number(credito.total_abonado || 0)
  );

  const todasDevueltas = lineasSeleccionadas.length > 0 && lineas.every((l) => {
    const disponible = Number(l.cantidad) - Number(l.cantidad_devuelta || 0);
    if (disponible === 0) return true;
    return !!seleccionadas[l.id];
  });

  const mutation = useMutation({
    mutationFn: () => {
      const payload = lineasSeleccionadas.map((l) => ({
        linea_id:         l.id,
        cantidad_devolver: l.imei ? 1 : (cantidades[l.id] || 1),
      }));
      return devolverLineasCredito(credito.factura_id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creditos'],            exact: false });
      queryClient.invalidateQueries({ queryKey: ['credito-detalle'],     exact: false });
      queryClient.invalidateQueries({ queryKey: ['facturas'],            exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-serial'],    exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'],  exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar la devolución'),
  });

  const handleSiguiente = () => {
    if (lineasSeleccionadas.length === 0) {
      setError('Selecciona al menos un producto para devolver');
      return;
    }
    setError('');
    setPaso('confirmar');
  };

  const handleConfirmar = async () => {
    if (!pin.trim()) { setError('Ingresa el PIN'); return; }
    setVerificando(true);
    setError('');
    try {
      const res = await verificarPin(pin.trim());
      if (!res.data.valido) { setError('PIN incorrecto'); return; }
      mutation.mutate();
    } catch {
      setError('Error al verificar el PIN');
    } finally {
      setVerificando(false);
    }
  };

  if (isLoading) {
    return (
      <Modal open onClose={onClose} title="Devolución parcial" size="sm">
        <Spinner className="py-10" />
      </Modal>
    );
  }

  // ── Paso 1: selección de productos ───────────────────────────────────────────
  if (paso === 'seleccion') {
    return (
      <Modal open onClose={onClose} title="Devolución parcial" size="sm">
        <div className="flex flex-col gap-4">

          <div className="flex items-start gap-2 bg-orange-50 border border-orange-100 rounded-xl px-3 py-2.5">
            <RotateCcw size={15} className="text-orange-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-orange-700">
              Selecciona los productos que el cliente devuelve. El stock regresa al
              inventario y el valor del crédito se reduce.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {lineas.map((l) => (
              <FilaLinea
                key={l.id}
                linea={l}
                seleccionada={!!seleccionadas[l.id]}
                cantidad={cantidades[l.id] || (Number(l.cantidad) - Number(l.cantidad_devuelta || 0))}
                onToggle={handleToggle}
                onCantidad={handleCantidad}
              />
            ))}
          </div>

          {lineasSeleccionadas.length > 0 && (
            <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Valor a descontar del crédito</span>
                <span className="font-semibold text-orange-700">- {formatCOP(totalDevuelto)}</span>
              </div>
              {todasDevueltas && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg px-2 py-1.5 mt-1">
                  <AlertTriangle size={13} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-600">
                    Estás devolviendo todos los productos — el crédito y la factura quedarán cancelados.
                  </p>
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
            <Button
              className="flex-1"
              disabled={lineasSeleccionadas.length === 0}
              onClick={handleSiguiente}
            >
              <PackageX size={15} /> Continuar
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  // ── Paso 2: confirmación con PIN ──────────────────────────────────────────────
  return (
    <Modal open onClose={onClose} title="Confirmar devolución" size="sm">
      <div className="flex flex-col gap-4">

        <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Resumen de devolución
          </p>
          {lineasSeleccionadas.map((l) => {
            const cant = l.imei ? 1 : (cantidades[l.id] || 1);
            const lineaKey = l.id;
            return (
              <div key={lineaKey} className="flex justify-between text-sm">
                <span className="text-gray-700 truncate flex-1 mr-2">
                  {l.nombre_producto}
                  {!l.imei && cant > 1 && <span className="text-gray-400 ml-1">× {cant}</span>}
                </span>
                <span className="font-medium text-gray-600 flex-shrink-0">
                  {formatCOP(Number(l.precio) * cant)}
                </span>
              </div>
            );
          })}
          <div className="border-t border-gray-200 pt-1.5 mt-0.5 flex justify-between text-sm font-semibold">
            <span>Total devuelto</span>
            <span className="text-orange-700">- {formatCOP(totalDevuelto)}</span>
          </div>
          {!todasDevueltas && (
            <div className="flex justify-between text-xs text-gray-500 mt-0.5">
              <span>Saldo pendiente restante</span>
              <span>{formatCOP(nuevaDeudaCredito)}</span>
            </div>
          )}
        </div>

        {todasDevueltas && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
            <AlertTriangle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-600">
              Se devolverán todos los productos. El crédito y la factura quedarán{' '}
              <span className="font-semibold">cancelados</span>.
            </p>
          </div>
        )}

        <Input
          label="PIN de administrador"
          type="password"
          placeholder="••••"
          value={pin}
          onChange={(e) => { setPin(e.target.value); setError(''); }}
          onKeyDown={(e) => e.key === 'Enter' && handleConfirmar()}
          autoFocus
        />

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1"
            onClick={() => { setPaso('seleccion'); setPin(''); setError(''); }}>
            Atrás
          </Button>
          <Button
            variant={todasDevueltas ? 'danger' : 'primary'}
            className="flex-1"
            loading={verificando || mutation.isPending}
            onClick={handleConfirmar}
            disabled={!pin.trim()}
          >
            Confirmar devolución
          </Button>
        </div>
      </div>
    </Modal>
  );
}
