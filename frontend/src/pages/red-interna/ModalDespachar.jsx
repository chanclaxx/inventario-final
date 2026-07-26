import { useState, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { buscarParaDespacho, despachar } from '../../api/redInterna.api';
import { formatCOP } from '../../utils/formatters';
import { useClaveIdempotencia } from '../../utils/claveIdempotencia';
import { Modal }  from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Truck, Trash2, Check, AlertTriangle, Store } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// DESPACHAR — 3 pasos, sin un solo campo de precio.
//
// En modo "a costo" el valor lo pone el sistema (el costo real del equipo), así
// que el usuario solo elige el local y escanea. Menos decisiones = menos errores.
// ─────────────────────────────────────────────────────────────────────────────

export function ModalDespachar({ locales, onCerrar, onListo }) {
  const [destino,  setDestino]  = useState(locales.length === 1 ? locales[0].id : null);
  const [items,    setItems]    = useState([]);
  const [imei,     setImei]     = useState('');
  const [error,    setError]    = useState('');
  const [notas,    setNotas]    = useState('');
  const inputRef = useRef(null);
  // Clave estable por modal: si el botón se toca dos veces o se cae la red,
  // el backend devuelve la MISMA remisión en vez de crear otra.
  const clave = useClaveIdempotencia();

  useEffect(() => { if (destino) inputRef.current?.focus(); }, [destino]);

  const buscar = useMutation({
    mutationFn: (valor) => buscarParaDespacho(valor).then((r) => r.data.data),
    onSuccess: (eq) => {
      if (items.some((i) => i.serial_id === eq.serial_id)) {
        setError('Ese equipo ya está en la lista');
      } else {
        setItems((prev) => [...prev, eq]);
        setError('');
      }
      setImei('');
      inputRef.current?.focus();
    },
    onError: (err) => {
      setError(err.response?.data?.error || 'No se encontró ese IMEI');
      setImei('');
      inputRef.current?.focus();
    },
  });

  const enviar = useMutation({
    mutationFn: () => despachar({
      sucursal_destino_id: destino,
      lineas: items.map((i) => ({ tipo: 'serial', serial_id: i.serial_id })),
      notas: notas.trim() || null,
      clave_idempotencia: clave(),
    }).then((r) => r.data.data),
    onSuccess: onListo,
    onError: (err) => setError(err.response?.data?.error || 'No se pudo despachar'),
  });

  const total     = items.reduce((s, i) => s + Number(i.valor_interno || 0), 0);
  const sinCosto  = items.filter((i) => i.sin_costo).length;
  const localName = locales.find((l) => l.id === destino)?.nombre;

  const onSubmitImei = (e) => {
    e.preventDefault();
    const v = imei.trim();
    if (v.length >= 4) buscar.mutate(v);
  };

  return (
    <Modal open onClose={onCerrar} title="Despachar a un local" size="lg">
      <div className="flex flex-col gap-4">

        {/* Paso 1 — a cuál local */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase mb-2">1 · ¿A cuál local?</p>
          <div className="flex flex-wrap gap-2">
            {locales.map((l) => (
              <button
                key={l.id}
                onClick={() => setDestino(l.id)}
                className={`px-4 py-2.5 rounded-xl text-sm font-medium border transition-all
                  ${destino === l.id
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-gray-200 text-gray-700 hover:border-blue-300'}`}
              >
                <Store size={14} className="inline mr-1.5 -mt-0.5" />{l.nombre}
              </button>
            ))}
          </div>
        </div>

        {/* Paso 2 — escanear */}
        <div className={destino ? '' : 'opacity-40 pointer-events-none'}>
          <p className="text-xs font-semibold text-gray-400 uppercase mb-2">2 · Escanea los equipos</p>
          <form onSubmit={onSubmitImei}>
            <input
              ref={inputRef}
              value={imei}
              onChange={(e) => { setImei(e.target.value); setError(''); }}
              placeholder="IMEI — escanea o escribe y pulsa Enter"
              inputMode="numeric"
              autoComplete="off"
              className="w-full px-4 py-3 bg-gray-100 border-0 rounded-xl text-gray-900
                placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500
                focus:bg-white transition-all font-mono"
            />
          </form>

          {error && (
            <p className="text-sm text-red-500 mt-2 flex items-center gap-1.5">
              <AlertTriangle size={14} /> {error}
            </p>
          )}

          {items.length > 0 && (
            <div className="mt-3 border border-gray-100 rounded-xl overflow-hidden">
              {items.map((i) => (
                <div key={i.serial_id}
                  className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-50 last:border-0">
                  <Check size={15} className="text-green-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{i.nombre}</p>
                    <p className="text-xs text-gray-400 font-mono">{i.imei}</p>
                  </div>
                  <span className={`text-sm font-semibold ${i.sin_costo ? 'text-amber-500' : 'text-gray-700'}`}>
                    {formatCOP(i.valor_interno)}
                  </span>
                  <button
                    onClick={() => setItems((p) => p.filter((x) => x.serial_id !== i.serial_id))}
                    className="text-gray-300 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <div className="flex justify-between items-center px-3 py-2.5 bg-gray-50">
                <span className="text-sm text-gray-500">{items.length} equipo(s)</span>
                <span className="text-base font-bold text-gray-900">{formatCOP(total)}</span>
              </div>
            </div>
          )}

          {sinCosto > 0 && (
            <p className="text-xs text-amber-600 mt-2 flex items-center gap-1.5">
              <AlertTriangle size={13} />
              {sinCosto} equipo(s) sin costo registrado: se despachan en $0 y el local
              no tendrá que liquidarlos.
            </p>
          )}
        </div>

        {/* Paso 3 — enviar */}
        {items.length > 0 && (
          <div>
            <input
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Nota (opcional) — quién lo lleva, observaciones…"
              className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm
                placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="secondary" className="flex-1" onClick={onCerrar}>Cancelar</Button>
          <Button
            className="flex-1"
            disabled={!destino || items.length === 0}
            loading={enviar.isPending}
            onClick={() => enviar.mutate()}
          >
            <Truck size={15} /> Despachar {items.length || ''} {localName ? `a ${localName}` : ''}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
