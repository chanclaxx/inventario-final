import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, FileDown, Share2, Loader2, Truck, Undo2 } from 'lucide-react';
import { Modal }   from '../../../components/ui/Modal';
import { Spinner } from '../../../components/ui/Spinner';
import api from '../../../api/axios.config';
import { getRemision } from '../../../api/redInterna.api';
import { formatCOP, formatFechaHora } from '../../../utils/formatters';
import useExportarPdfRedInterna from '../../../hooks/useExportarPdfRedInterna';
import {
  DocumentoTermico, EncabezadoNegocio, Divisor, Fila, Firma,
} from '../../../components/documentos/DocumentoTermico';

// ─────────────────────────────────────────────────────────────────────────────
// Imprimir UN envío (o una devolución), como el comprobante de préstamo:
// primero se ve qué es —de dónde a dónde, estado, productos y saldo— y después
// se elige la salida: ticket en la impresora POS (la guía que viaja con la
// mercancía), PDF A4 o compartir.
//
// Los datos son los de `getRemision`, el mismo detalle de la pantalla y del
// PDF: ya vienen con el recorte del vendedor aplicado por el backend, así que
// el ticket nunca muestra un valor que la pantalla esconde.
// ─────────────────────────────────────────────────────────────────────────────

const ESTADO = {
  'En transito': { texto: 'En camino', clase: 'bg-amber-100 text-amber-700' },
  Recibida:      { texto: 'Recibido',  clase: 'bg-green-100 text-green-700' },
  Parcial:       { texto: 'Recibido parcial', clase: 'bg-blue-100 text-blue-700' },
  Anulada:       { texto: 'Anulado',   clase: 'bg-gray-100 text-gray-500' },
};
const ESTADO_LINEA = { Pendiente: 'En camino', Recibida: 'Recibido', Faltante: 'NO LLEGÓ', Devuelta: 'DEVUELTO' };

const numeroDe = (r) => r?.numero ?? r?.id;

// ─── Ticket térmico ──────────────────────────────────────────────────────────

function EnvioTermico({ r, config, onClose }) {
  const esDevolucion = r.tipo === 'devolucion';
  const verValores = !r.costos_ocultos;
  const s = r.resumen || {};
  return (
    <DocumentoTermico
      id="envio-red-termico"
      config={config}
      tituloModal={esDevolucion ? 'Devolución lista para imprimir' : 'Guía de envío lista para imprimir'}
      descripcionModal="Se enviará a la impresora térmica."
      onClose={onClose}
    >
      {({ fuenteSize }) => (
        <>
          <EncabezadoNegocio config={config} titulo={esDevolucion ? 'DEVOLUCIÓN A BODEGA' : 'ENVÍO DE MERCANCÍA'} fuenteSize={fuenteSize} />
          <Fila label="No." valor={`#${numeroDe(r)}`} />
          <Fila label="Estado:" valor={ESTADO[r.estado]?.texto || r.estado} />
          <Fila label="Despacho:" valor={formatFechaHora(r.fecha_emision)} />
          {r.fecha_recepcion && <Fila label="Recibido:" valor={formatFechaHora(r.fecha_recepcion)} />}
          <Divisor />
          <Fila label="De:" valor={r.sucursal_origen_nombre} negrita />
          <Fila label="Para:" valor={r.sucursal_destino_nombre} negrita />
          {r.pedido?.numero && <Fila label="Pedido:" valor={`#${r.pedido.numero}`} />}
          <Divisor />
          <div className="negrita">PRODUCTOS ({(r.lineas || []).length})</div>
          {(r.lineas || []).map((l) => {
            const cant = l.tipo === 'cantidad'
              ? (l.cantidad_recibida != null && Number(l.cantidad_recibida) !== Number(l.cantidad)
                ? `${l.cantidad_recibida}/${l.cantidad}` : String(l.cantidad ?? 1))
              : '1';
            const raro = l.estado_linea === 'Faltante' || l.estado_linea === 'Devuelta';
            return (
              <div key={l.id} style={{ marginTop: '3px' }}>
                <div className="fila">
                  <span className="negrita">{cant} × {l.nombre_producto}</span>
                  {verValores && <span>{formatCOP(l.subtotal)}</span>}
                </div>
                {l.imei && <div style={{ fontSize: '9px' }}>IMEI: {l.imei}</div>}
                {raro && <div style={{ fontSize: '9px' }}>** {ESTADO_LINEA[l.estado_linea]} **</div>}
                {Number(l.cantidad_devuelta) > 0 && (
                  <div style={{ fontSize: '9px' }}>{l.cantidad_devuelta} devuelta(s) a la bodega</div>
                )}
              </div>
            );
          })}
          <Divisor />
          {esDevolucion ? (
            <Fila label="Acreditado:" negrita
              valor={r.estado === 'Recibida' || r.estado === 'Parcial' ? formatCOP(s.acreditado) : 'Pendiente'} />
          ) : r.estado === 'En transito' ? (
            <div className="centrado" style={{ fontSize: '10px' }}>
              Aún no genera deuda: cuenta cuando el local confirme lo que recibió.
            </div>
          ) : (
            <>
              <Fila label="Cargo del envío:" valor={formatCOP(s.cargo)} />
              <Fila label="Abonado:" valor={formatCOP(s.abonado)} />
              {Number(s.mora_pendiente) > 0 ? (
                <>
                  <Fila label="Saldo del producto:" valor={formatCOP(s.saldo)} />
                  <Fila label={`Mora (${r.mora?.dias_cobrables} días):`} valor={formatCOP(s.mora_pendiente)} />
                  <Fila label="TOTAL A PAGAR:" valor={formatCOP(s.total_a_pagar)} negrita grande />
                </>
              ) : (
                <Fila label="SALDO:" valor={formatCOP(s.saldo)} negrita grande />
              )}
            </>
          )}
          {/* El plazo de pago es condición del documento: va en la guía que
              viaja con la mercancía, donde el local la firma. */}
          {!esDevolucion && r.mora?.aplica && (
            <div style={{ fontSize: '10px', marginTop: '4px' }}>
              Plazo de pago: vence {String(r.mora.fecha_limite).split('-').reverse().join('/')}
              {r.mora.condicion?.nombre ? ` · mora ${r.mora.condicion.nombre}: ${r.mora.descripcion}` : ''}
            </div>
          )}
          {!esDevolucion && !r.mora?.aplica && r.mora?.plazo_dias && (
            <div style={{ fontSize: '10px', marginTop: '4px' }}>
              Plazo de pago: {r.mora.plazo_dias} días desde que se reciba
              {r.mora.condicion?.nombre ? ` · mora ${r.mora.condicion.nombre}: ${r.mora.descripcion}` : ''}
            </div>
          )}
          {r.notas && (<><Divisor /><div style={{ fontSize: '10px' }}>Notas: {r.notas}</div></>)}
          <Firma titulo="Entregó" identificacion={r.sucursal_origen_nombre} />
          <Firma titulo="Recibió" identificacion={r.sucursal_destino_nombre} />
          <div className="centrado" style={{ fontSize: '9px', marginTop: '8px' }}>
            Documento interno entre sedes. No es factura de venta.
          </div>
          <div style={{ height: '10mm' }} />
        </>
      )}
    </DocumentoTermico>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────────

/** @param {{ remisionId: number, onClose: Function }} props */
export function ModalDocumentoEnvio({ remisionId, onClose }) {
  const [vista, setVista] = useState('menu'); // 'menu' | 'pos'
  const { exportando, error, exportar, puedeCompartir } = useExportarPdfRedInterna();

  const { data: r, isLoading, isError } = useQuery({
    // La misma clave que el desplegable de la cuenta del envío: si ya se abrió,
    // el modal aparece al instante.
    queryKey: ['red-remision', remisionId],
    queryFn:  () => getRemision(remisionId).then((res) => res.data.data),
    staleTime: 30 * 1000,
  });
  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((res) => res.data.data),
  });

  if (vista === 'pos' && r) return <EnvioTermico r={r} config={config} onClose={onClose} />;

  const esDevolucion = r?.tipo === 'devolucion';
  const titulo = esDevolucion ? 'Imprimir devolución' : 'Imprimir envío';
  if (isLoading || isError || !r) {
    return (
      <Modal open onClose={onClose} title={titulo} size="sm">
        {isError
          ? <p className="text-sm text-red-600 text-center py-6">No se pudo cargar el documento.</p>
          : <Spinner className="py-10" />}
      </Modal>
    );
  }

  const nombreDoc = `${esDevolucion ? 'Devolución' : 'Envío'} #${numeroDe(r)}`;
  const pdf = {
    ruta: `/red-interna/remisiones/${r.id}/pdf`,
    nombreArchivo: `${esDevolucion ? 'devolucion' : 'envio'}-${numeroDe(r)}.pdf`,
    titulo: `${nombreDoc} · ${r.sucursal_origen_nombre} a ${r.sucursal_destino_nombre}`,
    texto: `${nombreDoc} de ${r.sucursal_origen_nombre} para ${r.sucursal_destino_nombre}`,
  };
  const est = ESTADO[r.estado] || { texto: r.estado, clase: 'bg-gray-100 text-gray-500' };
  const s = r.resumen || {};
  const Icono = esDevolucion ? Undo2 : Truck;
  const unidades = (r.lineas || []).reduce(
    (n, l) => n + (l.tipo === 'cantidad' ? Number(l.cantidad_recibida ?? l.cantidad ?? 0) : 1), 0);

  return (
    <Modal open onClose={onClose} title={titulo} size="sm">
      <div className="flex flex-col gap-4">
        {/* Qué se va a imprimir, antes de elegir cómo. */}
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Icono size={16} className="text-gray-500" />
            <p className="text-sm font-semibold text-gray-800 flex-1">{nombreDoc}</p>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${est.clase}`}>{est.texto}</span>
          </div>
          <p className="text-xs text-gray-500">
            {r.sucursal_origen_nombre} → {r.sucursal_destino_nombre} · {formatFechaHora(r.fecha_emision)}
          </p>
          <p className="text-xs text-gray-500">
            {(r.lineas || []).length} producto(s) · {unidades} unidad(es)
          </p>
          {!esDevolucion && r.estado !== 'En transito' && r.estado !== 'Anulada' && (
            <div className="flex items-center justify-between text-xs mt-1 pt-1.5 border-t border-gray-200">
              <span className="text-gray-500">Cargo {formatCOP(s.cargo)} · abonado {formatCOP(s.abonado)}</span>
              <span className={`font-semibold ${Number(s.total_a_pagar ?? s.saldo) > 0 ? 'text-red-600' : 'text-green-700'}`}>
                {Number(s.mora_pendiente) > 0
                  ? `Debe ${formatCOP(s.total_a_pagar)} (mora ${formatCOP(s.mora_pendiente)})`
                  : `Saldo ${formatCOP(s.saldo)}`}
              </span>
            </div>
          )}
          {r.costos_ocultos && (
            <p className="text-[11px] text-gray-400">Sale sin el valor de cada producto: tu usuario no lo ve.</p>
          )}
        </div>

        <button onClick={() => setVista('pos')}
          className="flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 hover:border-blue-300
            hover:bg-blue-50/30 transition-all text-left group">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-200">
            <Printer size={20} className="text-blue-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">Impresora POS</p>
            <p className="text-xs text-gray-400">
              {esDevolucion
                ? 'Ticket con los productos devueltos y las firmas'
                : 'Guía en ticket para mandar con la mercancía: productos, IMEI, saldo y firmas'}
            </p>
          </div>
        </button>

        <button onClick={() => exportar(pdf, 'descargar')} disabled={exportando}
          className="flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 hover:border-purple-300
            hover:bg-purple-50/30 transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed">
          <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center flex-shrink-0 group-hover:bg-purple-200">
            {exportando ? <Loader2 size={20} className="text-purple-600 animate-spin" />
                        : <FileDown size={20} className="text-purple-600" />}
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">Formato PDF</p>
            <p className="text-xs text-gray-400">
              Hoja A4 tipo factura: productos, lo que no llegó o se devolvió, abonos, saldo y firmas
            </p>
          </div>
        </button>

        {puedeCompartir && (
          <button onClick={() => exportar(pdf, 'compartir')} disabled={exportando}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-medium
              border-2 border-dashed border-green-300 text-green-700 bg-green-50 hover:bg-green-100
              transition-colors disabled:opacity-50">
            <Share2 size={15} /> Compartir con el local (WhatsApp, Telegram…)
          </button>
        )}

        {error && <p className="text-xs text-red-500 text-center">{error}</p>}

        <button onClick={onClose}
          className="w-full py-2 rounded-xl border border-gray-200 text-gray-500 text-sm hover:bg-gray-50 transition-colors">
          Cerrar
        </button>
      </div>
    </Modal>
  );
}
