import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getTecnico, recibirDeTecnico } from '../../../api/tecnicos.api';
import { Modal }       from '../../../components/ui/Modal';
import { Button }      from '../../../components/ui/Button';
import { InputMoneda } from '../../../components/ui/InputMoneda';
import { useMetodosPago } from '../../../hooks/useMetodosPago';
import { formatCOP }   from '../../../utils/formatters';

// ─────────────────────────────────────────────────────────────────────────────
// El equipo vuelve del técnico. Aquí se decide todo lo que ese regreso mueve:
//   · el costo que cobró → sube el costo del equipo (inventario), o se carga a
//     la venta / a la orden (equipo ya vendido o del cliente);
//   · la garantía (precargada con la del técnico);
//   · el precio de venta, SOLO si alguien lo escribe;
//   · la plata: pagarle ahora, dejarlo a crédito, o que devuelva el anticipo.
// El saldo que se muestra es una PROYECCIÓN; el backend lo recalcula y valida.
// ─────────────────────────────────────────────────────────────────────────────
export function ModalRecibirEquipo({ equipo, puedePagar = false, onClose, onRecibido }) {
  const metodos = useMetodosPago();
  const esReclamo = !!equipo.reclamo_de_id;

  const { data: cuenta } = useQuery({
    queryKey: ['tecnico', equipo.tecnico_id],
    queryFn:  () => getTecnico(equipo.tecnico_id).then((r) => r.data.data),
  });

  const [resultado, setResultado] = useState('Reparado');
  const [costo, setCosto]         = useState('');
  const [garantia, setGarantia]   = useState(null);     // null = aún no tocada → usa la del técnico
  const [precio, setPrecio]       = useState('');
  const [cargarA, setCargarA]     = useState(equipo.orden_servicio_id ? 'orden' : 'venta');
  const [notas, setNotas]         = useState('');
  const [pago, setPago]           = useState('');
  const [metodoPago, setMetodoPago] = useState('Efectivo');
  const [devolucion, setDevolucion] = useState('');
  const [metodoDev, setMetodoDev] = useState('Efectivo');
  const [error, setError]         = useState('');

  const garantiaDefecto = cuenta?.tecnico?.garantia_dias_default ?? '';
  const garantiaValor = garantia ?? (garantiaDefecto === null ? '' : String(garantiaDefecto));

  const costoNum = Number(costo || 0);
  // Reclamo en $0 = cubierto por la garantía: hereda lo que faltaba de ella.
  // Si el técnico cobró, es un trabajo pagado y lleva garantía propia.
  const reclamoGratis = esReclamo && costoNum === 0;
  const saldoAntes = Number(cuenta?.resumen?.saldo ?? 0);
  const saldoDespues = saldoAntes + costoNum - Number(pago || 0) + Number(devolucion || 0);
  const aFavorTrasCargo = Math.max(0, -(saldoAntes + costoNum));

  const mut = useMutation({
    mutationFn: () => recibirDeTecnico(equipo.id, {
      resultado,
      costo:         costoNum,
      garantia_dias: resultado === 'Reparado' && !reclamoGratis && garantiaValor !== '' ? Number(garantiaValor) : undefined,
      precio_venta:  equipo.origen === 'inventario' && precio !== '' ? Number(precio) : undefined,
      cargar_a:      equipo.origen === 'vendido' ? cargarA : undefined,
      notas:         notas || null,
      pago:          puedePagar && Number(pago) > 0 ? { valor: Number(pago), metodo: metodoPago } : undefined,
      devolucion:    puedePagar && Number(devolucion) > 0 ? { valor: Number(devolucion), metodo: metodoDev } : undefined,
    }),
    onSuccess: (r) => { onRecibido?.(r.data.data); onClose(); },
    onError:   (err) => setError(err.response?.data?.error || 'No se pudo recibir el equipo'),
  });

  const destinoCosto = equipo.origen === 'inventario'
    ? 'Se suma al costo del equipo (con su rastro).'
    : equipo.origen === 'vendido'
      ? (cargarA === 'venta'
          ? 'Se carga a la venta de este equipo: baja la utilidad de esa venta.'
          : 'Va al costo de la orden del cliente.')
      : 'Va al costo de la orden del cliente.';

  return (
    <Modal open onClose={onClose} size="lg" title="Recibir del técnico">
      <div className="flex flex-col gap-4">
        <div className="rounded-xl bg-gray-50 px-3 py-2">
          <p className="text-sm font-medium text-gray-800">{equipo.descripcion_equipo}</p>
          <p className="text-xs text-gray-500">
            {equipo.imei && <span className="font-mono">{equipo.imei} · </span>}
            {equipo.tecnico_nombre} · salida #{equipo.salida_numero}
          </p>
          <p className="text-xs text-gray-600 mt-1">Trabajo: {equipo.trabajo}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {['Reparado', 'Sin_reparar'].map((r) => (
            <button key={r} onClick={() => setResultado(r)}
              className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all
                ${resultado === r ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-600'}`}>
              {r === 'Reparado' ? 'Volvió reparado' : 'Volvió sin reparar'}
            </button>
          ))}
        </div>

        {esReclamo && (
          <p className="text-sm text-purple-700 bg-purple-50 rounded-xl px-3 py-2">
            {reclamoGratis
              ? 'Reclamo de garantía cubierto: sin costo. La garantía que queda es lo que faltaba de la original.'
              : 'El técnico cobró este reclamo: el costo se aplica como en cualquier trabajo y lleva garantía propia.'}
          </p>
        )}
        <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-700">
              {esReclamo
                ? 'Lo que cobró el técnico por el reclamo (déjalo en $0 si lo cubrió la garantía)'
                : resultado === 'Reparado' ? 'Lo que cobró el técnico' : 'Lo que cobró por el diagnóstico (puede ser $0)'}
            </span>
            <InputMoneda value={costo} onChange={setCosto} placeholder="$0" autoFocus
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />
            {costoNum > 0 && <span className="text-xs text-gray-500">{destinoCosto}</span>}
        </div>

        {equipo.origen === 'vendido' && costoNum > 0 && (
          <div className="flex flex-col gap-1.5 rounded-xl border border-amber-100 bg-amber-50 p-3">
            <span className="text-sm font-medium text-amber-800">Este equipo ya se había vendido. ¿A dónde va el costo?</span>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="radio" checked={cargarA === 'venta'} onChange={() => setCargarA('venta')} />
              A la venta original (baja la utilidad de esa venta)
            </label>
            {equipo.orden_servicio_id && (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="radio" checked={cargarA === 'orden'} onChange={() => setCargarA('orden')} />
                A la orden de servicio del cliente (lo que le cobres entra por la orden)
              </label>
            )}
          </div>
        )}

        {resultado === 'Reparado' && !reclamoGratis && (
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-700">Garantía del técnico (días)</span>
            <input type="number" min="0" value={garantiaValor} onChange={(e) => setGarantia(e.target.value)}
              placeholder="Sin garantía"
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />
          </label>
        )}

        {equipo.origen === 'inventario' && (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-700">Nuevo precio de venta (opcional)</span>
            <InputMoneda value={precio} onChange={setPrecio} placeholder="Déjalo vacío para no cambiarlo"
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />
          </div>
        )}

        {puedePagar && (
          <div className="flex flex-col gap-2 rounded-xl border border-gray-100 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Cuenta de {equipo.tecnico_nombre} con este cargo</span>
              <span className={`font-semibold ${saldoAntes + costoNum > 0 ? 'text-red-600' : 'text-green-700'}`}>
                {saldoAntes + costoNum >= 0
                  ? `Le debemos ${formatCOP(saldoAntes + costoNum)}`
                  : `A favor ${formatCOP(-(saldoAntes + costoNum))}`}
              </span>
            </div>
            {saldoAntes + costoNum > 0 && (
              <>
                <span className="text-sm font-medium text-gray-700">Pagarle ahora (lo que no, queda a crédito)</span>
                <div className="grid grid-cols-2 gap-2">
                  <InputMoneda value={pago} onChange={setPago} placeholder="$0"
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />
                  <select value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white">
                    {metodos.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
              </>
            )}
            {aFavorTrasCargo > 0 && (
              <>
                <span className="text-sm font-medium text-gray-700">
                  ¿El técnico devolvió plata del anticipo? (si no, los {formatCOP(aFavorTrasCargo)} quedan a favor para el próximo trabajo)
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <InputMoneda value={devolucion} onChange={setDevolucion} placeholder="$0"
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />
                  <select value={metodoDev} onChange={(e) => setMetodoDev(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white">
                    {metodos.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
              </>
            )}
            {(Number(pago) > 0 || Number(devolucion) > 0) && (
              <p className="text-xs text-gray-500">
                Queda: {saldoDespues > 0 ? `le debemos ${formatCOP(saldoDespues)}` : saldoDespues < 0
                  ? `${formatCOP(-saldoDespues)} a favor` : 'en paz'}
              </p>
            )}
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700">Notas del regreso</span>
          <input value={notas} onChange={(e) => setNotas(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={mut.isPending} onClick={() => mut.mutate()}>Recibir</Button>
        </div>
      </div>
    </Modal>
  );
}
