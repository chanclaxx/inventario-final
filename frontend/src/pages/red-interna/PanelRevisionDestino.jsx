import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { buscarReferencias } from '../../api/redInterna.api';
import { claveItem } from './claveItem';
import { Button }  from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import {
  AlertTriangle, Check, Search, PackagePlus, ArrowRight, X,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// REVISIÓN DE DESTINO — solo aparece cuando hay algo que decidir.
//
// El backend resuelve solo lo que puede (mismo código, o mismo nombre) y aquí
// únicamente se listan los productos donde NO estuvo seguro. Antes el sistema
// creaba una referencia nueva por su cuenta y el local terminaba con el mismo
// producto duplicado, uno de ellos sin código y por tanto inescaneable.
//
// Para cada dudoso hay dos caminos: engancharlo a una referencia que el local
// ya tiene, o crear una nueva a propósito.
// ─────────────────────────────────────────────────────────────────────────────

function BuscadorReferencia({ sucursalId, tipo, onElegir, onCerrar }) {
  const [q, setQ] = useState('');
  const { data: refs = [], isLoading } = useQuery({
    queryKey: ['red-referencias', sucursalId, tipo, q],
    queryFn:  () => buscarReferencias(sucursalId, { tipo, q }).then((r) => r.data.data),
  });

  return (
    <div className="mt-2 border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100">
        <Search size={13} className="text-gray-400 flex-shrink-0" />
        <input
          value={q} onChange={(e) => setQ(e.target.value)} autoFocus
          placeholder="Buscar en el catálogo del local…"
          className="flex-1 bg-transparent text-sm focus:outline-none placeholder-gray-400"
        />
        <button onClick={onCerrar}><X size={14} className="text-gray-400" /></button>
      </div>
      <div className="max-h-44 overflow-y-auto">
        {isLoading ? (
          <div className="py-5 flex justify-center"><Spinner /></div>
        ) : refs.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-5">Sin resultados</p>
        ) : refs.map((r) => (
          <button
            key={r.id} onClick={() => onElegir(r)}
            className="w-full flex items-center gap-2 px-3 py-2 border-b border-gray-50
              last:border-0 hover:bg-blue-50 transition-colors text-left"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-800 truncate">
                {[r.nombre, r.marca, r.modelo].filter(Boolean).join(' ')}
              </p>
              <p className="text-xs text-gray-400">
                {r.codigo && <span className="font-mono">{r.codigo} · </span>}
                {r.stock != null ? `${r.stock} en stock` : `${r.disponibles ?? 0} disponibles`}
                {r.linea_nombre ? ` · ${r.linea_nombre}` : ''}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

const nombreRef = (r) => [r.nombre, r.marca, r.modelo].filter(Boolean).join(' ');

function FilaDudosa({ item, sucursalId, decision, onDecidir }) {
  const [buscando, setBuscando] = useState(false);

  // Las opciones son las sugerencias del backend MÁS la que el usuario haya
  // buscado a mano. Sin esto, al elegir del buscador la decisión se guardaba
  // pero no se resaltaba nada y parecía que el clic no había funcionado.
  const sugerencias = item.sugerencias || [];
  const elegidaFuera =
    decision?.tipo === 'existente' &&
    !sugerencias.some((s) => Number(s.id) === Number(decision.id));
  const opciones = elegidaFuera
    ? [...sugerencias, { id: decision.id, nombre: decision.nombre, ...(decision.ref || {}) }]
    : sugerencias;

  return (
    <div className="border border-amber-200 bg-amber-50/40 rounded-xl p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle size={15} className="text-amber-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">{item.nombre_origen}</p>
          <p className="text-xs text-gray-400">
            {item.codigo_origen && <span className="font-mono">{item.codigo_origen} · </span>}
            {item.nivel === 'nuevo'
              ? 'El local no tiene esta referencia'
              : 'Puede que ya la tenga con otro nombre'}
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex flex-col gap-1.5 pl-6">
        {opciones.map((s) => {
          const elegida =
            decision?.tipo === 'existente' && Number(decision.id) === Number(s.id);
          return (
            <button
              key={s.id}
              onClick={() => onDecidir({ tipo: 'existente', id: s.id, nombre: s.nombre, ref: s })}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all
                ${elegida ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-white border-gray-200 hover:border-blue-300'}`}
            >
              <ArrowRight size={13} className="flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{nombreRef(s)}</p>
                <p className={`text-xs ${elegida ? 'text-blue-100' : 'text-gray-400'}`}>
                  {s.codigo ? `${s.codigo} · ` : ''}
                  {s.stock != null ? `${s.stock} en stock`
                    : s.disponibles != null ? `${s.disponibles} disponibles` : 'del catálogo'}
                </p>
              </div>
              {elegida && <Check size={14} className="flex-shrink-0" />}
            </button>
          );
        })}

        <div className="flex gap-1.5">
          <button
            onClick={() => onDecidir({ tipo: 'nueva' })}
            className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all
              ${decision?.tipo === 'nueva' ? 'bg-blue-600 border-blue-600 text-white'
                                           : 'bg-white border-gray-200 hover:border-blue-300'}`}
          >
            <PackagePlus size={13} className="flex-shrink-0" />
            <span className="text-sm flex-1">Crear referencia nueva</span>
            {decision?.tipo === 'nueva' && <Check size={14} />}
          </button>
          {!buscando && (
            <button
              onClick={() => setBuscando(true)}
              className="px-3 py-2 rounded-lg border border-gray-200 bg-white
                text-xs text-blue-600 hover:border-blue-300 transition-all whitespace-nowrap"
            >
              Buscar otra
            </button>
          )}
        </div>

        {buscando && (
          <BuscadorReferencia
            sucursalId={sucursalId}
            tipo={item.tipo}
            onCerrar={() => setBuscando(false)}
            onElegir={(r) => {
              // `ref` guarda la fila completa para poder pintarla como opción
              // elegida aunque no venga entre las sugerencias.
              onDecidir({ tipo: 'existente', id: r.id, nombre: r.nombre, ref: r });
              setBuscando(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

export function PanelRevisionDestino({
  revision, localNombre, decisiones, onDecidir, onVolver, onConfirmar, enviando,
}) {
  const dudosos = revision.items.filter((i) => !i.seguro);
  const seguros = revision.items.filter((i) => i.seguro);
  const faltan  = dudosos.filter((i, n) => !decisiones[claveItem(i, n)]).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <p className="text-sm text-amber-800 font-medium">
          {dudosos.length} producto(s) necesitan que decidas
        </p>
        <p className="text-xs text-amber-600 mt-0.5">
          Para no duplicar el catálogo de {localNombre}, dinos a qué referencia va cada uno.
        </p>
      </div>

      {seguros.length > 0 && (
        <p className="text-xs text-gray-400">
          ✓ Los otros {seguros.length} ya se emparejaron solos con lo que el local tiene.
        </p>
      )}

      <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
        {dudosos.map((item, n) => (
          <FilaDudosa
            key={claveItem(item, n)}
            item={item}
            sucursalId={revision.sucursal_destino_id}
            decision={decisiones[claveItem(item, n)]}
            onDecidir={(d) => onDecidir(claveItem(item, n), d)}
          />
        ))}
      </div>

      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onVolver}>Volver</Button>
        <Button
          className="flex-1"
          disabled={faltan > 0}
          loading={enviando}
          onClick={onConfirmar}
        >
          {faltan > 0 ? `Falta decidir ${faltan}` : 'Confirmar y despachar'}
        </Button>
      </div>
    </div>
  );
}
