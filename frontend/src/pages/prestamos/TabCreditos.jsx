import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getCreditos, getCreditoById,
  registrarAbonoCredito, saldarCredito, cancelarCredito,
  fijarPlazoCredito, cobrarMoraCredito, condonarMoraCredito, fijarInteresCredito,
  getEstadoCuentaCredito, descargarPdfEstadoCuentaCredito,
  getDocumentoCredito, descargarPdfAvisoMora, descargarPdfPazYSalvo,
} from '../../api/creditos.api';
import { getFacturaById }          from '../../api/facturas.api';
import { getGarantiasPorFactura }  from '../../api/garantias.api';
import api from '../../api/axios.config';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { useMetodosPago } from '../../hooks/useMetodosPago';
import { useMora }        from '../../hooks/useMora';
import { useInteres }     from '../../hooks/useInteres';
import { PanelMora }      from '../../components/ui/PanelMora';
import { PanelInteres }   from '../../components/ui/PanelInteres';
import { MODOS_ABONO }    from '../../utils/mora';
import { Badge }       from '../../components/ui/Badge';
import { Button }      from '../../components/ui/Button';
import { Modal }       from '../../components/ui/Modal';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { Spinner }     from '../../components/ui/Spinner';
import { EmptyState }  from '../../components/ui/EmptyState';
import { ModalImprimirFactura } from '../../components/ui/ModalImprimirFactura';
import { FacturaTermica }       from '../../components/FacturaTermica';
import { ReciboAbono }          from '../../components/ReciboAbono';
import { ModalDevolucionParcialCredito } from '../facturas/ModalDevolucionParcialCredito';
import { ModalExportarCuenta }   from '../../components/ui/ModalExportarCuenta';
import { ModalDocumentosObligacion } from '../../components/documentos/ModalDocumentosObligacion';
import { EstadoCuentaCredito }   from './EstadoCuentaCredito';
import { exportarCuentaCreditoExcel } from '../../utils/exportarCuentaCreditoExcel';
import {
  CreditCard, Plus, CheckCircle, XCircle, AlertTriangle, LayoutList, FileDown,
  ChevronLeft, ChevronDown, ChevronUp, RotateCcw, ChevronRight, Loader2, Printer,
} from 'lucide-react';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function iniciales(nombre) {
  return (nombre || '?')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// ─── Modal Abono ──────────────────────────────────────────────────────────────

function ModalAbonoCredito({ credito, onClose }) {
  const queryClient = useQueryClient();
  const [valor,  setValor]  = useState('');
  const [metodo, setMetodo] = useState('Efectivo');
  const [notas,  setNotas]  = useState('');
  const [error,  setError]  = useState('');
  // Imputación del abono cuando hay mora pendiente. Por defecto el abono paga
  // SOLO la venta: la mora se cobra aparte y es lo último que cierra el crédito.
  const [modo,      setModo]      = useState('solo_capital');
  const [valorMora, setValorMora] = useState('');
  // Recibo del abono con desglose capital/mora.
  const [recibo,    setRecibo]    = useState(null);

  const cuotaInicial   = Number(credito.cuota_inicial || 0);
  const totalAbonado   = Number(credito.total_abonado || 0);
  const valorTotal     = Number(credito.valor_total);
  const saldoPendiente = Number(credito.saldo_pendiente ?? (valorTotal - cuotaInicial - totalAbonado));
  const moraPendiente  = Number(credito.mora?.pendiente || 0);

  const metodosPago = useMetodosPago();
  // Parámetros de la impresora térmica, para el recibo.
  const { data: configImpresion } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });

  const mutation = useMutation({
    mutationFn: () => registrarAbonoCredito(credito.id, {
      valor: Number(valor), metodo, notas: notas || null,
      modo, valor_mora: modo === 'personalizado' ? Number(valorMora || 0) : 0,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['creditos'],             exact: false });
      queryClient.invalidateQueries({ queryKey: ['credito-detalle'],      exact: false });
      queryClient.invalidateQueries({ queryKey: ['estado-cuenta-credito'], exact: false });
      const d = res.data?.data;
      // Si el pago incluyó mora, se ofrece el recibo con el desglose. Sin mora
      // el flujo queda igual que antes: se cierra sin fricción.
      if (Number(d?.abonado_mora || 0) > 0) {
        setRecibo({
          abono: {
            valor: Number(valor),
            capital: Number(d.abonado_capital || 0),
            mora:    Number(d.abonado_mora || 0),
            metodo, notas: notas || null, fecha: new Date(),
            saldo_antes:    saldoPendiente,
            saldo_despues:  Number(d.saldo ?? 0),
            mora_pendiente: Number(d.mora?.pendiente ?? 0),
          },
          deuda: {
            tipo: 'credito',
            numero: credito.factura_numero ?? credito.factura_id,
            persona: credito.nombre_cliente, cedula: credito.cedula,
            fecha_limite: d.mora?.fecha_limite ?? null,
            dias_mora:    d.mora?.dias_vencidos ?? 0,
          },
        });
      } else {
        onClose();
      }
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar abono'),
  });

  // Recibo con el desglose capital/mora, tras un abono que cobró intereses.
  if (recibo) {
    return (
      <ReciboAbono
        abono={recibo.abono}
        deuda={recibo.deuda}
        config={configImpresion}
        onClose={onClose}
      />
    );
  }

  return (
    <Modal open onClose={onClose} title="Registrar Abono" size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-1">
          <p className="text-xs text-gray-400">
            Crédito — {credito.nombre_cliente} · Factura #{String(credito.factura_numero ?? credito.factura_id).padStart(6, '0')}
          </p>
          <div className="flex justify-between mt-1">
            <span className="text-xs text-gray-400">Saldo pendiente</span>
            <span className="text-sm font-bold text-red-500">{formatCOP(saldoPendiente)}</span>
          </div>
          {moraPendiente > 0 && (
            <div className="flex justify-between">
              <span className="text-xs text-amber-600">
                + mora ({credito.mora.dias_vencidos} día{credito.mora.dias_vencidos === 1 ? '' : 's'} de atraso)
              </span>
              <span className="text-sm font-bold text-amber-600">{formatCOP(moraPendiente)}</span>
            </div>
          )}
        </div>

        {/* Cómo se reparte el abono. Solo aparece si hay mora que repartir. */}
        {moraPendiente > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-gray-600">¿A qué se aplica el pago?</span>
            <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
              {MODOS_ABONO.map((o) => (
                <button key={o.id} type="button" onClick={() => setModo(o.id)}
                  className={`flex-1 py-1.5 px-1 rounded-lg text-[11px] font-medium transition-all
                    ${modo === o.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                  {o.label}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-gray-400">
              {MODOS_ABONO.find((o) => o.id === modo)?.descripcion}
            </span>
            {modo === 'personalizado' && (
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500">Cuánto va a la mora</label>
                <InputMoneda value={valorMora} onChange={setValorMora} placeholder="0"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm
                    focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {metodosPago.map((m) => (
            <button key={m.id} onClick={() => setMetodo(m.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
                ${metodo === m.id
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'}`}>
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Valor del abono</label>
          <InputMoneda value={valor} onChange={setValor} placeholder="0"
            onKeyDown={(e) => e.key === 'Enter' && mutation.mutate()} autoFocus
            className="w-full px-3 py-2 bg-gray-100 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all" />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">
            Notas <span className="text-gray-400 font-normal">(opcional)</span>
          </label>
          <textarea rows={2} placeholder="Observaciones..."
            value={notas} onChange={(e) => setNotas(e.target.value)}
            className="w-full px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm
              placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500
              focus:bg-white transition-all resize-none" />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutation.isPending}
            disabled={!valor || Number(valor) <= 0} onClick={() => mutation.mutate()}>
            Registrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal Saldar ─────────────────────────────────────────────────────────────

function ModalSaldarCredito({ credito, onClose }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');

  const cuotaInicial   = Number(credito.cuota_inicial || 0);
  const totalAbonado   = Number(credito.total_abonado || 0);
  const valorTotal     = Number(credito.valor_total);
  const saldoPendiente = Number(credito.saldo_pendiente ?? (valorTotal - cuotaInicial - totalAbonado));

  const mutation = useMutation({
    mutationFn: () => saldarCredito(credito.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creditos'],             exact: false });
      queryClient.invalidateQueries({ queryKey: ['credito-detalle'],      exact: false });
      queryClient.invalidateQueries({ queryKey: ['estado-cuenta-credito'], exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al saldar crédito'),
  });

  return (
    <Modal open onClose={onClose} title="Saldar Crédito" size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-3 flex flex-col gap-1">
          <p className="text-sm text-gray-700">
            ¿Marcar como saldado el crédito de{' '}
            <span className="font-semibold">{credito.nombre_cliente}</span>?
          </p>
          {saldoPendiente > 0 && (
            <p className="text-xs text-yellow-700 mt-1">
              Saldo pendiente: <span className="font-bold">{formatCOP(saldoPendiente)}</span>
              {' '}— se marcará como saldado sin registrar abono adicional.
            </p>
          )}
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            <CheckCircle size={15} /> Confirmar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal Cancelar ───────────────────────────────────────────────────────────

function ModalCancelarCredito({ credito, onClose }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => cancelarCredito(credito.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creditos'],            exact: false });
      queryClient.invalidateQueries({ queryKey: ['credito-detalle'],     exact: false });
      queryClient.invalidateQueries({ queryKey: ['estado-cuenta-credito'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['facturas'],           exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-serial'],   exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['seriales'],           exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al cancelar crédito'),
  });

  return (
    <Modal open onClose={onClose} title="Cancelar Crédito" size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-red-50 border border-red-100 rounded-xl p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-red-700">
                ¿Cancelar el crédito de {credito.nombre_cliente}?
              </p>
              <p className="text-xs text-red-600">
                Cancelará la factura y devolverá los productos al inventario.
                Esta acción no se puede deshacer.
              </p>
            </div>
          </div>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>No, volver</Button>
          <Button className="flex-1 bg-red-500 hover:bg-red-600" loading={mutation.isPending}
            onClick={() => mutation.mutate()}>
            <XCircle size={15} /> Sí, cancelar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Documentos del crédito (factura, aviso de mora, paz y salvo) ────────────
//
// Un solo punto de entrada para los tres documentos, en POS y en PDF. La
// factura sigue usando el flujo de FacturarPage (ModalImprimirFactura →
// FacturaTermica); los otros dos los aporta ModalDocumentosObligacion, que es el
// mismo componente que usan los préstamos.

function DocumentosCredito({ credito, onClose }) {
  const facturaId = credito.factura_id;
  const [vista, setVista] = useState('menu'); // 'menu' | 'factura' | 'pos'
  const [posData, setPosData] = useState(null);

  const { data: f } = useQuery({
    queryKey: ['factura-detalle', facturaId],
    queryFn:  () => getFacturaById(facturaId).then((r) => r.data.data),
    enabled:  !!facturaId,
  });
  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
  });
  const { data: garantias = [] } = useQuery({
    queryKey: ['garantias-factura', facturaId],
    queryFn:  () => getGarantiasPorFactura(facturaId).then((r) => r.data.data),
    enabled:  !!facturaId,
    staleTime: 0,
  });

  if (posData) {
    return (
      <FacturaTermica factura={posData.factura} garantias={posData.garantias} onClose={onClose} />
    );
  }

  // La factura viaja con su `credito.resumen` (lo calcula el backend), que es lo
  // que hace que el ticket imprima el saldo y el historial de abonos.
  const facturaConConfig = f ? { ...f, config: configData } : null;

  if (vista === 'factura') {
    if (!facturaConConfig) {
      return (
        <Modal open onClose={onClose} title="Imprimir factura" size="sm">
          <Spinner className="py-10" />
        </Modal>
      );
    }
    return (
      <ModalImprimirFactura
        open
        onClose={onClose}
        factura={facturaConConfig}
        garantias={garantias}
        onImprimirPos={(fa, g) => setPosData({ factura: fa, garantias: g })}
      />
    );
  }

  const tarjetaFactura = (
    <button
      onClick={() => setVista('factura')}
      className="rounded-xl border border-blue-200 bg-blue-50 p-3 flex items-start gap-2.5 text-left
        hover:shadow-sm transition-all">
      <Printer size={18} className="text-blue-500 flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-blue-700">Factura a crédito</p>
        <p className="text-xs text-gray-500 mt-0.5 leading-snug">
          Productos, estado de la deuda, historial de abonos y condiciones de pago. POS o PDF.
        </p>
      </div>
    </button>
  );

  return (
    <ModalDocumentosObligacion
      id={credito.id}
      config={configData}
      onClose={onClose}
      extra={tarjetaFactura}
      api={{
        getDocumento:  getDocumentoCredito,
        pdfAvisoMora:  descargarPdfAvisoMora,
        pdfPazYSalvo:  descargarPdfPazYSalvo,
      }}
    />
  );
}

// ─── Historial de abonos (lazy, se carga al expandir) ────────────────────────

function HistorialAbonos({ creditoId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['credito-detalle', creditoId],
    queryFn:  () => getCreditoById(creditoId).then((r) => r.data.data),
    staleTime: 0,
  });

  if (isLoading) {
    return (
      <div className="py-2 text-center">
        <Loader2 size={14} className="animate-spin text-gray-400 mx-auto" />
      </div>
    );
  }

  const abonos = data?.abonos || [];
  if (!abonos.length) {
    return <p className="text-xs text-gray-400 text-center py-1">Sin abonos registrados</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {abonos.map((abono) => (
        <div key={abono.id}
          className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
          <div>
            <p className="text-xs text-gray-500">{formatFechaHora(abono.fecha)}</p>
            <p className="text-xs text-gray-400">
              {abono.metodo}{abono.usuario_nombre ? ` · ${abono.usuario_nombre}` : ''}
            </p>
            {abono.notas && <p className="text-xs text-gray-400 italic">{abono.notas}</p>}
          </div>
          <span className="text-sm font-semibold text-green-600">+ {formatCOP(abono.valor)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Tarjeta de crédito individual (por factura) ──────────────────────────────

function TarjetaCreditoDetalle({
  credito, onAbonar, onSaldar, onCancelar, onDevolucion, onImprimir, cerrado = false,
}) {
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const configMora    = useMora();
  const configInteres = useInteres();
  const metodosPago = useMetodosPago();

  const cuotaInicial   = Number(credito.cuota_inicial || 0);
  const totalAbonado   = Number(credito.total_abonado || 0);
  const valorTotal     = Number(credito.valor_total);
  const saldoPendiente = Math.max(0, valorTotal - cuotaInicial - totalAbonado);
  const progreso       = valorTotal > 0 ? ((cuotaInicial + totalAbonado) / valorTotal) * 100 : 0;
  const esActivo       = credito.estado === 'Activo';
  const tieneMovimientos = (cuotaInicial + totalAbonado) > 0;
  const productos      = credito.productos || [];

  return (
    <div className={`rounded-2xl border flex flex-col overflow-hidden
      ${cerrado ? 'bg-gray-50 border-gray-100' : 'bg-white border-gray-200'}`}>

      <div className="p-4 flex flex-col gap-3">

        {/* Encabezado */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {/* Aviso de vencimiento arriba: se ve sin desplegar el panel */}
            {credito.mora?.aplica && credito.mora.vencido && esActivo && (
              <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5
                rounded-full mb-1
                ${credito.mora.pendiente > 0
                  ? 'bg-red-50 text-red-600 border border-red-200'
                  : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                <AlertTriangle size={10} />
                {credito.mora.pendiente > 0
                  ? `Vencido · mora ${formatCOP(credito.mora.pendiente)}`
                  : `Vencido hace ${credito.mora.dias_vencidos} día(s)`}
              </span>
            )}
            <p className={`text-sm font-semibold ${cerrado ? 'text-gray-500' : 'text-gray-800'}`}>
              Factura #{String(credito.factura_numero ?? credito.factura_id).padStart(6, '0')}
            </p>
            {credito.creado_en && (
              <p className="text-xs text-gray-400 mt-0.5">{formatFechaHora(credito.creado_en)}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {credito.estado !== 'Cancelado' && (
              <button onClick={() => onImprimir(credito)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-blue-500 transition-colors"
                title="Documentos: factura, aviso de mora, paz y salvo (POS o PDF)">
                <Printer size={14} />
              </button>
            )}
            <Badge variant={
              credito.estado === 'Activo'    ? 'yellow' :
              credito.estado === 'Cancelado' ? 'red'    : 'green'
            }>
              {credito.estado}
            </Badge>
          </div>
        </div>

        {/* Productos de la factura */}
        {productos.length > 0 && (
          <div className="bg-gray-50 rounded-xl p-2.5 flex flex-col gap-1.5">
            {productos.map((prod, idx) => {
              const devuelta      = Number(prod.cantidad_devuelta || 0);
              const neta          = Number(prod.cantidad) - devuelta;
              const totalDevuelta = devuelta >= Number(prod.cantidad);
              return (
                <div key={idx}
                  className={`flex items-start justify-between gap-2 ${totalDevuelta ? 'opacity-50' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs font-medium truncate
                      ${totalDevuelta ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                      {prod.nombre}
                    </p>
                    {prod.imei && (
                      <p className="text-[11px] text-gray-400 font-mono">{prod.imei}</p>
                    )}
                    {devuelta > 0 && !totalDevuelta && (
                      <p className="text-[11px] text-orange-500">
                        {devuelta} devuelto{devuelta > 1 ? 's' : ''}
                      </p>
                    )}
                    {totalDevuelta && (
                      <p className="text-[11px] text-green-600">Devuelto</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {neta > 1 && (
                      <span className="text-[11px] text-gray-400">×{neta}</span>
                    )}
                    <span className={`text-xs font-semibold
                      ${totalDevuelta ? 'text-gray-400 line-through' : 'text-gray-600'}`}>
                      {formatCOP(prod.precio)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Barra de progreso */}
        <div className="flex flex-col gap-1">
          <div className="w-full bg-gray-100 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all
                ${!esActivo ? 'bg-green-400' : 'bg-yellow-400'}`}
              style={{ width: `${Math.min(progreso, 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-400">
              {!esActivo ? '✓ ' : ''}Pagado: {formatCOP(cuotaInicial + totalAbonado)}
            </span>
            {esActivo && (
              <span className="font-medium text-red-500">Saldo: {formatCOP(saldoPendiente)}</span>
            )}
          </div>
          {cuotaInicial > 0 && (
            <p className="text-[11px] text-gray-400">
              Cuota inicial: {formatCOP(cuotaInicial)}
            </p>
          )}
        </div>

        {/* Acciones — solo créditos activos */}
        {esActivo && (
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" className="flex-1" onClick={() => onAbonar(credito)}>
              <Plus size={14} /> Abonar
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onSaldar(credito)}>
              <CheckCircle size={14} /> Saldado
            </Button>
            <button onClick={() => onDevolucion(credito)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                border border-orange-200 text-orange-600 bg-orange-50 hover:bg-orange-100
                transition-colors">
              <RotateCcw size={12} /> Devolver
            </button>
            <button onClick={() => onCancelar(credito)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                border border-red-200 text-red-500 bg-red-50 hover:bg-red-100
                transition-colors">
              <XCircle size={12} /> Cancelar
            </button>
          </div>
        )}
      </div>

      {/* Plazo de pago y mora (solo si el negocio activó la feature).
          Los números vienen calculados del backend en credito.mora. */}
      {esActivo && (
        <div className="px-4 pb-4 -mt-1">
          <PanelMora
            documento={credito}
            configMora={configMora}
            metodosPago={metodosPago}
            invalidar={[['creditos'], ['credito-detalle'], ['estado-cuenta-credito'], ['caja']]}
            api={{
              fijarPlazo:   (d) => fijarPlazoCredito(credito.id, d),
              cobrarMora:   (d) => cobrarMoraCredito(credito.id, d),
              condonarMora: (d) => condonarMoraCredito(credito.id, d),
            }}
          />
          {/* Interés por financiar: cargo aparte, panel aparte. */}
          <div className="mt-2">
            <PanelInteres
              documento={credito}
              configInteres={configInteres}
              metodosPago={metodosPago}
              invalidar={[['creditos'], ['credito-detalle'], ['estado-cuenta-credito'], ['caja']]}
              api={{
                fijarInteres:  (d) => fijarInteresCredito(credito.id, d),
                cobrarCargo:   (d) => cobrarMoraCredito(credito.id, d),
                condonarCargo: (d) => condonarMoraCredito(credito.id, d),
              }}
            />
          </div>
        </div>
      )}

      {/* Historial de abonos desplegable */}
      {tieneMovimientos && (
        <div className="border-t border-gray-100">
          <button
            onClick={() => setHistorialAbierto((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2 text-xs text-gray-500
              hover:bg-gray-50 transition-colors font-medium">
            <span>Historial de abonos</span>
            {historialAbierto
              ? <ChevronUp size={13} className="text-gray-400" />
              : <ChevronDown size={13} className="text-gray-400" />}
          </button>
          {historialAbierto && (
            <div className="px-4 pb-4">
              <HistorialAbonos creditoId={credito.id} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Exportaciones (mismo par de botones que en Préstamos) ───────────────────

function BotonExportarPdfCredito({ clave, nombre }) {
  const [modalAbierto, setModalAbierto] = useState(false);

  const opciones = [{
    id:          'cuenta',
    Icn:         LayoutList,
    titulo:      'Estado de cuenta',
    descripcion: 'Todos los movimientos (facturas, cuotas iniciales, abonos, devoluciones y ajustes) con saldo acumulado en 5 columnas.',
    color:       'purple',
    archivo:     `estado-cuenta-${nombre || clave}.pdf`,
    descargar:   () => descargarPdfEstadoCuentaCredito(clave),
  }];

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setModalAbierto(true); }}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium
          border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100
          hover:border-blue-300 transition-colors flex-shrink-0">
        <FileDown size={12} />
        PDF
      </button>
      {modalAbierto && (
        <ModalExportarCuenta
          opciones={opciones}
          personaNombre={nombre}
          onClose={() => setModalAbierto(false)}
        />
      )}
    </>
  );
}

function BotonExportarExcelCredito({ clave, nombre, cedula, telefono, creditos }) {
  const [cargando, setCargando] = useState(false);

  // Los movimientos se piden al backend en el momento: así el Excel sale con
  // exactamente las mismas cifras que la pestaña Estado de cuenta y el PDF.
  const handleClick = async (e) => {
    e.stopPropagation();
    if (cargando) return;
    setCargando(true);
    try {
      const res = await getEstadoCuentaCredito(clave);
      exportarCuentaCreditoExcel({
        nombre, cedula, telefono, creditos, movimientos: res.data.data || [],
      });
    } catch {
      alert('No se pudo generar el Excel. Intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  };

  return (
    <button onClick={handleClick} disabled={cargando}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium
        border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100
        hover:border-emerald-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0">
      {cargando ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />}
      Excel
    </button>
  );
}

// ─── Vista detalle de persona ─────────────────────────────────────────────────

function VistaDetallePersonaCredito({
  persona, onVolver, onAbonar, onSaldar, onCancelar, onDevolucion, onImprimir,
}) {
  const [cerradosAbiertos, setCerradosAbiertos] = useState(false);
  const [tabDetalle,       setTabDetalle]       = useState('creditos'); // 'creditos' | 'cuenta'

  const creditosActivos  = persona.creditos.filter((c) => c.estado === 'Activo');
  const creditosCerrados = persona.creditos.filter((c) => c.estado !== 'Activo');

  const totalDeuda = creditosActivos.reduce((s, c) => {
    const val = Number(c.valor_total);
    const ini = Number(c.cuota_inicial || 0);
    const abo = Number(c.total_abonado || 0);
    return s + Math.max(0, Number(c.saldo_pendiente ?? (val - ini - abo)));
  }, 0);

  const totalPagado = persona.creditos.reduce(
    (s, c) => s + Number(c.total_abonado || 0) + Number(c.cuota_inicial || 0), 0
  );

  return (
    <div className="flex flex-col gap-4">

      {/* Botón volver */}
      <button onClick={onVolver}
        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700
          w-fit transition-colors">
        <ChevronLeft size={16} /> Volver
      </button>

      {/* Ficha de cuenta */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">

        {/* Identidad */}
        <div className="p-4 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center
            text-sm font-bold flex-shrink-0 bg-yellow-100 text-yellow-700">
            {iniciales(persona.nombre_cliente)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-900 text-base leading-tight truncate">
              {persona.nombre_cliente}
            </p>
            <div className="flex flex-wrap gap-x-3 mt-0.5">
              {persona.cedula  && <p className="text-xs text-gray-400">CC: {persona.cedula}</p>}
              {persona.celular && <p className="text-xs text-gray-400">Tel: {persona.celular}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <BotonExportarPdfCredito clave={persona.key} nombre={persona.nombre_cliente} />
            <BotonExportarExcelCredito
              clave={persona.key}
              nombre={persona.nombre_cliente}
              cedula={persona.cedula}
              telefono={persona.celular}
              creditos={persona.creditos}
            />
          </div>
        </div>

        {/* Métricas */}
        <div className="grid grid-cols-2 divide-x divide-gray-100 border-t border-gray-100">
          <div className="px-4 py-3 flex flex-col gap-0.5">
            <p className="text-xs text-gray-400">Deuda total</p>
            <p className={`text-sm font-bold ${totalDeuda > 0 ? 'text-red-500' : 'text-gray-400'}`}>
              {totalDeuda > 0 ? formatCOP(totalDeuda) : '—'}
            </p>
          </div>
          <div className="px-4 py-3 flex flex-col gap-0.5">
            <p className="text-xs text-gray-400">Total pagado</p>
            <p className={`text-sm font-bold ${totalPagado > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
              {totalPagado > 0 ? formatCOP(totalPagado) : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs: Créditos / Estado de cuenta — mismo patrón que Préstamos */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {[
          { id: 'creditos', label: 'Créditos' },
          { id: 'cuenta',   label: 'Estado de cuenta' },
        ].map((tab) => (
          <button key={tab.id} onClick={() => setTabDetalle(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all
              ${tabDetalle === tab.id
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Estado de cuenta ── */}
      {tabDetalle === 'cuenta' && <EstadoCuentaCredito clave={persona.key} />}

      {/* ── Tab: Créditos ── */}
      {tabDetalle === 'creditos' && (
        <>

      {/* Créditos activos */}
      {creditosActivos.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">
            Activos ({creditosActivos.length})
          </p>
          {creditosActivos.map((c) => (
            <TarjetaCreditoDetalle
              key={c.id}
              credito={c}
              onAbonar={onAbonar}
              onSaldar={onSaldar}
              onCancelar={onCancelar}
              onDevolucion={onDevolucion}
              onImprimir={onImprimir}
            />
          ))}
        </div>
      )}

      {creditosActivos.length === 0 && (
        <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-center">
          <p className="text-green-700 text-sm font-medium">✓ Sin créditos activos</p>
        </div>
      )}

      {/* Historial cerrados (colapsable) */}
      {creditosCerrados.length > 0 && (
        <div className="border border-gray-100 rounded-2xl overflow-hidden">
          <button
            onClick={() => setCerradosAbiertos((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3
              bg-gray-50 hover:bg-gray-100 transition-colors">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Historial cerrados
              </span>
              <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">
                {creditosCerrados.length}
              </span>
            </div>
            {cerradosAbiertos
              ? <ChevronUp  size={15} className="text-gray-400" />
              : <ChevronDown size={15} className="text-gray-400" />}
          </button>
          {cerradosAbiertos && (
            <div className="flex flex-col gap-2.5 p-3">
              {creditosCerrados.map((c) => (
                <TarjetaCreditoDetalle
                  key={c.id}
                  credito={c}
                  onAbonar={onAbonar}
                  onSaldar={onSaldar}
                  onCancelar={onCancelar}
                  onDevolucion={onDevolucion}
                  onImprimir={onImprimir}
                  cerrado
                />
              ))}
            </div>
          )}
        </div>
      )}

        </>
      )}
    </div>
  );
}

// ─── Card persona (vista lista) ───────────────────────────────────────────────

function CardPersonaCredito({ persona, onSeleccionar }) {
  const activos  = persona.creditos.filter((c) => c.estado === 'Activo');
  const cerrados = persona.creditos.filter((c) => c.estado !== 'Activo');

  const totalDeuda = activos.reduce((s, c) => {
    const val = Number(c.valor_total);
    const ini = Number(c.cuota_inicial || 0);
    const abo = Number(c.total_abonado || 0);
    return s + Math.max(0, Number(c.saldo_pendiente ?? (val - ini - abo)));
  }, 0);

  const totalPagado = activos.reduce(
    (s, c) => s + Number(c.total_abonado || 0) + Number(c.cuota_inicial || 0), 0
  );
  const totalValor = activos.reduce((s, c) => s + Number(c.valor_total), 0);
  const pct = totalValor > 0 ? Math.min(100, (totalPagado / totalValor) * 100) : 0;

  return (
    <div
      onClick={onSeleccionar}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSeleccionar()}
      className="w-full text-left bg-white border border-gray-100 rounded-2xl p-4
        hover:border-yellow-300 hover:shadow-sm active:scale-[0.99] transition-all
        flex items-center gap-3 cursor-pointer"
    >
      {/* Avatar */}
      <div className="w-11 h-11 rounded-xl flex items-center justify-center
        flex-shrink-0 text-sm font-bold bg-yellow-100 text-yellow-700">
        {iniciales(persona.nombre_cliente)}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-gray-900 leading-tight truncate">
            {persona.nombre_cliente}
          </p>
          {totalDeuda > 0 && (
            <span className="text-sm font-bold text-red-500 flex-shrink-0 leading-tight">
              {formatCOP(totalDeuda)}
            </span>
          )}
        </div>

        {persona.cedula && (
          <p className="text-xs text-gray-400 mt-0.5">CC: {persona.cedula}</p>
        )}

        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {activos.length > 0 && (
            <span className="text-xs bg-yellow-50 text-yellow-700 px-2 py-0.5
              rounded-full font-medium border border-yellow-200">
              {activos.length} activa{activos.length !== 1 ? 's' : ''}
            </span>
          )}
          {cerrados.length > 0 && (
            <span className="text-xs bg-gray-50 text-gray-400 px-2 py-0.5 rounded-full">
              {cerrados.length} cerrada{cerrados.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {activos.length > 0 && (
          <div className="mt-2 w-full bg-gray-100 rounded-full h-1">
            <div className="bg-yellow-400 h-1 rounded-full transition-all"
              style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      <ChevronRight size={15} className="text-gray-300 flex-shrink-0" />
    </div>
  );
}

// ─── Sección: personas con solo créditos cerrados ────────────────────────────

function SeccionPersonasSinDeuda({ personas, onSeleccionar }) {
  const [abierto, setAbierto] = useState(false);
  const total = personas.reduce((s, p) => s + p.creditos.length, 0);

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden mt-1">
      <button onClick={() => setAbierto((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5
          bg-gray-50 hover:bg-gray-100 transition-colors">
        <span className="text-xs font-semibold text-gray-500">
          {personas.length} persona{personas.length !== 1 ? 's' : ''} sin deuda activa
          {' '}({total} crédito{total !== 1 ? 's' : ''} cerrado{total !== 1 ? 's' : ''})
        </span>
        {abierto
          ? <ChevronUp   size={15} className="text-gray-400" />
          : <ChevronDown size={15} className="text-gray-400" />}
      </button>

      {abierto && (
        <div className="flex flex-col gap-1 p-2">
          {personas.map((persona) => (
            <button key={persona.key} onClick={() => onSeleccionar(persona)}
              className="w-full text-left flex items-center justify-between px-3 py-2.5
                bg-white hover:bg-gray-50 transition-colors rounded-xl">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-700 truncate">
                  {persona.nombre_cliente}
                </p>
                {persona.cedula && (
                  <p className="text-xs text-gray-400">CC: {persona.cedula}</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">
                  {persona.creditos.length} cerrada{persona.creditos.length !== 1 ? 's' : ''}
                </span>
                <ChevronRight size={13} className="text-gray-300" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

/**
 * @param {string} [personaInicial] — cédula (o nombre) del cliente que hay que
 *   abrir apenas entra. Lo manda la notificación de cobro: el vendedor no tiene
 *   que buscar a nadie, llega directo a la cuenta del cliente.
 */
export function TabCreditos({ personaInicial = null }) {
  const [personaSeleccionada, setPersonaSeleccionada] = useState(null);
  // Marca que el usuario ya cerró la ficha que abrió la notificación.
  const [cerroInicial,        setCerroInicial]        = useState(false);
  const [creditoAbono,        setCreditoAbono]        = useState(null);
  const [creditoSaldar,       setCreditoSaldar]       = useState(null);
  const [creditoCancelar,     setCreditoCancelar]     = useState(null);
  const [creditoDevolucion,   setCreditoDevolucion]   = useState(null);
  const [creditoImprimir,     setCreditoImprimir]     = useState(null);

  const { data: creditosData, isLoading } = useQuery({
    queryKey: ['creditos'],
    queryFn:  () => getCreditos().then((r) => r.data.data),
  });

  // Agrupa créditos por persona usando cédula como clave (o nombre si no tiene)
  const creditosPorPersona = useMemo(() => {
    const creditos = creditosData || [];
    const mapa = new Map();
    for (const c of creditos) {
      const key = c.cedula || c.nombre_cliente;
      if (!mapa.has(key)) {
        mapa.set(key, {
          key,
          cedula:         c.cedula,
          nombre_cliente: c.nombre_cliente,
          celular:        c.celular,
          creditos:       [],
        });
      }
      mapa.get(key).creditos.push(c);
    }
    return Array.from(mapa.values());
  }, [creditosData]);

  const personasActivas  = creditosPorPersona.filter((p) => p.creditos.some((c) => c.estado === 'Activo'));
  const personasCerradas = creditosPorPersona.filter((p) => p.creditos.every((c) => c.estado !== 'Activo'));

  // Apertura automática desde una notificación de cobro.
  //
  // Se DERIVA en el render en vez de hacerse con un efecto que llame a
  // setState: así no hay un parpadeo de la lista antes de abrir la ficha, ni el
  // riesgo de que vuelva a abrirse sola. `cerroInicial` es lo que permite
  // cerrarla: sin esa marca, volver atrás la reabriría en el siguiente render.
  const personaAuto = (!cerroInicial && personaInicial && !personaSeleccionada)
    ? creditosPorPersona.find((p) => String(p.key) === String(personaInicial)) ?? null
    : null;

  // Mantiene la persona en sync con los datos actualizados tras mutaciones
  const personaActualizada = personaSeleccionada
    ? creditosPorPersona.find((p) => p.key === personaSeleccionada.key) ?? personaSeleccionada
    : personaAuto;

  const modales = (
    <>
      {creditoAbono && (
        <ModalAbonoCredito credito={creditoAbono} onClose={() => setCreditoAbono(null)} />
      )}
      {creditoSaldar && (
        <ModalSaldarCredito credito={creditoSaldar} onClose={() => setCreditoSaldar(null)} />
      )}
      {creditoCancelar && (
        <ModalCancelarCredito credito={creditoCancelar} onClose={() => setCreditoCancelar(null)} />
      )}
      {creditoDevolucion && (
        <ModalDevolucionParcialCredito credito={creditoDevolucion}
          onClose={() => setCreditoDevolucion(null)} />
      )}
      {creditoImprimir && (
        <DocumentosCredito credito={creditoImprimir}
          onClose={() => setCreditoImprimir(null)} />
      )}
    </>
  );

  // ── Vista detalle de persona ──────────────────────────────────────────────
  // `personaActualizada` cubre los dos caminos: la que el usuario abrió y la que
  // trajo la notificación.
  if (personaActualizada) {
    return (
      <>
        <VistaDetallePersonaCredito
          persona={personaActualizada}
          onVolver={() => { setPersonaSeleccionada(null); setCerroInicial(true); }}
          onAbonar={setCreditoAbono}
          onSaldar={setCreditoSaldar}
          onCancelar={setCreditoCancelar}
          onDevolucion={setCreditoDevolucion}
          onImprimir={setCreditoImprimir}
        />
        {modales}
      </>
    );
  }

  // ── Vista lista ────────────────────────────────────────────────────────────
  if (isLoading) return <Spinner className="py-20" />;

  return (
    <>
      <div className="flex flex-col gap-3">
        {personasActivas.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            titulo="Sin créditos activos"
            descripcion="Los créditos aparecen al crear facturas a crédito"
          />
        ) : (
          personasActivas.map((persona) => (
            <CardPersonaCredito
              key={persona.key}
              persona={persona}
              onSeleccionar={() => setPersonaSeleccionada(persona)}
            />
          ))
        )}

        {personasCerradas.length > 0 && (
          <SeccionPersonasSinDeuda
            personas={personasCerradas}
            onSeleccionar={setPersonaSeleccionada}
          />
        )}
      </div>
      {modales}
    </>
  );
}
