import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, FileDown, Share2, Loader2, ShieldCheck, Truck } from 'lucide-react';
import api from '../../../api/axios.config';
import {
  getGarantia, getEnvioGarantia, rutaPdfGarantia, rutaPdfEnvioGarantia,
} from '../../../api/garantiasProveedor.api';
import { useConfigDocumento } from '../../../hooks/useConfigDocumento';
import useExportarPdfGarantia from '../../../hooks/useExportarPdfGarantia';
import { Modal }   from '../../../components/ui/Modal';
import { Spinner } from '../../../components/ui/Spinner';
import { formatCOP, formatFechaHora, formatFecha } from '../../../utils/formatters';
import {
  DocumentoTermico, EncabezadoNegocio, Divisor, Fila, Firma,
} from '../../../components/documentos/DocumentoTermico';
import { numeroDe, numFactura, fechaDia } from './garantiasUi';

// ─────────────────────────────────────────────────────────────────────────────
// Imprimir una garantía, como el envío de la red interna: primero se ve qué es
// y después se elige la salida — ticket en la impresora POS, PDF A4 o compartir.
//
//   · `reclamoId` → el comprobante para el CLIENTE (nunca lleva costos).
//   · `envioId`   → la guía para el PROVEEDOR (el valor solo si quien imprime
//                   ve costos; el recorte lo hace el backend).
// Los datos son los del detalle de la pantalla y del PDF.
// ─────────────────────────────────────────────────────────────────────────────

const textoCliente = (m) => {
  if (m.tipo === 'cambio') return `Se le entregó: ${m.nombre_producto || 'otra unidad'}${m.imei ? ` (${m.imei})` : ''}`;
  if (m.metodo === 'Crédito') return `Se descontó del crédito: ${formatCOP(m.valor)}`;
  return `Se le devolvió: ${formatCOP(m.valor)} (${m.metodo || 'Efectivo'})`;
};

function ReclamoTermico({ r, config, onClose }) {
  const movCli = (r.movimientos || []).filter((m) => m.lado === 'cliente' && !m.anulado);
  const faltan = (r.lineas || []).reduce((s, l) => s + Math.max(0, Number(l.cantidad) - Number(l.cantidad_cliente)), 0);
  const acc = Array.isArray(r.accesorios) ? r.accesorios : [];
  return (
    <DocumentoTermico id="garantia-termico" config={config}
      tituloModal="Comprobante de garantía listo para imprimir"
      descripcionModal="Se enviará a la impresora térmica." onClose={onClose}>
      {({ fuenteSize }) => (
        <>
          <EncabezadoNegocio config={config} titulo="RECIBO DE GARANTÍA" fuenteSize={fuenteSize} />
          <Fila label="No." valor={`#${numeroDe(r)}`} />
          <Fila label="Fecha:" valor={formatFechaHora(r.fecha)} />
          {r.factura_numero && <Fila label="Factura:" valor={`#${numFactura(r.factura_numero)}`} />}
          {r.prestamo_numero && <Fila label="Préstamo:" valor={`#${r.prestamo_numero}`} />}
          {r.cliente_nombre && (<><Divisor /><Fila label="Cliente:" valor={r.cliente_nombre} negrita />
            {r.cliente_cedula && <Fila label="C.C.:" valor={r.cliente_cedula} />}
            {r.cliente_telefono && <Fila label="Tel:" valor={r.cliente_telefono} />}</>)}
          <Divisor />
          {(r.lineas || []).map((l) => (
            <div key={l.id} style={{ marginTop: '3px' }}>
              <div className="negrita">{l.cantidad} × {l.nombre_producto}</div>
              {l.variante_texto && <div style={{ fontSize: '9px' }}>{l.variante_texto}</div>}
              {l.imei && <div style={{ fontSize: '9px' }}>IMEI: {l.imei}</div>}
            </div>
          ))}
          <Divisor />
          <div style={{ fontSize: '10px' }}>Falla: {r.falla}</div>
          {r.estado_fisico && <div style={{ fontSize: '10px' }}>Estado: {r.estado_fisico}</div>}
          <div style={{ fontSize: '10px' }}>Entregó: {acc.length ? acc.join(', ') : 'solo el producto'}</div>
          {r.origen_tipo !== 'inventario' && (
            <>
              <Divisor />
              {movCli.map((m) => <div key={m.id} style={{ fontSize: '10px' }}>✓ {textoCliente(m)}</div>)}
              {!r.anulado && faltan > 0 && (
                <div className="negrita" style={{ fontSize: '10px', marginTop: '3px' }}>
                  PENDIENTE: {faltan} unidad(es). Le avisaremos cuando el proveedor responda.
                </div>
              )}
            </>
          )}
          {r.anulado && <div className="centrado negrita">** GARANTÍA ANULADA **</div>}
          <Firma titulo="Cliente" identificacion={r.cliente_nombre || null} />
          <Firma titulo="Recibió" identificacion={r.sucursal_nombre} />
          <div style={{ height: '10mm' }} />
        </>
      )}
    </DocumentoTermico>
  );
}

function EnvioTermico({ e, config, onClose }) {
  const verValores = !e.costos_ocultos;
  const lineas = (e.lineas || []).filter((l) => !l.anulado);
  const total = lineas.reduce((s, l) => s + Number(l.costo_unitario || 0) * Number(l.cantidad), 0);
  return (
    <DocumentoTermico id="envio-garantia-termico" config={config}
      tituloModal="Guía de garantía lista para imprimir"
      descripcionModal="Se enviará a la impresora térmica." onClose={onClose}>
      {({ fuenteSize }) => (
        <>
          <EncabezadoNegocio config={config} titulo="ENVÍO DE GARANTÍA" fuenteSize={fuenteSize} />
          <Fila label="No." valor={`#${numeroDe(e)}`} />
          <Fila label="Fecha:" valor={formatFechaHora(e.fecha)} />
          <Fila label="Proveedor:" valor={e.proveedor_nombre} negrita />
          {e.transportadora && <Fila label="Transporta:" valor={e.transportadora} />}
          {e.guia && <Fila label="Guía:" valor={e.guia} />}
          <Divisor />
          <div className="negrita">UNIDADES ({lineas.length})</div>
          {lineas.map((l) => (
            <div key={l.id} style={{ marginTop: '3px' }}>
              <div className="fila">
                <span className="negrita">{l.cantidad} × {l.nombre_producto}</span>
                {verValores && l.costo_unitario != null && <span>{formatCOP(Number(l.costo_unitario) * Number(l.cantidad))}</span>}
              </div>
              {l.imei && <div style={{ fontSize: '9px' }}>IMEI: {l.imei}</div>}
              <div style={{ fontSize: '9px' }}>Falla: {l.falla} (garantía #{l.reclamo_numero})</div>
              {l.compra_numero && (
                <div style={{ fontSize: '9px' }}>
                  Compra #{l.compra_numero} {formatFecha(l.compra_fecha)}
                  {l.garantia_proveedor_hasta ? ` · garantía hasta ${fechaDia(l.garantia_proveedor_hasta)}` : ''}
                </div>
              )}
            </div>
          ))}
          {verValores && (<><Divisor /><Fila label="VALOR:" valor={formatCOP(total)} negrita grande /></>)}
          {e.notas && (<><Divisor /><div style={{ fontSize: '10px' }}>Notas: {e.notas}</div></>)}
          <Firma titulo="Entregó" identificacion={e.sucursal_nombre} />
          <Firma titulo="Recibió (proveedor)" identificacion={e.proveedor_nombre} />
          <div style={{ height: '10mm' }} />
        </>
      )}
    </DocumentoTermico>
  );
}

/** @param {{ reclamoId?: number, envioId?: number, onClose: Function }} props */
export function ModalDocumentoGarantia({ reclamoId = null, envioId = null, onClose }) {
  const [vista, setVista] = useState('menu');
  const { exportando, error, exportar, puedeCompartir } = useExportarPdfGarantia();
  const esEnvio = !!envioId;

  const { data: doc, isLoading, isError } = useQuery({
    queryKey: esEnvio ? ['garantia-envio', envioId] : ['garantia-proveedor', reclamoId],
    queryFn:  () => (esEnvio ? getEnvioGarantia(envioId) : getGarantia(reclamoId)).then((r) => r.data.data),
    staleTime: 30 * 1000,
  });
  const { data: configNegocio } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
  });
  const config = useConfigDocumento(configNegocio, doc?.sucursal_id);

  if (vista === 'pos' && doc) {
    return esEnvio
      ? <EnvioTermico e={doc} config={config} onClose={onClose} />
      : <ReclamoTermico r={doc} config={config} onClose={onClose} />;
  }

  const titulo = esEnvio ? 'Imprimir envío de garantía' : 'Imprimir garantía';
  if (isLoading || isError || !doc) {
    return (
      <Modal open onClose={onClose} title={titulo} size="sm">
        {isError
          ? <p className="text-sm text-red-600 text-center py-6">No se pudo cargar el documento.</p>
          : <Spinner className="py-10" />}
      </Modal>
    );
  }

  const nombreDoc = esEnvio ? `Envío de garantía #${numeroDe(doc)}` : `Garantía #${numeroDe(doc)}`;
  const pdf = esEnvio
    ? { ruta: rutaPdfEnvioGarantia(doc.id), nombreArchivo: `envio-garantia-${numeroDe(doc)}.pdf`,
        titulo: `${nombreDoc} · ${doc.proveedor_nombre}`, texto: `${nombreDoc} para ${doc.proveedor_nombre}` }
    : { ruta: rutaPdfGarantia(doc.id), nombreArchivo: `garantia-${numeroDe(doc)}.pdf`,
        titulo: nombreDoc, texto: `${nombreDoc}${doc.cliente_nombre ? ` de ${doc.cliente_nombre}` : ''}` };
  const Icono = esEnvio ? Truck : ShieldCheck;
  const unidades = (doc.lineas || []).reduce((n, l) => n + Number(l.cantidad || 0), 0);

  return (
    <Modal open onClose={onClose} title={titulo} size="sm">
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Icono size={16} className="text-gray-500" />
            <p className="text-sm font-semibold text-gray-800 flex-1">{nombreDoc}</p>
            {doc.anulado && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">Anulado</span>}
          </div>
          <p className="text-xs text-gray-500">
            {esEnvio ? `Para ${doc.proveedor_nombre}` : (doc.cliente_nombre || 'Sin cliente')} · {formatFechaHora(doc.fecha)}
          </p>
          <p className="text-xs text-gray-500">{(doc.lineas || []).length} producto(s) · {unidades} unidad(es)</p>
          {esEnvio && doc.costos_ocultos && (
            <p className="text-[11px] text-gray-400">Sale sin valores: tu usuario no ve costos.</p>
          )}
          {!esEnvio && <p className="text-[11px] text-gray-400">Es el comprobante para el cliente: no lleva costos.</p>}
        </div>

        <button onClick={() => setVista('pos')}
          className="flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 hover:border-blue-300 hover:bg-blue-50/30 transition-all text-left group">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-200">
            <Printer size={20} className="text-blue-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">Impresora POS</p>
            <p className="text-xs text-gray-400">
              {esEnvio ? 'Guía en ticket para mandar en la caja: unidades, IMEI, falla y firmas'
                : 'Ticket para el cliente: producto, falla, qué se hizo y firmas'}
            </p>
          </div>
        </button>

        <button onClick={() => exportar(pdf, 'descargar')} disabled={exportando}
          className="flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 hover:border-purple-300 hover:bg-purple-50/30 transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed">
          <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center flex-shrink-0 group-hover:bg-purple-200">
            {exportando ? <Loader2 size={20} className="text-purple-600 animate-spin" /> : <FileDown size={20} className="text-purple-600" />}
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">Formato PDF</p>
            <p className="text-xs text-gray-400">Hoja A4 con todos los datos y las firmas</p>
          </div>
        </button>

        {puedeCompartir && (
          <button onClick={() => exportar(pdf, 'compartir')} disabled={exportando}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-medium border-2 border-dashed border-green-300 text-green-700 bg-green-50 hover:bg-green-100 transition-colors disabled:opacity-50">
            <Share2 size={15} /> Compartir {esEnvio ? 'con el proveedor' : 'con el cliente'} (WhatsApp, Telegram…)
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
