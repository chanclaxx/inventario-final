import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, Pencil, Phone, Store } from 'lucide-react';
import {
  getTecnico, registrarPagoTecnico, anularPagoTecnico, pagarTecnicoPorSucursales,
} from '../../../api/tecnicos.api';
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

const CLASE_INPUT = 'w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white';

// ─────────────────────────────────────────────────────────────────────────────
// La cuenta de UN técnico. Cada sucursal tiene SU PROPIA cuenta con él: sus
// arreglos, sus pagos, sus anticipos y su saldo a favor. Una sede nunca paga lo
// de otra ni gasta el anticipo de otra, y cada pago sale de la caja de la sede
// cuya cuenta se está viendo. El supervisor y el vendedor solo reciben la de su
// sede (lo recorta el backend); el admin ve todas y puede pagar varias de una
// vez — un pago por sede, cada uno de su caja.
// Todo sale del backend ya calculado: la pantalla no suma nada por su lado.
// ─────────────────────────────────────────────────────────────────────────────
export function ModalCuentaTecnico({ tecnicoId, permisos, esAdmin = false, onClose, onEditar }) {
  const queryClient = useQueryClient();
  const metodos = useMetodosPago();
  const [tab, setTab]         = useState('cuenta');
  const [sede, setSede]       = useState(null);   // sucursal elegida; null = la primera
  const [pago, setPago]       = useState(null);   // { tipo } abierto
  const [valor, setValor]     = useState('');
  const [metodo, setMetodo]   = useState('Efectivo');
  const [notas, setNotas]     = useState('');
  const [anulando, setAnulando] = useState(null);
  const [motivo, setMotivo]   = useState('');
  const [pagoTodo, setPagoTodo] = useState(null); // { [sucursal_id]: { valor, metodo } }
  const [error, setError]     = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['tecnico', tecnicoId],
    queryFn:  () => getTecnico(tecnicoId).then((r) => r.data.data),
  });

  const refrescar = () => {
    queryClient.invalidateQueries({ queryKey: ['tecnico', tecnicoId] });
    queryClient.invalidateQueries({ queryKey: ['tecnicos'] });
    queryClient.invalidateQueries({ queryKey: ['tecnicos-equipos'], exact: false });
  };
  const cerrarFormularios = () => { setPago(null); setPagoTodo(null); setAnulando(null); setError(''); };

  const cuentas = data?.cuentas ?? [];
  const actual  = cuentas.find((c) => c.sucursal_id === sede) ?? cuentas[0] ?? null;

  const mutPago = useMutation({
    mutationFn: () => registrarPagoTecnico(tecnicoId, {
      tipo: pago.tipo, valor: Number(valor), metodo, notas: notas || null,
      // El admin DICE de qué caja sale; para los demás el backend usa la suya.
      sucursal_id: actual?.sucursal_id,
    }),
    onSuccess:  () => { cerrarFormularios(); setValor(''); setNotas(''); refrescar(); },
    onError:    (err) => setError(err.response?.data?.error || 'No se pudo registrar'),
  });
  const mutTodo = useMutation({
    mutationFn: () => pagarTecnicoPorSucursales(tecnicoId, {
      pagos: Object.entries(pagoTodo)
        .filter(([, p]) => Number(p.valor) > 0)
        .map(([sucursalId, p]) => ({ sucursal_id: Number(sucursalId), valor: Number(p.valor), metodo: p.metodo })),
    }),
    onSuccess:  () => { cerrarFormularios(); refrescar(); },
    onError:    (err) => setError(err.response?.data?.error || 'No se pudo registrar el pago'),
  });
  const mutAnular = useMutation({
    mutationFn: () => anularPagoTecnico(anulando.id, motivo),
    onSuccess:  () => { cerrarFormularios(); setMotivo(''); refrescar(); },
    onError:    (err) => setError(err.response?.data?.error || 'No se pudo anular'),
  });

  if (isLoading || !data) {
    return <Modal open onClose={onClose} title="Cuenta del técnico" size="xl"><Spinner className="py-10" /></Modal>;
  }
  const { tecnico, resumen, equipos } = data;
  const r = actual?.resumen;
  const conDeuda = cuentas.filter((c) => c.resumen.deuda > 0);
  const variasSedes = cuentas.length > 1;
  const nombreSede = actual?.sucursal_nombre ?? 'tu sucursal';

  const abrirPagoTodo = () => {
    cerrarFormularios();
    setPagoTodo(Object.fromEntries(conDeuda.map((c) => [c.sucursal_id, { valor: c.resumen.deuda, metodo: 'Efectivo' }])));
  };
  const totalPagoTodo = pagoTodo
    ? Object.values(pagoTodo).reduce((s, p) => s + Number(p.valor || 0), 0) : 0;

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

        {/* Total del negocio (admin con varias sedes) o la cuenta de la sede. */}
        {esAdmin && variasSedes && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Cifra label="Le deben las sedes" valor={formatCOP(resumen.deuda)} color={resumen.deuda > 0 ? 'text-red-600' : 'text-gray-400'} />
            <Cifra label="A favor (sedes)"    valor={formatCOP(resumen.saldo_a_favor)} color={resumen.saldo_a_favor > 0 ? 'text-green-700' : 'text-gray-400'} />
            <Cifra label="Equipos afuera"     valor={resumen.equipos_en_tecnico} />
            <Cifra label="Cobrado en total"   valor={formatCOP(resumen.total_cargos)} />
          </div>
        )}

        {cuentas.length === 0 ? (
          <p className="text-sm text-gray-400">Todavía no hay trabajos ni pagos con este técnico.</p>
        ) : (
          <>
            {variasSedes && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Cuenta por sucursal</p>
                <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
                  {cuentas.map((c) => (
                    <button key={c.sucursal_id} onClick={() => { setSede(c.sucursal_id); cerrarFormularios(); }}
                      className={`text-left rounded-xl border px-3 py-2 transition-colors
                        ${c.sucursal_id === actual?.sucursal_id ? 'border-blue-300 bg-blue-50' : 'border-gray-100 bg-white hover:border-gray-200'}`}>
                      <p className="text-sm font-medium text-gray-800 flex items-center gap-1.5"><Store size={13} /> {c.sucursal_nombre}</p>
                      <p className={`text-xs ${c.resumen.deuda > 0 ? 'text-red-600' : c.resumen.saldo_a_favor > 0 ? 'text-green-700' : 'text-gray-400'}`}>
                        {c.resumen.deuda > 0 ? `Le debe ${formatCOP(c.resumen.deuda)}`
                          : c.resumen.saldo_a_favor > 0 ? `A favor ${formatCOP(c.resumen.saldo_a_favor)}` : 'En paz'}
                        {c.resumen.equipos_en_tecnico > 0 ? ` · ${c.resumen.equipos_en_tecnico} afuera` : ''}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Cifra label={`Le debe ${nombreSede}`} valor={formatCOP(r.deuda)} color={r.deuda > 0 ? 'text-red-600' : 'text-gray-400'} />
              <Cifra label="A favor de la sede" valor={formatCOP(r.saldo_a_favor)} color={r.saldo_a_favor > 0 ? 'text-green-700' : 'text-gray-400'} />
              <Cifra label="Equipos afuera" valor={r.equipos_en_tecnico} />
              <Cifra label="Cobrado" valor={formatCOP(r.total_cargos)} />
            </div>

            {permisos.pagar && !pago && !pagoTodo && (
              <div className="flex gap-2 flex-wrap">
                {r.deuda > 0 && (
                  <Button size="sm" onClick={() => { cerrarFormularios(); setPago({ tipo: 'Pago' }); setValor(r.deuda); }}>
                    Pagar lo de {nombreSede}
                  </Button>
                )}
                {esAdmin && conDeuda.length > 1 && (
                  <Button size="sm" variant="success" onClick={abrirPagoTodo}>
                    Pagar todo ({conDeuda.length} sucursales)
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => { cerrarFormularios(); setPago({ tipo: 'Anticipo' }); setValor(''); }}>
                  Dar anticipo
                </Button>
                {r.saldo_a_favor > 0 && (
                  <Button size="sm" variant="secondary" onClick={() => { cerrarFormularios(); setPago({ tipo: 'Devolucion' }); setValor(r.saldo_a_favor); }}>
                    Registrar devolución
                  </Button>
                )}
              </div>
            )}
          </>
        )}

        {pago && actual && (
          <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 flex flex-col gap-2">
            <p className="text-sm font-medium text-gray-800">
              {pago.tipo === 'Pago' ? 'Pago al técnico' : pago.tipo === 'Anticipo' ? 'Anticipo al técnico' : 'El técnico nos devuelve plata'}
              {' · '}{nombreSede}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <InputMoneda value={valor} onChange={setValor} placeholder="$0" autoFocus className={CLASE_INPUT} />
              <select value={metodo} onChange={(e) => setMetodo(e.target.value)} className={CLASE_INPUT}>
                {metodos.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
            <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Nota (opcional)" className={CLASE_INPUT} />
            <p className="text-xs text-gray-500">
              {pago.tipo === 'Devolucion'
                ? `Entra a la caja de ${nombreSede}.`
                : `Sale de la caja de ${nombreSede} y solo cuenta para su cuenta con el técnico.`}
            </p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={cerrarFormularios}>Cancelar</Button>
              <Button size="sm" loading={mutPago.isPending} disabled={!(Number(valor) > 0)} onClick={() => mutPago.mutate()}>
                Registrar
              </Button>
            </div>
          </div>
        )}

        {pagoTodo && (
          <div className="rounded-xl border border-green-100 bg-green-50/40 p-3 flex flex-col gap-2">
            <p className="text-sm font-medium text-gray-800">Pagar lo de varias sucursales</p>
            <p className="text-xs text-gray-500">
              Se registra un pago por sucursal, cada uno sale de SU caja. Si uno no se puede, no se registra ninguno.
            </p>
            {conDeuda.map((c) => {
              const fila = pagoTodo[c.sucursal_id] ?? { valor: '', metodo: 'Efectivo' };
              const setFila = (cambio) => setPagoTodo((t) => ({ ...t, [c.sucursal_id]: { ...fila, ...cambio } }));
              return (
                <div key={c.sucursal_id} className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center">
                  <span className="text-sm text-gray-700">
                    {c.sucursal_nombre} <span className="text-xs text-gray-400">debe {formatCOP(c.resumen.deuda)}</span>
                  </span>
                  <InputMoneda value={fila.valor} onChange={(v) => setFila({ valor: v })} placeholder="$0" className={CLASE_INPUT} />
                  <select value={fila.metodo} onChange={(e) => setFila({ metodo: e.target.value })} className={CLASE_INPUT}>
                    {metodos.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
              );
            })}
            <p className="text-sm text-gray-700 text-right">Total: <span className="font-semibold">{formatCOP(totalPagoTodo)}</span></p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={cerrarFormularios}>Cancelar</Button>
              <Button size="sm" loading={mutTodo.isPending} disabled={!(totalPagoTodo > 0)} onClick={() => mutTodo.mutate()}>
                Registrar pagos
              </Button>
            </div>
          </div>
        )}

        {anulando && (
          <div className="rounded-xl border border-red-100 bg-red-50/40 p-3 flex flex-col gap-2">
            <p className="text-sm font-medium text-gray-800">
              Anular {ETIQUETA_MOV[anulando.tipo]?.toLowerCase()} de {formatCOP(anulando.valor)}
            </p>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (obligatorio)" autoFocus className={CLASE_INPUT} />
            <p className="text-xs text-gray-500">No se borra: queda en el estado de cuenta con su motivo y deja de contar en la caja.</p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={cerrarFormularios}>Cancelar</Button>
              <Button size="sm" variant="danger" loading={mutAnular.isPending} disabled={!motivo.trim()} onClick={() => mutAnular.mutate()}>
                Anular
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-1.5 border-b border-gray-100">
          {[['cuenta', variasSedes ? `Estado de cuenta · ${nombreSede}` : 'Estado de cuenta'], ['equipos', `Trabajos (${equipos.length})`]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px
                ${tab === id ? 'border-blue-500 text-blue-700' : 'border-transparent text-gray-500'}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'cuenta' && (
          !actual || actual.extracto.length === 0 ? <p className="text-sm text-gray-400 py-4">Sin movimientos todavía.</p> : (
            <div className="flex flex-col divide-y divide-gray-50">
              {[...actual.extracto].reverse().map((m) => {
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
                        <button onClick={() => { cerrarFormularios(); setAnulando(m.detalle); setMotivo(''); }}
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
                      {variasSedes && e.sucursal_nombre ? `${e.sucursal_nombre} · ` : ''}
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
