import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Wrench, Trash2, Replace, Undo2, History, AlertTriangle, Check, Layers, Smartphone,
} from 'lucide-react';
import { corregirEntrada, getCorreccionesEntrada } from '../../api/entradas.api';
import { getArbol }   from '../../api/variantesProductoApi';
import { Modal }      from '../../components/ui/Modal';
import { Button }     from '../../components/ui/Button';
import { Spinner }    from '../../components/ui/Spinner';
import { Badge }      from '../../components/ui/Badge';
import { formatFechaHora } from '../../utils/formatters';
import { hojasDelArbol }   from '../proveedores/capturaMercancia.utils';

// ─────────────────────────────────────────────────────────────────────────────
// CORREGIR UNA ENTRADA — sin rehacerla
//
// Antes, un dedazo del bodeguero (la talla equivocada, un IMEI mal tecleado, 12
// donde eran 10) solo tenía una salida: cancelar la entrada COMPLETA y volver a
// capturarla entera, treinta IMEI incluidos. Nadie hace eso; lo que se hace es
// dejarlo mal y que administración lo descubra semanas después.
//
// ── Las tres decisiones de esta pantalla ────────────────────────────────────
//
//   1. NO PIDE PRECIOS. Ni uno. Igual que registrar la entrada: el bodeguero
//      cuenta cajas, y el backend resuelve el valor con EXACTAMENTE el mismo
//      criterio que usó al recibir. Si algún día aparece una cifra aquí, el
//      diseño se torció.
//
//   2. TODO EN UNA SOLA PETICIÓN. Los cambios se acumulan y se mandan juntos:
//      una transacción, un rollback si algo falla. Mandarlos de a uno dejaría la
//      entrada a medio corregir cuando el tercero rebotara.
//
//   3. EL HISTORIAL VA AL LADO, no escondido. Corregir stock sin poder ver quién
//      cambió qué es justo lo que vuelve imposible rastrear un descuadre — y es
//      la razón por la que la bitácora se escribe en la misma transacción que la
//      corrección.
//
// Solo se abre mientras la entrada siga SIN CONFIRMAR: hasta ahí lo que hay es
// stock provisional. Después hay precios reales y deuda, y el camino es la
// devolución al proveedor o la corrección de precios, cada uno con su circuito.
// ─────────────────────────────────────────────────────────────────────────────

const etiquetaNodo = (l) => {
  if (l.variante_valor) return `${l.variante_tipo ? `${l.variante_tipo}: ` : ''}${l.variante_valor}`;
  if (l.atributo_valor) return `${l.atributo_tipo ? `${l.atributo_tipo}: ` : ''}${l.atributo_valor}`;
  return null;
};

// ── Elegir a qué variante se mueve la línea ─────────────────────────────────
function SelectorNodo({ productoId, sucursalId, actual, onElegir, onCancelar }) {
  const { data: arbol = [], isLoading } = useQuery({
    queryKey: ['arbol-producto', productoId, sucursalId],
    queryFn:  () => getArbol(productoId, sucursalId).then((r) => r.data.data),
    enabled:  Boolean(productoId) && Boolean(sucursalId),
    staleTime: 30_000,
  });
  const hojas = hojasDelArbol(arbol);

  return (
    <div className="border border-purple-200 bg-purple-50/40 rounded-lg p-2 flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-purple-700">¿Cuál era en realidad?</p>
        <button type="button" onClick={onCancelar}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
          cancelar
        </button>
      </div>
      {isLoading ? <Spinner className="py-4 scale-75" /> : hojas.length === 0 ? (
        <p className="text-xs text-gray-400 py-2">Este producto no tiene variantes</p>
      ) : (
        <div className="max-h-40 overflow-y-auto flex flex-col gap-0.5">
          {hojas.map((h) => (
            <button key={h.key} type="button" disabled={h.key === actual}
              onClick={() => onElegir(h)}
              className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-left text-xs
                ${h.key === actual
                  ? 'text-gray-300 cursor-default'
                  : 'text-gray-700 hover:bg-white transition-colors'}`}>
              <span className="truncate">{h.labelPadre ? `${h.labelPadre} · ` : ''}{h.label}</span>
              {h.key === actual && <span className="flex-shrink-0">la que está</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Una línea de la entrada, con sus correcciones pendientes ────────────────
function FilaCorregible({ linea, sucursalId, cambio, onCambiar, onDeshacer }) {
  const [eligiendo, setEligiendo] = useState(false);
  const esSerial  = Boolean(linea.imei);
  const yaDevuelta = Number(linea.cantidad_devuelta || 0) > 0;

  const nodoActual = linea.variante_id ? `v-${linea.variante_id}`
    : linea.atributo_id ? `a-${linea.atributo_id}` : null;

  const quitada  = cambio?.quitar === true;
  const cantidad = cambio?.cantidad ?? Number(linea.cantidad);
  const nodoNuevo = cambio?.nodoLabel ?? null;
  const imeiNuevo = cambio?.imei ?? null;
  const tocada   = Boolean(cambio);

  // Una línea ya devuelta tiene su propio circuito y su nota crédito: dejar que
  // la corrección la pise contaría la baja dos veces.
  if (yaDevuelta) {
    return (
      <div className="border border-gray-100 bg-gray-50 rounded-xl p-3">
        <p className="text-sm text-gray-400">{linea.nombre_producto}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          tiene una devolución registrada · se corrige desde el proveedor
        </p>
      </div>
    );
  }

  return (
    <div className={`border rounded-xl p-3 flex flex-col gap-2 transition-colors
      ${quitada ? 'border-red-200 bg-red-50/40'
        : tocada ? 'border-amber-200 bg-amber-50/40' : 'border-gray-100 bg-white'}`}>

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {esSerial
              ? <Smartphone size={13} className="text-gray-300 flex-shrink-0" />
              : etiquetaNodo(linea)
                ? <Layers size={13} className="text-purple-400 flex-shrink-0" />
                : null}
            <span className={`text-sm font-medium truncate
              ${quitada ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
              {linea.nombre_producto}
            </span>
          </div>

          {/* Lo que hay hoy, y debajo lo que va a quedar. Ver las dos a la vez es
              lo que hace que nadie confirme un cambio sin darse cuenta. */}
          <p className="text-xs text-gray-400 mt-0.5">
            {esSerial
              ? linea.imei
              : `${linea.cantidad} uds${etiquetaNodo(linea) ? ` · ${etiquetaNodo(linea)}` : ''}`}
          </p>
          {tocada && !quitada && (
            <p className="text-xs text-amber-700 font-medium mt-0.5">
              → {imeiNuevo ?? `${cantidad} uds${nodoNuevo ? ` · ${nodoNuevo}` : ''}`}
            </p>
          )}
          {quitada && (
            <p className="text-xs text-red-600 font-medium mt-0.5">→ se quita de la entrada</p>
          )}
        </div>

        {tocada ? (
          <button type="button" onClick={onDeshacer} title="Dejarla como estaba"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100
                       transition-colors flex-shrink-0">
            <Undo2 size={14} />
          </button>
        ) : (
          <button type="button" onClick={() => onCambiar({ quitar: true })} title="No llegó"
            className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50
                       transition-colors flex-shrink-0">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {!quitada && (esSerial ? (
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 flex-shrink-0">IMEI correcto</label>
          <input
            value={imeiNuevo ?? linea.imei ?? ''}
            onChange={(e) => onCambiar({
              ...cambio,
              imei: e.target.value.trim() === (linea.imei || '') ? undefined : e.target.value,
            })}
            className="flex-1 px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg
                       text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs text-gray-500">Llegaron</label>
            <input
              type="number" min="1" value={cantidad}
              onChange={(e) => {
                const n = Math.max(1, Number(e.target.value) || 1);
                onCambiar(n === Number(linea.cantidad) && !nodoNuevo
                  ? null
                  : { ...cambio, cantidad: n });
              }}
              className="w-20 px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg
                         text-sm font-semibold text-center tabular-nums
                         focus:outline-none focus:ring-1 focus:ring-amber-400"
            />
            {nodoActual && !eligiendo && (
              <button type="button" onClick={() => setEligiendo(true)}
                className="flex items-center gap-1 text-xs font-medium text-purple-600
                           hover:text-purple-700 transition-colors">
                <Replace size={11} /> Era otra variante
              </button>
            )}
          </div>

          {eligiendo && (
            <SelectorNodo
              productoId={linea.producto_id} sucursalId={sucursalId} actual={nodoActual}
              onCancelar={() => setEligiendo(false)}
              onElegir={(h) => {
                onCambiar({
                  ...cambio,
                  variante_id: h.tipo === 'variante' ? h.id : null,
                  atributo_id: h.tipo === 'atributo' ? h.id : null,
                  nodoLabel:   `${h.labelPadre ? `${h.labelPadre} · ` : ''}${h.label}`,
                });
                setEligiendo(false);
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── El historial ────────────────────────────────────────────────────────────
const VERBO = {
  cantidad: 'cambió la cantidad',
  nodo:     'cambió la variante',
  imei:     'corrigió el IMEI',
  agregar:  'agregó',
  quitar:   'quitó',
};

function Historial({ entradaId }) {
  const { data: filas = [], isLoading } = useQuery({
    queryKey: ['correcciones-entrada', entradaId],
    queryFn:  () => getCorreccionesEntrada(entradaId).then((r) => r.data.data || []),
  });

  if (isLoading) return <Spinner className="py-4 scale-75" />;
  if (filas.length === 0) {
    return <p className="text-xs text-gray-400 py-2">Esta entrada no se ha corregido.</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {filas.map((f) => (
        <div key={f.id} className="text-xs text-gray-600 border-l-2 border-gray-200 pl-2.5 py-0.5">
          <span className="font-medium text-gray-800">{f.usuario_nombre || 'Alguien'}</span>
          {' '}{VERBO[f.accion] || f.accion}{' '}
          <span className="text-gray-800">{f.nombre_producto}</span>
          {/* El antes y el después van CONGELADOS en la bitácora: renombrar la
              talla mañana no puede reescribir lo que pasó ayer. */}
          {(f.antes_etiqueta || f.despues_etiqueta) && (
            <span className="text-purple-600">
              {' '}{f.antes_etiqueta || '—'} → {f.despues_etiqueta || '—'}
            </span>
          )}
          {(f.antes_imei || f.despues_imei) && f.accion === 'imei' && (
            <span className="text-purple-600"> {f.antes_imei} → {f.despues_imei}</span>
          )}
          {f.antes_cantidad != null && f.despues_cantidad != null
            && f.antes_cantidad !== f.despues_cantidad && (
            <span className="text-amber-700"> {f.antes_cantidad} → {f.despues_cantidad} uds</span>
          )}
          <span className="block text-gray-400">
            {formatFechaHora(f.fecha)}{f.motivo ? ` · ${f.motivo}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ModalCorregirEntrada({ entrada, onClose, onListo }) {
  const queryClient = useQueryClient();
  // Los cambios se acumulan por línea y se mandan JUNTOS: una transacción, un
  // rollback si algo falla. De a uno, la entrada quedaría a medio corregir en
  // cuanto el tercero rebotara.
  const [cambios, setCambios] = useState({});
  const [motivo,  setMotivo]  = useState('');
  const [error,   setError]   = useState('');
  const [verHistorial, setVerHistorial] = useState(false);

  const lineas = entrada?.lineas || [];
  const pendientes = Object.entries(cambios).filter(([, c]) => c);

  const operaciones = pendientes.map(([lineaId, c]) => {
    if (c.quitar) return { linea_id: Number(lineaId), quitar: true };
    const op = { linea_id: Number(lineaId) };
    if (c.imei != null)     op.imei = c.imei.trim();
    if (c.cantidad != null) op.cantidad = Number(c.cantidad);
    // Los dos campos van juntos o no van: el backend distingue "cambia el nodo"
    // de "no lo toques" por la PRESENCIA de las claves, no por su valor.
    if (c.nodoLabel != null) {
      op.variante_id = c.variante_id ?? null;
      op.atributo_id = c.atributo_id ?? null;
    }
    return op;
  });

  const mut = useMutation({
    mutationFn: () => corregirEntrada(entrada.id, {
      operaciones,
      motivo: motivo.trim() || null,
    }),
    onSuccess: (res) => {
      for (const k of ['entradas', 'entradas-ordenes', 'entradas-por-confirmar',
        'productos-cantidad', 'productos-serial', 'arbol-producto',
        'correcciones-entrada', 'ordenes-compra', 'acreedores']) {
        queryClient.invalidateQueries({ queryKey: [k], exact: false });
      }
      onListo?.(res.data?.message || 'Entrada corregida');
      onClose();
    },
    onError: (e) => setError(e.response?.data?.error || 'No se pudo corregir la entrada'),
  });

  if (!entrada) return null;

  // La frontera. La pantalla lo explica en vez de dejar que el usuario descubra
  // el 409 después de teclear diez cambios.
  if (entrada.factura_confirmada) {
    return (
      <Modal open onClose={onClose} size="md" title="Ya no se puede corregir aquí">
        <div className="flex flex-col gap-3">
          <div className="bg-amber-50 rounded-xl px-3 py-2.5 flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              Administración ya confirmó esta entrada contra la factura del proveedor,
              así que tiene precios reales y deuda asociada.
            </p>
          </div>
          <p className="text-xs text-gray-500">
            Para cambiarla, usa la <span className="font-medium">devolución al proveedor</span>
            {' '}(si la mercancía se va) o la <span className="font-medium">corrección de precios</span>
            {' '}(si solo cambia el valor). Las dos dejan su rastro en la cuenta del proveedor.
          </p>
          <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Entendido</Button></div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} size="lg"
      title={`Corregir entrada #${String(entrada.numero ?? entrada.id).padStart(4, '0')}`}>
      <div className="flex flex-col gap-4">

        <div className="bg-blue-50 rounded-xl px-3 py-2.5 flex items-start gap-2">
          <Wrench size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-800">
            Arregla lo que quedó mal sin volver a capturar la entrada. El inventario
            se ajusta solo y cada cambio queda registrado con tu nombre.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {lineas.map((l) => (
            <FilaCorregible
              key={l.id} linea={l} sucursalId={entrada.sucursal_id}
              cambio={cambios[l.id]}
              onCambiar={(c) => setCambios((prev) => ({ ...prev, [l.id]: c }))}
              onDeshacer={() => setCambios((prev) => ({ ...prev, [l.id]: null }))}
            />
          ))}
        </div>

        {operaciones.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">¿Por qué? (opcional)</label>
            <input
              value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300}
              placeholder="Ej: me equivoqué de talla al recibir"
              className="px-3 py-2 text-sm border border-gray-200 rounded-xl
                         focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
        )}

        <div className="border-t border-gray-100 pt-3">
          <button type="button" onClick={() => setVerHistorial((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500
                       hover:text-gray-800 transition-colors">
            <History size={13} /> {verHistorial ? 'Ocultar' : 'Ver'} el historial de cambios
          </button>
          {verHistorial && <div className="mt-2"><Historial entradaId={entrada.id} /></div>}
        </div>

        {error && (
          <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-xs text-gray-400">
            {operaciones.length === 0
              ? 'No has cambiado nada'
              : `${operaciones.length} ${operaciones.length === 1 ? 'cambio' : 'cambios'}`}
            {operaciones.length > 0 && <Badge variant="amber" className="ml-2">sin guardar</Badge>}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button loading={mut.isPending} disabled={operaciones.length === 0}
              onClick={() => { setError(''); mut.mutate(); }}>
              <Check size={15} /> Guardar correcciones
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
