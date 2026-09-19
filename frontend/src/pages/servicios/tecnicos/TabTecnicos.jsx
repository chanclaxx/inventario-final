import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Send, Wrench, Clock, ShieldCheck, RotateCcw, Ban } from 'lucide-react';
import { getTecnicos, getEquiposTecnico, reclamarGarantia, anularEnvio } from '../../../api/tecnicos.api';
import { Button }      from '../../../components/ui/Button';
import { Badge }       from '../../../components/ui/Badge';
import { Modal }       from '../../../components/ui/Modal';
import { Spinner }     from '../../../components/ui/Spinner';
import { EmptyState }  from '../../../components/ui/EmptyState';
import { SearchInput } from '../../../components/ui/SearchInput';
import { useAuth }     from '../../../context/useAuth';
import { formatCOP, formatFecha } from '../../../utils/formatters';
import { puedeTecnicos } from '../../../utils/permisosTecnicos';
import { ESTADOS_EQUIPO, ORIGEN_EQUIPO, etiquetaGarantia } from './tecnicosUi';
import { ModalTecnico }       from './ModalTecnico';
import { ModalEnviarTecnico } from './ModalEnviarTecnico';
import { ModalRecibirEquipo } from './ModalRecibirEquipo';
import { ModalCuentaTecnico } from './ModalCuentaTecnico';

const FILTROS = [
  { id: 'afuera',   label: 'Donde el técnico' },
  { id: 'garantia', label: 'Con garantía vigente' },
  { id: 'todos',    label: 'Todos' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Servicios → Técnicos externos. La pregunta que responde primero: ¿QUIÉN TIENE
// CADA EQUIPO? Con varios técnicos, confundirse de a quién se le dejó qué es el
// error que esta pestaña existe para evitar. Después: cuánto se le debe a cada
// uno, y qué garantías siguen corriendo.
// ─────────────────────────────────────────────────────────────────────────────
export function TabTecnicos() {
  const queryClient = useQueryClient();
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'admin_negocio';
  const permisos = {
    mover:     puedeTecnicos(usuario, 'mover'),
    pagar:     puedeTecnicos(usuario, 'pagar'),
    anular:    puedeTecnicos(usuario, 'anular'),
    gestionar: puedeTecnicos(usuario, 'gestionar'),
  };

  const [filtro, setFiltro]       = useState('afuera');
  const [busqueda, setBusqueda]   = useState('');
  const [todasSedes, setTodasSedes] = useState(false);
  const [modal, setModal]         = useState(null);   // { tipo, ... }
  const [motivo, setMotivo]       = useState('');
  const [error, setError]         = useState('');

  const { data: tecnicos = [], isLoading: cargandoTec } = useQuery({
    queryKey: ['tecnicos'],
    queryFn:  () => getTecnicos().then((r) => r.data.data),
  });

  const { data: equipos = [], isLoading: cargandoEq } = useQuery({
    queryKey: ['tecnicos-equipos', filtro, busqueda, todasSedes],
    queryFn:  () => getEquiposTecnico({
      estado:   filtro === 'afuera' ? 'En_tecnico' : filtro === 'garantia' ? 'Reparado' : undefined,
      busqueda: busqueda || undefined,
      alcance:  esAdmin && todasSedes ? 'negocio' : undefined,
    }).then((r) => r.data.data),
  });
  const visibles = filtro === 'garantia' ? equipos.filter((e) => e.en_garantia) : equipos;

  const refrescar = () => {
    queryClient.invalidateQueries({ queryKey: ['tecnicos'] });
    queryClient.invalidateQueries({ queryKey: ['tecnicos-equipos'], exact: false });
    queryClient.invalidateQueries({ queryKey: ['tecnico'], exact: false });
    queryClient.invalidateQueries({ queryKey: ['ordenes-servicio'], exact: false });
  };
  const cerrar = () => { setModal(null); setMotivo(''); setError(''); };

  const mutReclamo = useMutation({
    mutationFn: () => reclamarGarantia(modal.equipo.id, { trabajo: motivo }),
    onSuccess:  () => { cerrar(); refrescar(); },
    onError:    (err) => setError(err.response?.data?.error || 'No se pudo reclamar la garantía'),
  });
  const mutAnular = useMutation({
    mutationFn: () => anularEnvio(modal.equipo.id, motivo),
    onSuccess:  () => { cerrar(); refrescar(); },
    onError:    (err) => setError(err.response?.data?.error || 'No se pudo anular el envío'),
  });

  const activos = tecnicos.filter((t) => t.activo);

  return (
    <div className="flex flex-col gap-5">
      {/* ── Técnicos y su cuenta ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Técnicos</p>
          <div className="flex gap-2">
            {permisos.gestionar && (
              <Button size="sm" variant="secondary" onClick={() => setModal({ tipo: 'tecnico' })}>
                <Plus size={14} /> Nuevo técnico
              </Button>
            )}
            {permisos.mover && (
              <Button size="sm" onClick={() => setModal({ tipo: 'enviar' })} disabled={!activos.length}>
                <Send size={14} /> Enviar equipos
              </Button>
            )}
          </div>
        </div>
        {cargandoTec ? <Spinner className="py-6" /> : activos.length === 0 ? (
          <EmptyState icon={Wrench} titulo="Sin técnicos"
            descripcion={permisos.gestionar ? 'Crea el primer técnico para mandarle equipos' : 'Pídele a un administrador que cree los técnicos'} />
        ) : (
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {activos.map((t) => (
              <button key={t.id} onClick={() => setModal({ tipo: 'cuenta', tecnicoId: t.id })}
                className="text-left bg-white border border-gray-100 rounded-xl px-4 py-3 shadow-sm hover:border-blue-200 transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-800 truncate">{t.nombre}</p>
                  {t.resumen.equipos_en_tecnico > 0 && (
                    <span className="text-xs text-amber-700 bg-amber-50 rounded-full px-2 py-0.5 flex-shrink-0">
                      {t.resumen.equipos_en_tecnico} afuera
                    </span>
                  )}
                </div>
                {t.especialidad && <p className="text-xs text-gray-400 truncate">{t.especialidad}</p>}
                {/* Cada sede lleva su propia cuenta: deuda en una y saldo a favor en
                    otra NO se compensan, así que pueden salir las dos a la vez. */}
                {t.resumen.deuda > 0 && (
                  <p className="text-sm mt-1 font-medium text-red-600">Le debemos {formatCOP(t.resumen.deuda)}</p>
                )}
                {t.resumen.saldo_a_favor > 0 && (
                  <p className={`text-sm font-medium text-green-700 ${t.resumen.deuda > 0 ? '' : 'mt-1'}`}>
                    A favor {formatCOP(t.resumen.saldo_a_favor)}
                  </p>
                )}
                {!(t.resumen.deuda > 0) && !(t.resumen.saldo_a_favor > 0) && (
                  <p className="text-sm mt-1 font-medium text-gray-400">En paz</p>
                )}
                {esAdmin && t.cuentas?.length > 1 && (
                  <p className="text-xs text-gray-400">Cuentas en {t.cuentas.length} sucursales</p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Equipos ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2 flex-wrap items-center">
          <div className="flex-1 min-w-[12rem]">
            <SearchInput value={busqueda} onChange={setBusqueda} placeholder="IMEI, equipo, trabajo o técnico…" />
          </div>
          {esAdmin && (
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              <input type="checkbox" checked={todasSedes} onChange={(e) => setTodasSedes(e.target.checked)} />
              Todas las sucursales
            </label>
          )}
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {FILTROS.map((f) => (
            <button key={f.id} onClick={() => setFiltro(f.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border flex-shrink-0
                ${filtro === f.id ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-gray-50 border-gray-100 text-gray-600'}`}>
              {f.label}
            </button>
          ))}
        </div>

        {cargandoEq ? <Spinner className="py-8" /> : visibles.length === 0 ? (
          <EmptyState icon={Wrench} titulo={filtro === 'afuera' ? 'Ningún equipo afuera' : 'Sin equipos'}
            descripcion={filtro === 'afuera' ? 'Todos los equipos están en el local' : 'Sin resultados para ese filtro'} />
        ) : (
          <div className="flex flex-col gap-2">
            {visibles.map((e) => {
              const est = ESTADOS_EQUIPO[e.estado] || { badge: 'gray', label: e.estado };
              const garantia = etiquetaGarantia(e);
              return (
                <div key={e.id} className="bg-white border border-gray-100 rounded-xl px-4 py-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={est.badge}>{est.label}</Badge>
                        {e.reclamo_de_id && <Badge variant="purple">Reclamo de garantía</Badge>}
                        <span className="text-sm font-semibold text-gray-800 truncate">{e.descripcion_equipo}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {e.imei && <span className="font-mono">{e.imei} · </span>}
                        <span className="font-medium text-gray-700">{e.tecnico_nombre}</span>
                        {' · '}salida #{e.salida_numero} · {formatFecha(e.fecha_salida)}
                        {e.sucursal_nombre && esAdmin ? ` · ${e.sucursal_nombre}` : ''}
                      </p>
                      <p className="text-xs text-gray-600 mt-0.5">Trabajo: {e.trabajo}</p>
                      {e.origen !== 'inventario' && <p className="text-xs text-amber-700">{ORIGEN_EQUIPO[e.origen]}</p>}
                      {e.estado === 'En_tecnico' && (
                        <p className={`text-xs flex items-center gap-1 mt-0.5 ${e.dias_fuera >= 7 ? 'text-red-600' : 'text-gray-400'}`}>
                          <Clock size={11} /> {e.dias_fuera === 0 ? 'Salió hoy' : `${e.dias_fuera} día(s) afuera`}
                        </p>
                      )}
                      {garantia && (
                        <p className={`text-xs flex items-center gap-1 mt-0.5 ${e.en_garantia ? 'text-green-700' : 'text-gray-400'}`}>
                          <ShieldCheck size={11} /> {garantia}
                        </p>
                      )}
                      {e.estado === 'Anulado' && e.anulado_motivo && <p className="text-xs text-gray-400">Anulado: {e.anulado_motivo}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      {Number(e.costo) > 0 && <p className="text-sm font-semibold text-gray-800">{formatCOP(e.costo)}</p>}
                      {e.costo_serial_nuevo != null && (
                        <p className="text-xs text-gray-400">costo {formatCOP(e.costo_serial_anterior)} → {formatCOP(e.costo_serial_nuevo)}</p>
                      )}
                    </div>
                  </div>
                  {permisos.mover && (
                    <div className="flex gap-2 flex-wrap mt-2 pt-2 border-t border-gray-50">
                      {e.estado === 'En_tecnico' && (
                        <>
                          <Button size="sm" onClick={() => setModal({ tipo: 'recibir', equipo: e })}>Recibir</Button>
                          <Button size="sm" variant="ghost" onClick={() => setModal({ tipo: 'anular', equipo: e })}>
                            <Ban size={13} /> Anular envío
                          </Button>
                        </>
                      )}
                      {e.estado === 'Reparado' && e.en_garantia && !e.tiene_reclamo && (
                        <Button size="sm" variant="secondary" onClick={() => setModal({ tipo: 'reclamo', equipo: e })}>
                          <RotateCcw size={13} /> Reclamar garantía
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Modales ───────────────────────────────────────────────────────── */}
      {modal?.tipo === 'tecnico' && (
        <ModalTecnico key={modal.tecnico?.id ?? 'nuevo'} tecnico={modal.tecnico} onClose={cerrar} onGuardado={refrescar} />
      )}
      {modal?.tipo === 'enviar' && (
        <ModalEnviarTecnico puedePagar={permisos.pagar} onClose={cerrar} onEnviado={refrescar} />
      )}
      {modal?.tipo === 'recibir' && (
        <ModalRecibirEquipo key={modal.equipo.id} equipo={modal.equipo} puedePagar={permisos.pagar}
          onClose={cerrar} onRecibido={refrescar} />
      )}
      {modal?.tipo === 'cuenta' && (
        <ModalCuentaTecnico key={modal.tecnicoId} tecnicoId={modal.tecnicoId} permisos={permisos} esAdmin={esAdmin}
          onClose={cerrar}
          onEditar={(t) => setModal({ tipo: 'tecnico', tecnico: t })} />
      )}
      {(modal?.tipo === 'reclamo' || modal?.tipo === 'anular') && (
        <Modal open onClose={cerrar} title={modal.tipo === 'reclamo' ? 'Reclamar garantía' : 'Anular el envío'}>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-gray-600">
              {modal.equipo.descripcion_equipo} · {modal.equipo.tecnico_nombre}
            </p>
            <p className="text-xs text-gray-500">
              {modal.tipo === 'reclamo'
                ? `El equipo vuelve a ${modal.equipo.tecnico_nombre}, sin costo, ligado a este trabajo. Queda bloqueado hasta que vuelva.`
                : 'Úsalo si el envío se registró por error y el equipo nunca salió. No genera cargo al técnico.'}
            </p>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus
              placeholder={modal.tipo === 'reclamo' ? '¿Qué falló otra vez?' : 'Motivo (obligatorio)'}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={cerrar}>Cancelar</Button>
              {modal.tipo === 'reclamo' ? (
                <Button loading={mutReclamo.isPending} onClick={() => mutReclamo.mutate()}>Mandar al técnico</Button>
              ) : (
                <Button variant="danger" loading={mutAnular.isPending} disabled={!motivo.trim()} onClick={() => mutAnular.mutate()}>
                  Anular envío
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
