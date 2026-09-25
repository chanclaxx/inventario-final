import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  fijarPlazoEnvio, fijarPlazoLocal, condonarMoraEnvio, anularCondonacionMora,
} from '../../api/redInterna.api';
import { formatCOP, formatFecha } from '../../utils/formatters';
import { hoyBogota, sumarDias } from '../../utils/mora';
import { Modal }  from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { SelectorPlazoEnvio } from './PlazoEnvio';
import { useMoraRed, plazoValido } from './moraEnvio';
import { CalendarClock, HandCoins, Info, Undo2, Wallet } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// LO QUE LA BODEGA HACE CON EL PLAZO Y LA MORA DE UN ENVÍO
//
// Todas las reglas viven en el backend (redInterna.mora.js): quién puede, que
// la fecha no sea pasada, que la condonación no pase de lo pendiente. Estas
// pantallas solo piden el dato y muestran el error que el backend devuelva.
// ─────────────────────────────────────────────────────────────────────────────

const CLASE_INPUT = 'w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500';

/**
 * Poner, cambiar o quitar el plazo de UN envío.
 *   · En camino: días desde que se reciba (la fecha todavía no existe).
 *   · Ya recibido: una fecha límite, nunca anterior a hoy.
 */
export function ModalPlazoEnvio({ envio, onCerrar, onListo }) {
  const mora = useMoraRed();
  const enTransito = envio.estado === 'En transito';
  const actual = envio.mora || {};
  const [valor, setValor] = useState(() => {
    const condicion_id = actual.condicion?.id || mora.defaultId || mora.condiciones[0]?.id || null;
    return condicion_id ? { condicion_id, plazo_dias: actual.plazo_dias || mora.plazoDefault || 15 } : null;
  });
  const [fecha, setFecha] = useState(() =>
    (actual.fecha_limite && actual.fecha_limite >= hoyBogota())
      ? actual.fecha_limite
      : sumarDias(hoyBogota(), mora.plazoDefault || 15));
  const [error, setError] = useState('');

  const guardar = useMutation({
    mutationFn: (quitar) => fijarPlazoEnvio(envio.id, quitar
      ? { quitar: true }
      : enTransito
        ? { plazo_dias: Number(valor.plazo_dias), condicion_id: valor.condicion_id }
        : { fecha_limite: fecha, condicion_id: valor.condicion_id }).then((r) => r.data),
    onSuccess: (res) => onListo(res?.message || 'Plazo guardado'),
    onError: (e) => setError(e.response?.data?.error || 'No se pudo guardar el plazo'),
  });

  const tienePlazo = actual.aplica || !!actual.plazo_dias;

  return (
    <Modal open onClose={onCerrar} size="sm" title={`Plazo de pago · envío #${envio.numero ?? envio.id}`}>
      <div className="flex flex-col gap-4">
        {!mora.activa ? (
          <p className="text-sm text-gray-500">
            El plazo de pago de los envíos está apagado. Enciéndelo en Ajustes → Red interna.
          </p>
        ) : (
          <>
            {/* En camino el selector ya trae los días; ya recibido se elige
                la condición ahí y la fecha abajo. */}
            <SelectorPlazoEnvio mora={mora} valor={valor} onChange={(v) => v && setValor(v)} />
            {!enTransito && valor && (
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Vence el</label>
                <input type="date" value={fecha} min={hoyBogota()}
                  onChange={(e) => { setFecha(e.target.value); setError(''); }}
                  className={CLASE_INPUT} />
                <p className="text-[11px] text-gray-400">
                  No puede ser anterior a hoy: la mora solo corre de la fecha límite en adelante.
                </p>
              </div>
            )}
          </>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          {tienePlazo && (
            <Button variant="secondary" loading={guardar.isPending && guardar.variables === true}
              onClick={() => guardar.mutate(true)}>
              Quitar plazo
            </Button>
          )}
          <Button className="flex-1" disabled={!mora.activa || !valor || !plazoValido(valor)}
            loading={guardar.isPending && guardar.variables === false}
            onClick={() => { setError(''); guardar.mutate(false); }}>
            <CalendarClock size={15} /> Guardar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Plazo a TODOS los envíos abiertos sin plazo de un local. Es para el día en
 * que se enciende la feature: ponérselo uno por uno es lo que hace que nadie
 * lo haga. No pisa los plazos ya pactados.
 */
export function ModalPlazoLocal({ sucursalId, nombreLocal, onCerrar, onListo }) {
  const mora = useMoraRed();
  const [condicion, setCondicion] = useState(mora.defaultId || mora.condiciones[0]?.id || '');
  const [fecha, setFecha] = useState(() => sumarDias(hoyBogota(), mora.plazoDefault || 15));
  const [error, setError] = useState('');

  const guardar = useMutation({
    mutationFn: () => fijarPlazoLocal({ sucursal_id: sucursalId, fecha_limite: fecha, condicion_id: condicion })
      .then((r) => r.data),
    onSuccess: (res) => onListo(res?.message || 'Plazo guardado'),
    onError: (e) => setError(e.response?.data?.error || 'No se pudo guardar'),
  });

  return (
    <Modal open onClose={onCerrar} size="sm" title={`Plazo para los envíos de ${nombreLocal}`}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-gray-500 flex items-start gap-1.5">
          <Info size={13} className="flex-shrink-0 mt-0.5" />
          Se aplica a los envíos recibidos que todavía deben algo y no tienen plazo.
          Los que ya tienen uno no cambian.
        </p>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Condición de mora</label>
          <select value={condicion} onChange={(e) => setCondicion(e.target.value)} className={CLASE_INPUT}>
            {mora.condiciones.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Vencen el</label>
          <input type="date" value={fecha} min={hoyBogota()} onChange={(e) => setFecha(e.target.value)}
            className={CLASE_INPUT} />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCerrar}>Cancelar</Button>
          <Button className="flex-1" disabled={!condicion || !fecha} loading={guardar.isPending}
            onClick={() => { setError(''); guardar.mutate(); }}>
            <CalendarClock size={15} /> Aplicar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Condonar la mora de un envío: solo el admin, desde la bodega, con motivo y PIN. */
export function ModalCondonarMora({ envio, onCerrar, onListo }) {
  const pendiente = Number(envio.mora?.pendiente || 0);
  const [valor, setValor] = useState(pendiente);
  const [motivo, setMotivo] = useState('');
  const [pin, setPin] = useState('');
  const [quitarPlazo, setQuitarPlazo] = useState(false);
  const [error, setError] = useState('');

  const condonar = useMutation({
    mutationFn: () => condonarMoraEnvio(envio.id, {
      valor: Number(valor) || undefined, motivo: motivo.trim(), pin, quitar_plazo: quitarPlazo,
    }).then((r) => r.data),
    onSuccess: (res) => onListo(res?.message || 'Mora condonada'),
    onError: (e) => setError(e.response?.data?.error || 'No se pudo condonar'),
  });

  return (
    <Modal open onClose={onCerrar} size="sm" title={`Condonar mora · envío #${envio.numero ?? envio.id}`}>
      <div className="flex flex-col gap-4">
        <div className="bg-gray-50 rounded-xl px-3.5 py-2.5 text-xs text-gray-500">
          Mora pendiente <strong className="text-gray-800">{formatCOP(pendiente)}</strong>
          {' '}· {envio.mora?.dias_vencidos} día(s) de atraso
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">¿Cuánto condonas?</label>
          <InputMoneda value={valor} onChange={(v) => { setValor(v); setError(''); }} className={CLASE_INPUT} />
        </div>
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)}
          placeholder="Motivo (queda registrado)" className={CLASE_INPUT} />
        <input value={pin} onChange={(e) => setPin(e.target.value)} type="password" inputMode="numeric"
          placeholder="PIN de administrador" className={CLASE_INPUT} />
        <label className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={quitarPlazo} onChange={(e) => setQuitarPlazo(e.target.checked)}
            className="mt-0.5 w-4 h-4" />
          <span>
            Quitarle también el plazo. Condonar no detiene la mora: si el envío sigue vencido,
            mañana vuelve a causarse.
          </span>
        </label>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCerrar}>Cancelar</Button>
          <Button className="flex-1" disabled={!(Number(valor) > 0) || motivo.trim().length < 3 || !pin}
            loading={condonar.isPending} onClick={() => { setError(''); condonar.mutate(); }}>
            <HandCoins size={15} /> Condonar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Los pagos y condonaciones de mora de un envío, dentro de su detalle. Una
 * condonación se puede deshacer (solo el admin, desde la bodega); un cobro se
 * deshace anulando el pago del que salió, que está en la pestaña Pagos.
 */
export function MovimientosMora({ movimientos = [], puedeAnular = false, onCambio }) {
  const [error, setError] = useState('');
  const anular = useMutation({
    mutationFn: (id) => anularCondonacionMora(id).then((r) => r.data),
    onSuccess: (res) => onCambio?.(res?.message || 'Condonación anulada'),
    onError: (e) => setError(e.response?.data?.error || 'No se pudo anular'),
  });
  if (!movimientos.length) return null;
  return (
    <div className="px-4 py-3 border-t border-gray-100">
      <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Mora de este envío</p>
      <div className="flex flex-col gap-1.5">
        {movimientos.map((m) => {
          const condonacion = m.tipo === 'Condonacion';
          const Icn = condonacion ? HandCoins : Wallet;
          return (
            <div key={m.id} className={`flex items-start justify-between gap-3 ${m.efectivo ? '' : 'opacity-60'}`}>
              <span className="inline-flex items-start gap-1.5 text-sm text-gray-700 min-w-0">
                <Icn size={13} className={`${condonacion ? 'text-blue-500' : 'text-green-500'} flex-shrink-0 mt-0.5`} />
                <span className="min-w-0">
                  {condonacion ? 'Mora condonada' : 'Mora pagada'}
                  {m.remesa_numero != null && ` · pago #${m.remesa_numero}`}
                  <span className="block text-xs text-gray-400">
                    {formatFecha(m.fecha)}
                    {m.dias_mora != null ? ` · ${m.dias_mora} día(s) de atraso` : ''}
                    {m.motivo ? ` · ${m.motivo}` : ''}
                    {m.usuario_nombre ? ` · ${m.usuario_nombre}` : ''}
                    {!m.efectivo && ' · sin confirmar por la bodega'}
                  </span>
                </span>
              </span>
              <span className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-sm font-semibold ${condonacion ? 'text-blue-600' : 'text-green-600'}`}>
                  {formatCOP(m.valor)}
                </span>
                {condonacion && puedeAnular && (
                  <button type="button" title="Anular la condonación"
                    onClick={() => { setError(''); anular.mutate(m.id); }}
                    className="p-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50">
                    <Undo2 size={13} />
                  </button>
                )}
              </span>
            </div>
          );
        })}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </div>
  );
}

