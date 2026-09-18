import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, Pencil, Phone } from 'lucide-react';
import { getTecnico, registrarPagoTecnico, anularPagoTecnico } from '../../../api/tecnicos.api';
import { Modal }       from '../../../components/ui/Modal';
import { Button }      from '../../../components/ui/Button';
import { Badge }       from '../../../components/ui/Badge';
import { Spinner }     from '../../../components/ui/Spinner';
import { InputMoneda } from '../../../components/ui/InputMoneda';
import { useMetodosPago } from '../../../hooks/useMetodosPago';
import { formatCOP, formatFecha, formatFechaHora } from '../../../utils/formatters';
import { ESTADOS_EQUIPO, etiquetaGarantia } from './tecnicosUi';

const ETIQUETA_MOV = {
  Cargo:       'Reparación',
  Diagnostico: 'Diagnóstico',
  Anticipo:    'Anticipo',
  Pago:        'Pago',
  Devolucion:  'Devolución del técnico',
};

// El estado de cuenta de UN técnico: lo que se le debe (o nos debe), cada
// movimiento con su saldo corrido, y sus trabajos con la garantía de cada uno.
// Todo sale del backend ya calculado: la pantalla no suma nada por su lado.
export function ModalCuentaTecnico({ tecnicoId, permisos, onClose, onEditar }) {
  const queryClient = useQueryClient();
  const metodos = useMetodosPago();
  const [tab, setTab] = useState('cuenta');
  const [pago, setPago] = useState(null);           // { tipo } abierto
  const [valor, setValor] = useState('');
  const [metodo, setMetodo] = useState('Efectivo');
  const [notas, setNotas] = useState('');
  const [anulando, setAnulando] = useState(null);   // pago a anular
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['tecnico', tecnicoId],
    queryFn:  () => getTecnico(tecnicoId).then((r) => r.data.data),
  });

  const refrescar = () => {
    queryClient.invalidateQueries({ queryKey: ['tecnico', tecnicoId] });
    queryClient.invalidateQueries({ queryKey: ['tecnicos'] });
    queryClient.invalidateQueries({ queryKey: ['tecnicos-equipos'], exact: false });
  };

  const mutPago = useMutation({
    mutationFn: () => registrarPagoTecnico(tecnicoId, { tipo: pago.tipo, valor: Number(valor), metodo, notas: notas || null }),
    onSuccess:  () => { setPago(null); setValor(''); setNotas(''); setError(''); refrescar(); },
    onError:    (err) => setError(err.response?.data?.error || 'No se pudo registrar'),
  });
  const mutAnular = useMutation({
    mutationFn: () => anularPagoTecnico(anulando.id, motivo),
    onSuccess:  () => { setAnulando(null); setMotivo(''); setError(''); refrescar(); },
    onError:    (err) => setError(err.response?.data?.error || 'No se pudo anular'),
  });

  if (isLoading || !data) {
    return <Modal open onClose={onClose} title="Cuenta del técnico" size="xl"><Spinner className="py-10" /></Modal>;
  }
  const { tecnico, resumen, extracto, equipos } = data;

  return (
    <Modal open onClose={onClose} size="xl" title={tecnico.nombre}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2 flex-wrap text-sm text-gray-500">
          <span className="flex items-center gap-3 flex-wrap">
            {tecnico.telefono && <span className="flex items-center gap-1"><Phone size={13} /> {tecnico.telefono}</span>}
            {tecnico.especialidad && <span>{tecnico.especialidad}</span>}
            {tecnico.garantia_dias_default != null && <span>Garantía usual: {tecnico.garantia_dias_default} días</span>}
          </span>
          {permisos.gestionar && (
            <Button size="sm" variant="secondary" onClick={() => onEditar(tecnico)}>
              <Pencil size={13} /> Editar
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Cifra label="Le debemos"   valor={formatCOP(resumen.deuda)}         color={resumen.deuda > 0 ? 'text-red-600' : 'text-gray-400'} />
          <Cifra label="A favor nuestro" valor={formatCOP(resumen.saldo_a_favor)} color={resumen.saldo_a_favor > 0 ? 'text-green-700' : 'text-gray-400'} />
          <Cifra label="Equipos afuera" valor={resumen.equipos_en_tecnico} />
          <Cifra label="Cobrado en total" valor={formatCOP(resumen.total_cargos)} />
        </div>

        {permisos.pagar && !pago && (
          <div className="flex gap-2 flex-wrap">
            {resumen.deuda > 0 && <Button size="sm" onClick={() => { setPago({ tipo: 'Pago' }); setValor(resumen.deuda); }}>Pagar</Button>}
            <Button size="sm" variant="secondary" onClick={() => setPago({ tipo: 'Anticipo' })}>Dar anticipo</Button>
            {resumen.saldo_a_favor > 0 && (
              <Button size="sm" variant="secondary" onClick={() => { setPago({ tipo: 'Devolucion' }); setValor(resumen.saldo_a_favor); }}>
                Registrar devolución
              </Button>
            )}
          </div>
        )}

        {pago && (
          <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 flex flex-col gap-2">
            <p className="text-sm font-medium text-gray-800">
              {pago.tipo === 'Pago' ? 'Pago al técnico' : pago.tipo === 'Anticipo' ? 'Anticipo al técnico' : 'El técnico nos devuelve plata'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <InputMoneda value={valor} onChange={setValor} placeholder="$0" autoFocus
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white" />
              <select value={metodo} onChange={(e) => setMetodo(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white">
                {metodos.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
            <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Nota (opcional)"
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white" />
            <p className="text-xs text-gray-500">
              {pago.tipo === 'Devolucion' ? 'Entra a la caja de esta sucursal.' : 'Sale de la caja de esta sucursal.'}
            </p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => { setPago(null); setError(''); }}>Cancelar</Button>
              <Button size="sm" loading={mutPago.isPending} disabled={!(Number(valor) > 0)} onClick={() => mutPago.mutate()}>
                Registrar
              </Button>
            </div>
          </div>
        )}

        {anulando && (
          <div className="rounded-xl border border-red-100 bg-red-50/40 p-3 flex flex-col gap-2">
            <p className="text-sm font-medium text-gray-800">
              Anular {ETIQUETA_MOV[anulando.tipo]?.toLowerCase()} de {formatCOP(anulando.valor)}
            </p>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (obligatorio)" autoFocus
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white" />
            <p className="text-xs text-gray-500">No se borra: queda en el estado de cuenta con su motivo y deja de contar en la caja.</p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => { setAnulando(null); setError(''); }}>Cancelar</Button>
              <Button size="sm" variant="danger" loading={mutAnular.isPending} disabled={!motivo.trim()} onClick={() => mutAnular.mutate()}>
                Anular
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-1.5 border-b border-gray-100">
          {[['cuenta', 'Estado de cuenta'], ['equipos', `Trabajos (${equipos.length})`]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px
                ${tab === id ? 'border-blue-500 text-blue-700' : 'border-transparent text-gray-500'}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'cuenta' && (
          extracto.length === 0 ? <p className="text-sm text-gray-400 py-4">Sin movimientos todavía.</p> : (
            <div className="flex flex-col divide-y divide-gray-50">
              {[...extracto].reverse().map((m) => {
                const esPago = !m.clave.startsWith('c');
                const sube = m.signo > 0;
                return (
                  <div key={m.clave} className={`py-2 flex items-start justify-between gap-3 ${m.anulado ? 'opacity-50' : ''}`}>
                    <div className="min-w-0">
                      <p className={`text-sm font-medium text-gray-800 ${m.anulado ? 'line-through' : ''}`}>
                        {ETIQUETA_MOV[m.tipo] || m.tipo}
                        {!esPago && m.detalle?.descripcion_equipo ? ` · ${m.detalle.descripcion_equipo}` : ''}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatFechaHora(m.fecha)}
                        {!esPago && m.detalle?.imei ? ` · ${m.detalle.imei}` : ''}
                        {esPago && m.detalle?.metodo ? ` · ${m.detalle.metodo}` : ''}
                        {esPago && m.detalle?.sucursal_nombre ? ` · ${m.detalle.sucursal_nombre}` : ''}
                        {esPago && m.detalle?.salida_numero ? ` · salida #${m.detalle.salida_numero}` : ''}
                      </p>
                      {m.anulado && <p className="text-xs text-red-500">Anulado: {m.detalle?.anulado_motivo}</p>}
                      {esPago && m.detalle?.notas && !m.anulado && <p className="text-xs text-gray-400">{m.detalle.notas}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-sm font-semibold ${m.anulado ? 'text-gray-400' : sube ? 'text-red-600' : 'text-green-700'}`}>
                        {sube ? '+' : '−'}{formatCOP(m.valor)}
                      </p>
                      <p className="text-xs text-gray-400">
                        {m.saldo >= 0 ? `debe ${formatCOP(m.saldo)}` : `a favor ${formatCOP(-m.saldo)}`}
                      </p>
                      {esPago && !m.anulado && permisos.anular && (
                        <button onClick={() => { setAnulando(m.detalle); setMotivo(''); }}
                          className="text-xs text-red-500 hover:underline inline-flex items-center gap-1 mt-0.5">
                          <Ban size={11} /> Anular
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {tab === 'equipos' && (
          <div className="flex flex-col divide-y divide-gray-50">
            {equipos.map((e) => {
              const est = ESTADOS_EQUIPO[e.estado] || { badge: 'gray', label: e.estado };
              return (
                <div key={e.id} className="py-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={est.badge}>{est.label}</Badge>
                      {e.reclamo_de_id && <Badge variant="purple">Reclamo de garantía</Badge>}
                      <span className="text-sm font-medium text-gray-800 truncate">{e.descripcion_equipo}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {e.imei && <span className="font-mono">{e.imei} · </span>}
                      Salida #{e.salida_numero} · {formatFecha(e.fecha_salida)} · {e.trabajo}
                    </p>
                    {etiquetaGarantia(e) && <p className="text-xs text-gray-500">{etiquetaGarantia(e)}</p>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    {Number(e.costo) > 0 && <p className="text-sm font-semibold text-gray-800">{formatCOP(e.costo)}</p>}
                    {e.pago && e.pago.pendiente > 0 && <p className="text-xs text-red-500">debe {formatCOP(e.pago.pendiente)}</p>}
                    {e.pago && e.pago.pendiente === 0 && e.pago.valor > 0 && <p className="text-xs text-green-600">pagado</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Cifra({ label, valor, color = 'text-gray-800' }) {
  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-base font-bold ${color}`}>{valor}</p>
    </div>
  );
}
