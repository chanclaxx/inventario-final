import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { devolverABodega } from '../../api/redInterna.api';
import { formatCOP } from '../../utils/formatters';
import { useClaveIdempotencia } from '../../utils/claveIdempotencia';
import { Modal }  from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { PackageX, Info } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// "RECIBÍ TODO" Y FALTABA UNA CAJA
//
// El error más común del día a día del local, y el más caro desde que recibir
// genera la deuda: un toque en "Recibí todo" y la cuenta se carga con mercancía
// que no está. Hasta ahora la única salida era devolver algo que nunca se tuvo.
//
// Esto arma un RECLAMO con las líneas que no llegaron. Por dentro viaja por el
// mismo circuito que una devolución —nace en tránsito, la bodega confirma— y
// hace lo mismo: la línea sale del cargo de su envío y el equipo vuelve al
// inventario de la bodega, que es donde estuvo siempre. Lo que cambia es que
// queda escrito como lo que fue, un faltante y no una devolución.
//
// No se puede reclamar lo ya vendido ni lo prestado: si el equipo salió del
// local, sí llegó.
// ─────────────────────────────────────────────────────────────────────────────

export function ModalReportarFaltante({ envio, onCerrar, onListo }) {
  const [marcadas, setMarcadas] = useState({});
  const [cantidades, setCantidades] = useState({});   // linea_id → cuántas no llegaron
  const [notas, setNotas] = useState('');
  const [error, setError] = useState('');
  const clave = useClaveIdempotencia();

  // Solo lo que sigue en poder del local puede no haber llegado.
  //
  // Las dos mitades se deciden distinto y no es un capricho: un SERIAL se sigue
  // unidad por unidad (`estado_unidad` sabe si se vendió, se prestó o dónde
  // está), y eso no existe para mercancía fungible. Una línea de CANTIDAD se
  // reclama por unidades: el backend manda `reclamable`, que es lo que entregó
  // la línea acotado a lo que el local todavía tiene de esa talla.
  //
  // Antes este filtro exigía `tipo === 'serial'`, así que las líneas de cantidad
  // no eran ni candidatas ni bloqueadas: desaparecían, y un negocio con catálogo
  // por variantes veía siempre "no hay nada que reportar".
  const RECLAMABLES = ['En consignacion', 'Sin ubicar', 'Movida'];
  const recibidas = (envio.lineas || []).filter((l) => l.estado_linea === 'Recibida');

  const esCandidato = (l) => (l.tipo === 'serial'
    ? RECLAMABLES.includes(l.estado_unidad)
    : Number(l.reclamable || 0) > 0);

  const candidatos = recibidas.filter(esCandidato);
  const bloqueadas = recibidas.filter((l) => !esCandidato(l));

  const elegidas = candidatos.filter((l) => marcadas[l.linea_id]);
  // Un serial es una unidad; una línea de cantidad vale por las que se marquen.
  const cantidadDe = (l) => (l.tipo === 'serial'
    ? 1
    : Math.max(1, Math.min(Number(cantidades[l.linea_id] ?? l.reclamable), Number(l.reclamable))));
  const unidades = elegidas.reduce((n, l) => n + cantidadDe(l), 0);
  const total = elegidas.reduce((s, l) => {
    if (l.tipo === 'serial') return s + Number(l.subtotal || 0);
    // El subtotal de la línea es por TODAS sus unidades: se prorratea.
    const porUnidad = Number(l.valor_interno || 0);
    return s + porUnidad * cantidadDe(l);
  }, 0);

  const reportar = useMutation({
    mutationFn: () => devolverABodega({
      lineas: elegidas.map((l) => (l.tipo === 'serial'
        ? { tipo: 'serial', serial_id: l.serial_id }
        : {
            tipo: 'cantidad',
            producto_id: l.producto_destino_id,
            atributo_id: l.atributo_destino_id ?? null,
            variante_id: l.variante_destino_id ?? null,
            cantidad: cantidadDe(l),
          })),
      motivo: 'faltante',
      notas: notas.trim() || 'No llegó en el envío',
      clave_idempotencia: clave(),
    }).then((r) => r.data.data),
    onSuccess: () => onListo(
      'Faltante reportado — la bodega tiene que confirmarlo para que baje tu deuda'
    ),
    onError: (err) => setError(err.response?.data?.error || 'No se pudo reportar'),
  });

  return (
    <Modal
      open onClose={onCerrar} size="md"
      title={`¿Qué no llegó del envío #${envio.numero ?? envio.id}?`}
    >
      <div className="flex flex-col gap-4">
        <div className="bg-amber-50 rounded-xl px-4 py-3">
          <p className="text-xs text-amber-800 flex items-start gap-2">
            <Info size={14} className="mt-0.5 flex-shrink-0" />
            <span>
              Marca lo que confirmaste por error. Queda como un reclamo: tu deuda
              baja cuando la bodega lo revise y confirme que el equipo lo tiene ella.
            </span>
          </p>
        </div>

        {candidatos.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">
            {bloqueadas.length > 0
              ? 'No hay nada que reportar: todo lo de este envío ya se vendió, se prestó o se devolvió.'
              : 'No hay nada que reportar en este envío.'}
          </p>
        ) : (
          <div className="border border-gray-100 rounded-xl overflow-hidden">
            {candidatos.map((l) => (
              <label
                key={l.linea_id}
                className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-50
                  last:border-0 cursor-pointer hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  checked={!!marcadas[l.linea_id]}
                  onChange={(e) => {
                    setMarcadas((m) => ({ ...m, [l.linea_id]: e.target.checked }));
                    setError('');
                  }}
                  className="w-4 h-4 accent-amber-600 flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 truncate">{l.nombre_producto}</p>
                  {l.imei && (
                    <p className="text-xs text-gray-400 font-mono">{l.imei}</p>
                  )}
                </div>
                {l.tipo !== 'serial' && (
                  <div className="flex items-center gap-1.5 flex-shrink-0"
                       onClick={(e) => e.preventDefault()}>
                    <span className="text-xs text-gray-400">no llegaron</span>
                    <input
                      type="number" min={1} max={Number(l.reclamable)}
                      value={cantidades[l.linea_id] ?? l.reclamable}
                      onChange={(e) => setCantidades((c) => ({
                        ...c, [l.linea_id]: e.target.value,
                      }))}
                      className="w-14 px-2 py-1 bg-gray-100 border-0 rounded-lg text-sm
                        text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                    <span className="text-xs text-gray-400">de {l.reclamable}</span>
                  </div>
                )}
                {l.tipo === 'serial' && l.subtotal != null && (
                  <span className="text-xs text-gray-500 tabular-nums flex-shrink-0">
                    {formatCOP(l.subtotal)}
                  </span>
                )}
              </label>
            ))}
          </div>
        )}

        {bloqueadas.length > 0 && (
          <p className="text-xs text-gray-400">
            {bloqueadas.length} producto(s) de este envío no se pueden reclamar:
            ya se vendieron, se prestaron o se devolvieron, así que sí llegaron.
          </p>
        )}

        <input
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          maxLength={200}
          placeholder="¿Qué pasó? (opcional) — la caja venía abierta…"
          className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm
            placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {elegidas.length > 0 && (
          <p className="text-sm text-gray-600">
            Vas a reclamar <strong>{unidades}</strong> unidad(es) por{' '}
            <strong>{formatCOP(total)}</strong>.
          </p>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCerrar}>Cancelar</Button>
          <Button
            className="flex-1"
            disabled={elegidas.length === 0}
            loading={reportar.isPending}
            onClick={() => reportar.mutate()}
          >
            <PackageX size={15} /> Reportar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
