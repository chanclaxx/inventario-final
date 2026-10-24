import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PackageCheck, Wrench, FileText, Banknote, XCircle } from 'lucide-react';
import { resolverProveedor } from '../../../api/garantiasProveedor.api';
import { Modal }       from '../../../components/ui/Modal';
import { Button }      from '../../../components/ui/Button';
import { InputMoneda } from '../../../components/ui/InputMoneda';
import { useMetodosPago } from '../../../hooks/useMetodosPago';
import { formatCOP } from '../../../utils/formatters';
import { mensajeError, fechaDia } from './garantiasUi';
import { TarjetaCandidato, OpcionGrande } from './piezasGarantia';
import { refrescarTrasGarantia } from './refrescar';

// ─────────────────────────────────────────────────────────────────────────────
// Lo que respondió el proveedor por una unidad (o parte de un lote):
//   repuso (entra una unidad nueva) · reparó (vuelve la misma) · nota crédito
//   (abona a su cuenta) · devolvió dinero (entra a la caja) · no la cubrió
//   (vuelve al inventario o se da de baja).
// Cuando la unidad vuelve a salir normal, se elige su garantía: la de la compra
// original, unos días nuevos o ninguna.
// ─────────────────────────────────────────────────────────────────────────────

const OPCIONES = [
  { id: 'reposicion',          icono: PackageCheck, color: 'green', titulo: 'Me repuso la unidad',  desc: 'Entra una unidad nueva al inventario, con el costo de la dañada' },
  { id: 'reparacion',          icono: Wrench,       color: 'blue',  titulo: 'Me la reparó',         desc: 'Vuelve la misma unidad y se puede vender' },
  { id: 'nota_credito',        icono: FileText,     color: 'amber', titulo: 'Me dio nota crédito',  desc: 'Baja lo que le debes (o queda a tu favor)' },
  { id: 'reembolso_proveedor', icono: Banknote,     color: 'green', titulo: 'Me devolvió el dinero', desc: 'Entra a la caja de la sucursal' },
  { id: 'rechazo',             icono: XCircle,      color: 'rose',  titulo: 'No la cubrió',         desc: 'La unidad vuelve como está, o se da de baja' },
];

export function ModalRespuestaProveedor({ reclamo, linea, onClose, onHecho }) {
  const queryClient = useQueryClient();
  const metodos = useMetodosPago();
  const pendiente = Number(linea.cantidad) - Number(linea.cantidad_resuelta);
  const [tipo, setTipo]         = useState(null);
  const [cantidad, setCantidad] = useState(pendiente);
  const [imei, setImei]         = useState('');
  const [destino, setDestino]   = useState('reingreso');
  const [valor, setValor]       = useState('');
  const [metodo, setMetodo]     = useState('Efectivo');
  const [garantiaModo, setGarantiaModo] = useState(linea.garantia_proveedor_hasta ? 'original' : 'dias');
  const [dias, setDias]         = useState('90');
  const [notas, setNotas]       = useState('');
  const [error, setError]       = useState('');

  const cant = linea.tipo === 'serial' ? 1 : Math.min(Math.max(1, Number(cantidad) || 1), pendiente);
  const costo = linea.costo_unitario != null ? Number(linea.costo_unitario) * cant : null;
  const vuelveNormal = tipo === 'reposicion' || tipo === 'reparacion';

  const mut = useMutation({
    mutationFn: () => resolverProveedor(linea.id, {
      tipo, cantidad: cant, destino: tipo === 'rechazo' ? destino : undefined,
      unidad: tipo === 'reposicion' && linea.tipo === 'serial' ? { imei: imei.trim() } : undefined,
      valor: ['nota_credito', 'reembolso_proveedor'].includes(tipo) && valor !== '' ? Number(valor) : undefined,
      metodo: tipo === 'reembolso_proveedor' ? metodo : undefined,
      garantia: vuelveNormal ? { modo: garantiaModo, dias: Number(dias) } : undefined,
      notas: notas.trim() || null,
    }),
    onSuccess: () => { refrescarTrasGarantia(queryClient); onHecho?.(); onClose(); },
    onError: (err) => setError(mensajeError(err, 'No se pudo registrar la respuesta')),
  });

  const listo = tipo
    && (tipo !== 'reposicion' || linea.tipo === 'cantidad' || imei.trim())
    && (tipo !== 'reembolso_proveedor' || Number(valor) > 0)
    && (tipo !== 'nota_credito' || Number(valor === '' ? costo : valor) > 0);

  return (
    <Modal open onClose={onClose} title="¿Qué respondió el proveedor?" size="lg">
      <div className="flex flex-col gap-3">
        <TarjetaCandidato c={{ ...linea, tipo: undefined }} compacta />
        <p className="text-xs text-gray-500">
          {reclamo.proveedor_nombre ? `Proveedor: ${reclamo.proveedor_nombre}` : ''}
          {linea.envio_numero ? ` · envío #${linea.envio_numero}` : ''}
        </p>
        {linea.tipo === 'cantidad' && pendiente > 1 && (
          <label className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-700">¿Por cuántas unidades?</span>
            <input type="number" min={1} max={pendiente} value={cantidad} onChange={(e) => setCantidad(e.target.value)}
              className="w-24 px-3 py-2 border border-gray-200 rounded-xl text-sm" />
            <span className="text-xs text-gray-400">quedan {pendiente}; el resto se responde después</span>
          </label>
        )}

        <div className="flex flex-col gap-2">
          {OPCIONES.map((o) => (
            <OpcionGrande key={o.id} activa={tipo === o.id} onClick={() => setTipo(o.id)}
              icono={o.icono} color={o.color} titulo={o.titulo} descripcion={o.desc} />
          ))}
        </div>

        {tipo === 'reposicion' && linea.tipo === 'serial' && (
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-700">IMEI de la unidad que llegó *</span>
            <input value={imei} onChange={(e) => setImei(e.target.value)} autoFocus
              placeholder="Escanéalo o escríbelo"
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-mono" />
          </label>
        )}
        {tipo === 'rechazo' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[['reingreso', 'Vuelve al inventario', 'Como está; se puede vender o mandar a un técnico'],
              ['baja', 'Darla de baja', 'Sale del inventario: se pierde']].map(([id, t, d]) => (
              <button key={id} type="button" onClick={() => setDestino(id)}
                className={`p-3 rounded-xl border-2 text-left ${destino === id ? 'border-rose-400 bg-rose-50/40' : 'border-gray-100'}`}>
                <p className="text-sm font-semibold text-gray-800">{t}</p>
                <p className="text-xs text-gray-500">{d}</p>
              </button>
            ))}
          </div>
        )}
        {tipo === 'nota_credito' && (
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-700">Valor de la nota crédito</span>
            <InputMoneda value={valor === '' ? (costo ?? '') : valor} onChange={setValor} />
            {costo != null && <span className="text-xs text-gray-400">Lo que costó: {formatCOP(costo)}</span>}
          </label>
        )}
        {tipo === 'reembolso_proveedor' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-gray-700">¿Cuánto devolvió? *</span>
              <InputMoneda value={valor} onChange={setValor} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-gray-700">¿Cómo?</span>
              <select value={metodo} onChange={(e) => setMetodo(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white">
                {metodos.filter((m) => m.id !== 'Credito').map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            <p className="sm:col-span-2 text-[11px] text-gray-400">Necesita la caja de la sucursal abierta.</p>
          </div>
        )}
        {vuelveNormal && (
          <div className="flex flex-col gap-1.5 rounded-xl bg-gray-50 p-3">
            <span className="text-sm font-medium text-gray-700">Garantía del proveedor para esta unidad</span>
            <div className="flex flex-wrap gap-1.5">
              {linea.garantia_proveedor_hasta && (
                <button type="button" onClick={() => setGarantiaModo('original')}
                  className={`text-xs px-2.5 py-1 rounded-full border ${garantiaModo === 'original' ? 'border-rose-400 bg-white text-rose-700' : 'border-gray-200 text-gray-600'}`}>
                  La de la compra (hasta {fechaDia(linea.garantia_proveedor_hasta)})
                </button>
              )}
              <button type="button" onClick={() => setGarantiaModo('dias')}
                className={`text-xs px-2.5 py-1 rounded-full border ${garantiaModo === 'dias' ? 'border-rose-400 bg-white text-rose-700' : 'border-gray-200 text-gray-600'}`}>
                Nueva, desde hoy
              </button>
              <button type="button" onClick={() => setGarantiaModo('ninguna')}
                className={`text-xs px-2.5 py-1 rounded-full border ${garantiaModo === 'ninguna' ? 'border-rose-400 bg-white text-rose-700' : 'border-gray-200 text-gray-600'}`}>
                Sin garantía
              </button>
            </div>
            {garantiaModo === 'dias' && (
              <label className="flex items-center gap-2">
                <input type="number" min={0} max={3650} value={dias} onChange={(e) => setDias(e.target.value)}
                  className="w-24 px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white" />
                <span className="text-sm text-gray-500">días</span>
              </label>
            )}
          </div>
        )}
        {tipo && (
          <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Nota (opcional): número de la nota crédito, quién respondió…"
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />
        )}
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mut.isPending} disabled={!listo} onClick={() => { setError(''); mut.mutate(); }}>
            Registrar respuesta
          </Button>
        </div>
      </div>
    </Modal>
  );
}
