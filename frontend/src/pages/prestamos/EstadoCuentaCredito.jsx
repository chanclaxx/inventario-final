import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getEstadoCuentaCredito, anularAbonoCredito, anularAbonoTotalCredito,
} from '../../api/creditos.api';
import { EstadoCuentaBase } from '../../components/EstadoCuenta/EstadoCuentaBase';
import { formatCOP } from '../../utils/formatters';
import {
  FileText, TrendingDown, RotateCcw, Wallet, AlertTriangle, HandCoins, XCircle,
} from 'lucide-react';

/**
 * Estado de cuenta de un cliente a crédito.
 *
 * Usa la misma vista que Préstamos (EstadoCuentaBase) y los mismos movimientos
 * que consumen el PDF y el Excel, calculados por creditos.service en el backend.
 *
 * lado: 'derecha' = lo que hace el negocio | 'izquierda' = lo que hace el cliente
 */
const TIPO_CONFIG_CREDITO = {
  credito: {
    badge:      'bg-orange-100 text-orange-700',
    label:      'Factura',
    Icn:        FileText,
    lado:       'derecha',
    bubbleBg:   'bg-amber-50 border border-amber-200',
    montoClass: 'text-amber-700',
  },
  cuota_inicial: {
    badge:      'bg-blue-100 text-blue-700',
    label:      'Cuota inicial',
    Icn:        Wallet,
    lado:       'izquierda',
    bubbleBg:   'bg-white border border-gray-200',
    montoClass: 'text-blue-600',
  },
  abono: {
    badge:      'bg-green-100 text-green-700',
    label:      'Abono',
    Icn:        TrendingDown,
    lado:       'izquierda',
    bubbleBg:   'bg-white border border-gray-200',
    montoClass: 'text-green-600',
  },
  devolucion: {
    badge:      'bg-orange-100 text-orange-600',
    label:      'Devolución',
    Icn:        RotateCcw,
    lado:       'izquierda',
    bubbleBg:   'bg-orange-50 border border-orange-200',
    montoClass: 'text-orange-600',
    sufijo:     'baja la deuda',
  },
  ajuste: {
    badge:      'bg-purple-100 text-purple-700',
    label:      'Ajuste',
    Icn:        HandCoins,
    lado:       'izquierda',
    bubbleBg:   'bg-purple-50 border border-purple-200',
    montoClass: 'text-purple-700',
  },
  mora_cobro: {
    badge:      'bg-red-100 text-red-700',
    label:      'Mora cobrada',
    Icn:        AlertTriangle,
    lado:       'izquierda',
    bubbleBg:   'bg-red-50 border border-red-200',
    montoClass: 'text-red-600',
    sufijo:     'aparte del capital',
  },
  mora_condonacion: {
    badge:      'bg-gray-100 text-gray-600',
    label:      'Mora condonada',
    Icn:        AlertTriangle,
    lado:       'derecha',
    bubbleBg:   'bg-gray-50 border border-gray-200',
    montoClass: 'text-gray-500',
    sufijo:     'aparte del capital',
  },
  interes_cobro: {
    badge:      'bg-teal-100 text-teal-700',
    label:      'Interés cobrado',
    Icn:        AlertTriangle,
    lado:       'izquierda',
    bubbleBg:   'bg-teal-50 border border-teal-200',
    montoClass: 'text-teal-700',
    sufijo:     'aparte del capital',
  },
  interes_condonacion: {
    badge:      'bg-gray-100 text-gray-600',
    label:      'Interés condonado',
    Icn:        AlertTriangle,
    lado:       'derecha',
    bubbleBg:   'bg-gray-50 border border-gray-200',
    montoClass: 'text-gray-500',
    sufijo:     'aparte del capital',
  },
};

const MIN_MOTIVO = 3;
const MAX_MOTIVO = 200;

export function EstadoCuentaCredito({ clave }) {
  const queryClient = useQueryClient();
  const [anulando, setAnulando] = useState(null);
  const [motivo,   setMotivo]   = useState('');
  const [error,    setError]    = useState('');

  const { data: movimientos = [], isLoading } = useQuery({
    queryKey:  ['estado-cuenta-credito', clave],
    queryFn:   () => getEstadoCuentaCredito(clave).then((r) => r.data.data),
    enabled:   !!clave,
    staleTime: 30_000,
  });

  // Un pago total se anula ENTERO y un abono suelto de a uno. Es la misma
  // pantalla y el mismo motivo obligatorio; lo único que cambia es a qué
  // endpoint va, y eso lo decide el propio movimiento.
  const anular = useMutation({
    mutationFn: () => (anulando.es_pago_total
      ? anularAbonoTotalCredito(anulando.referencia_id, motivo.trim())
      : anularAbonoCredito(anulando.referencia_id, motivo.trim())),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estado-cuenta-credito'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['creditos'], exact: false });
      cerrar();
    },
    onError: (err) => setError(err.response?.data?.error || 'No se pudo anular el abono'),
  });

  const cerrar = () => { setAnulando(null); setMotivo(''); setError(''); };

  // Dos motivos distintos por los que una línea no cuenta, y cada uno se explica:
  //   · el abono se anuló  → se muestra la razón que escribió la persona;
  //   · la factura se canceló → queda como constancia sin arrastrar deuda.
  // Sin la etiqueta, el usuario ve un movimiento que no suma y no sabe por qué:
  // es exactamente el descuadre que se corrigió en préstamos.
  const getEtiqueta = (mov) => {
    const parcial = Number(mov.valor_anulado || 0);
    // Anulado del TODO vs. anulado en PARTE son cosas distintas y el usuario
    // tiene que poder distinguirlas: en el segundo caso la fila muestra el
    // monto completo pero el saldo baja menos, y sin decir cuánto quedan dos
    // números que no cuadran y nada que los explique.
    if (mov.anulado_total) return mov.motivo_anulacion || 'Anulado';
    if (parcial > 0) {
      return `${formatCOP(parcial)} de este pago no cuenta — ${mov.motivo_anulacion || 'anulado'}`;
    }
    if (mov.credito_estado === 'Cancelado') return 'Anulada';
    return null;
  };

  // El botón de anular de la fila se rige por `anulable`, que para un pago total
  // es false a propósito: anular medio reparto deja la cuenta a medias. El pago
  // completo se anula con su propia acción, para que quede claro qué se deshace.
  const getAcciones = (mov) => (mov.es_pago_total && !mov.anulado
    ? [{
        id: 'anular-pago-total',
        Icn: XCircle,
        title: 'Anular el pago total completo',
        hoverClass: 'hover:text-red-400',
        onClick: (m) => { setAnulando(m); setMotivo(''); setError(''); },
      }]
    : []);

  const puedeConfirmar = motivo.trim().length >= MIN_MOTIVO && !anular.isPending;
  const esPagoTotal = anulando?.es_pago_total === true;

  return (
    <EstadoCuentaBase
      movimientos={movimientos}
      isLoading={isLoading}
      tipoConfig={TIPO_CONFIG_CREDITO}
      onAnular={(mov) => { setAnulando(mov); setMotivo(''); setError(''); }}
      getEtiqueta={getEtiqueta}
      getAcciones={getAcciones}
      labelIzquierda="← Cliente"
      labelDerecha="Negocio →"
      vacioTexto="Sin movimientos de crédito registrados">

      {/* Anular un abono. Exige motivo porque el abono no se borra: queda con la
          razón escrita, que es con lo que el negocio le responde al cliente. */}
      {anulando && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4 shadow-xl">
            <p className="text-sm font-semibold text-gray-800">
              {esPagoTotal ? '¿Anular este pago total?' : '¿Anular este abono?'}
            </p>

            <div className="bg-gray-50 rounded-xl px-3 py-2">
              <p className="text-xs text-gray-500">{anulando.concepto}</p>
              <p className="text-sm font-bold text-gray-800 mt-0.5">
                {formatCOP(anulando.abono || anulando.cargo)}
              </p>
            </div>

            <p className="text-xs text-gray-500">
              {esPagoTotal
                ? `Se deshace el pago completo y sus ${(anulando.detalle || []).length} porciones,
                   todo de una vez. No se borra: queda marcado con el motivo. Los créditos
                   que estaban saldados vuelven a quedar activos.`
                : `El abono no se borra: queda marcado con el motivo y deja de bajar la
                   deuda. Si el crédito estaba saldado, vuelve a quedar activo.`}
            </p>

            {/* A qué facturas se le va a quitar */}
            {esPagoTotal && (anulando.detalle || []).length > 0 && (
              <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2 flex flex-col gap-0.5">
                {(anulando.detalle || []).map((d) => (
                  <div key={d.id} className="flex items-center justify-between">
                    <span className="text-[11px] text-red-600">
                      factura #{String(d.factura ?? '').padStart(6, '0')}
                    </span>
                    <span className="text-[11px] font-semibold text-red-700">
                      −{formatCOP(d.valor)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-700">
                Motivo <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={motivo}
                autoFocus
                maxLength={MAX_MOTIVO}
                onChange={(e) => { setMotivo(e.target.value); setError(''); }}
                onKeyDown={(e) => e.key === 'Enter' && puedeConfirmar && anular.mutate()}
                placeholder="Ej: se registró por error, el pago no entró…"
                className="w-full px-3 py-2 bg-gray-100 rounded-xl text-sm
                  focus:outline-none focus:ring-2 focus:ring-red-400 focus:bg-white transition-all"
              />
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <div className="flex gap-2">
              <button
                onClick={cerrar}
                className="flex-1 py-2 rounded-xl text-sm border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
              <button
                onClick={() => anular.mutate()}
                disabled={!puedeConfirmar}
                className="flex-1 py-2 rounded-xl text-sm font-medium text-white bg-red-500
                  hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                {anular.isPending ? 'Anulando…' : (esPagoTotal ? 'Anular pago total' : 'Anular abono')}
              </button>
            </div>
          </div>
        </div>
      )}
    </EstadoCuentaBase>
  );
}
