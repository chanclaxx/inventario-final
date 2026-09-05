import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PackagePlus, Check, Clock, ClipboardList, FileCheck2, ShieldCheck, Wrench,
} from 'lucide-react';
import {
  getEntradas, getOrdenesParaRecibir, getEntradaDetalle,
  getEntradasPorConfirmar, confirmarEntrada,
} from '../../api/entradas.api';
import { ChipGarantia } from '../proveedores/indicadoresOrden';
import { VistaEntrada } from './VistaEntrada';
import { ModalCorregirEntrada } from './ModalCorregirEntrada';
import { getCompraById }  from '../../api/compras.api';
import { getProveedores } from '../../api/proveedores.api';
import { Modal }          from '../../components/ui/Modal';
import { InputMoneda }    from '../../components/ui/InputMoneda';
import { useAuth }        from '../../context/useAuth';
import { useMetodosPago } from '../../hooks/useMetodosPago';
import { Button }      from '../../components/ui/Button';
import { Input }       from '../../components/ui/Input';
import { Spinner }     from '../../components/ui/Spinner';
import { Badge }       from '../../components/ui/Badge';
import { SearchInput } from '../../components/ui/SearchInput';
import { EmptyState }  from '../../components/ui/EmptyState';
import { formatFechaHora, formatCOP } from '../../utils/formatters';
import { useSucursalKey }  from '../../hooks/useSucursalKey';

// ─────────────────────────────────────────────────────────────────────────────
// ENTRADAS DE BODEGA
//
// La pantalla del bodeguero. No hay una sola cifra de dinero: ni costo, ni
// precio de compra, ni proveedor. Él cuenta lo que llegó; administración le
// pone la plata después, contra la factura del proveedor.
//
// ── Una sola pantalla para los dos casos ────────────────────────────────────
// Con pedido y sin pedido NO son flujos distintos: tocar un pedido abre esta
// misma vista con las líneas ya cargadas, y "Registrar entrada" la abre vacía.
// El pedido es un atajo que llena la lista, no un modo aparte. Eso es lo que
// evita la pregunta "¿esto tiene orden o no?" y el segundo tipo de documento.
//
// ── Bodega no crea productos ────────────────────────────────────────────────
// Es deliberado: de los nombres casi iguales salen los duplicados que hoy hay en
// producción. Si algo llega y no está en el catálogo, el backend responde con un
// mensaje que dice a quién pedírselo, en vez de solo negarse.
// ─────────────────────────────────────────────────────────────────────────────

const norm = (r) => (Array.isArray(r) ? r : (Array.isArray(r?.items) ? r.items : []));


// ── Qué llegó exactamente en una entrada ────────────────────────────────────
//
// Se abre con doble clic, igual que la ficha de un producto en el inventario.
// No lleva una sola cifra de dinero: responde "qué entró y hasta cuándo responde
// el proveedor", que son las dos preguntas que se hacen después.
function ModalDetalleEntrada({ entradaId, onCerrar }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['entrada-detalle-bodega', entradaId],
    queryFn:  () => getEntradaDetalle(entradaId).then((r) => r.data.data),
    retry: false,
  });

  const etiquetaNodo = (l) => {
    const partes = [];
    if (l.atributo_valor) partes.push(l.atributo_tipo ? `${l.atributo_tipo}: ${l.atributo_valor}` : l.atributo_valor);
    if (l.variante_valor) partes.push(l.variante_tipo ? `${l.variante_tipo}: ${l.variante_valor}` : l.variante_valor);
    return partes.join(' · ');
  };

  return (
    <Modal open onClose={onCerrar}
      title={data ? `Entrada #${String(data.numero ?? data.id).padStart(4, '0')}` : 'Entrada'}
      size="md">
      {isLoading ? <Spinner className="py-12" /> : isError || !data ? (
        /* Un "no se pudo cargar" a secas obliga a abrir la consola del
           navegador para saber qué pasó. Se muestra el motivo real, y para el
           404 se dice la causa más probable: la pantalla es más nueva que el
           backend que está corriendo. */
        /* Dos 404 muy distintos: "esta ruta no existe en el backend que está
           corriendo" (el despliegue va atrasado) y "no encontré esa entrada".
           El backend los distingue con `code`, así que aquí no hay que adivinar
           — adivinar fue justo lo que mandó a buscar el problema al sitio
           equivocado la primera vez. */
        <div className="flex flex-col gap-2 py-6">
          {error?.response?.data?.code === 'RUTA_NO_EXISTE' ? (
            <>
              <p className="text-sm text-red-600">
                El backend que está corriendo todavía no tiene esta pantalla.
              </p>
              <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
                Vuelve a desplegar el servidor. Para comprobar cuál está activo,
                abre <span className="font-mono">/api/health</span>: ahí sale el
                commit y desde cuándo lleva arriba.
              </p>
            </>
          ) : (
            <p className="text-sm text-red-600">
              {error?.response?.data?.error || 'No se pudo cargar el detalle.'}
            </p>
          )}
          {error?.response?.status && (
            <p className="text-[11px] text-gray-400">Código {error.response.status}</p>
          )}
          <Button variant="secondary" onClick={onCerrar}>Cerrar</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500
            bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
            <span>{formatFechaHora(data.fecha)}</span>
            {data.recibida_por && <span>· recibida por {data.recibida_por}</span>}
            {data.sucursal_nombre && <span>· {data.sucursal_nombre}</span>}
            {data.orden_numero && <span>· OC-{String(data.orden_numero).padStart(4, '0')}</span>}
            {data.factura_confirmada
              ? <Badge variant="green">confirmada</Badge>
              : <span className="flex items-center gap-1 text-amber-600"><Clock size={11} /> por confirmar</span>}
          </div>

          {data.notas && (
            <p className="text-sm text-gray-600 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              {data.notas}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Qué llegó ({data.lineas.length} línea(s))
            </p>
            <div className="flex flex-col gap-1.5 max-h-96 overflow-y-auto pr-1">
              {data.lineas.map((l) => (
                <div key={l.id} className="border border-gray-100 rounded-xl px-3 py-2 flex flex-col gap-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800 break-words">{l.nombre_producto}</p>
                      {etiquetaNodo(l) && (
                        <p className="text-xs text-purple-600">{etiquetaNodo(l)}</p>
                      )}
                      {l.imei && (
                        <p className="text-xs font-mono text-gray-500 break-all">{l.imei}</p>
                      )}
                      {(l.color || (l.caracteristicas && Object.keys(l.caracteristicas).length > 0)) && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {l.color && (
                            <span className="text-[11px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-md">
                              {l.color}
                            </span>
                          )}
                          {Object.entries(l.caracteristicas || {}).map(([k, v]) => v && (
                            <span key={k} className="text-[11px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-md">
                              <span className="font-medium">{k}:</span> {v}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="text-sm font-semibold text-gray-700 tabular-nums flex-shrink-0">
                      {l.cantidad}
                      {Number(l.cantidad_devuelta) > 0 && (
                        <span className="text-xs text-orange-500 font-normal"> −{l.cantidad_devuelta}</span>
                      )}
                    </span>
                  </div>

                  {/* La garantía del proveedor, línea por línea. El plazo se
                      congeló al entrar la mercancía; el vencimiento se deriva. */}
                  {data.garantia_activa && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <ChipGarantia estado={l.estado} dias={l.dias_restantes} />
                      {l.garantia_hasta && (
                        <span className="text-[11px] text-gray-400">
                          hasta {String(l.garantia_hasta).slice(0, 10)}
                          {l.garantia_dias ? ` · ${l.garantia_dias} días` : ''}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Si la feature está apagada no se finge que existe: se dice dónde
              se enciende, en vez de mostrar un semáforo vacío. */}
          {!data.garantia_activa && (
            <p className="text-xs text-gray-400 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
              La garantía de proveedor está desactivada. Se enciende en
              Ajustes → Compras → «Garantía del proveedor».
            </p>
          )}

          <Button variant="secondary" onClick={onCerrar}>Cerrar</Button>
        </div>
      )}
    </Modal>
  );
}

// ── Confirmar una entrada contra la factura del proveedor ───────────────────
//
// Solo administración. Aquí es donde la entrada deja de ser "lo que llegó" y
// pasa a ser una compra con su plata: proveedor, precios reales y número de
// factura. Los precios vienen precargados con el valor provisional que resolvió
// el backend (el estimado de la orden o el último costo conocido), así que si
// la factura coincide basta con guardar.
//
// Al guardar corre `editarPreciosCompra`, que ya cascadea en una sola
// transacción al costo promedio, al costo de cada serial, al total de la compra
// y a la deuda con el proveedor. No se reimplementa nada de eso.
// El rótulo de la variante de una línea de compra. `getLineas` ya devuelve el
// valor y el nombre del tipo desde que existen las variantes; lo que faltaba era
// que esta pantalla los pintara.
//
// Sin esto, un negocio con variantes activas ve DOS líneas idénticas —«Audífonos
// · 40 uds» y «Audífonos · 40 uds»— y administración no tiene forma de saber
// cuál es la blanca y cuál la verde. Y como cada variante puede costar distinto,
// eso no es cosmético: es no poder confirmar la factura.
const etiquetaVariante = (l) => {
  if (l.variante_valor) return `${l.variante_tipo_nombre ? `${l.variante_tipo_nombre}: ` : ''}${l.variante_valor}`;
  if (l.atributo_valor) return `${l.atributo_tipo_nombre ? `${l.atributo_tipo_nombre}: ` : ''}${l.atributo_valor}`;
  return null;
};

function ModalConfirmar({ entrada, onCerrar, onListo }) {
  const [proveedorId, setProveedorId] = useState(entrada.proveedor_id ? String(entrada.proveedor_id) : '');
  const [numFactura,  setNumFactura]  = useState(entrada.numero_factura || '');
  const [fechaFact,   setFechaFact]   = useState(() => new Date().toISOString().slice(0, 10));
  const [diasPlazo,   setDiasPlazo]   = useState('');
  const [precios,     setPrecios]     = useState({});
  const [pagar,       setPagar]       = useState(false);
  const [valorPago,   setValorPago]   = useState('');
  const [metodoPago,  setMetodoPago]  = useState('Efectivo');
  const [error,       setError]       = useState('');

  const metodos = useMetodosPago();

  const { data: detalle, isLoading } = useQuery({
    queryKey: ['entrada-detalle', entrada.id],
    queryFn:  () => getCompraById(entrada.id).then((r) => r.data.data),
  });

  const { data: proveedores = [] } = useQuery({
    queryKey: ['proveedores'],
    queryFn:  () => getProveedores().then((r) => norm(r.data.data)),
    enabled:  !entrada.proveedor_id,
  });

  const precioDe = (l) => (l.id in precios ? precios[l.id] : Number(l.precio_unitario) || 0);

  // El total con los precios que hay ahora en pantalla: es contra este que se
  // ofrece el pago, no contra el provisional que trae la entrada.
  const totalEditado = (detalle?.lineas || [])
    .reduce((t, l) => t + precioDe(l) * Number(l.cantidad || 0), 0);

  // Lo que ya se abonó a esta compra (si el cargo existía y alguien pagó antes).
  const abonado = Number(entrada.abonado || 0);
  const saldo   = Math.max(totalEditado - abonado, 0);
  const yaSaldada = abonado > 0 && saldo <= 0;

  const mut = useMutation({
    mutationFn: () => confirmarEntrada(entrada.id, {
      proveedor_id:   proveedorId ? Number(proveedorId) : null,
      numero_factura: numFactura.trim() || null,
      fecha_factura:  fechaFact || null,
      dias_plazo:     diasPlazo === '' ? null : Number(diasPlazo),
      // Solo viajan las líneas que de verdad cambiaron: `editarPreciosCompra`
      // omite las iguales, pero mandarlas todas obligaría a rechazar las de
      // precio 0 (un producto que nunca tuvo costo) y no dejaría confirmar.
      lineas: (detalle?.lineas || [])
        .filter((l) => precioDe(l) > 0 && precioDe(l) !== Number(l.precio_unitario))
        .map((l) => ({ linea_id: l.id, precio_unitario: precioDe(l) })),
      pago: pagar && Number(valorPago) > 0
        ? { valor: Number(valorPago), metodo: metodoPago, registrar_en_caja: true }
        : null,
    }),
    onSuccess: (res) => {
      const p = res.data?.data?.pago;
      onListo(p
        ? `Entrada #${entrada.numero ?? entrada.id} confirmada · ${p.estado_pago === 'Saldada'
            ? 'saldada' : `quedan ${formatCOP(p.saldo_restante)} por pagar`}`
        : `Entrada #${entrada.numero ?? entrada.id} confirmada`);
    },
    onError:   (e) => setError(e.response?.data?.error || 'No se pudo confirmar'),
  });

  return (
    <Modal open onClose={onCerrar} title={`Confirmar entrada #${entrada.numero ?? entrada.id}`} size="md">
      {isLoading ? <Spinner className="py-12" /> : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
            Recibida por {entrada.recibida_por || 'bodega'} el {formatFechaHora(entrada.fecha)}.
            {entrada.orden_numero
              ? ' Los precios vienen del pedido; corrígelos con los de la factura.'
              : ' Los precios son provisionales (el último costo conocido); corrígelos con los de la factura.'}
          </p>

          {!entrada.proveedor_id && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Proveedor</label>
              <select
                value={proveedorId}
                onChange={(e) => setProveedorId(e.target.value)}
                className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm
                  text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Selecciona el proveedor</option>
                {proveedores.map((pr) => <option key={pr.id} value={pr.id}>{pr.nombre}</option>)}
              </select>
              <p className="text-xs text-gray-400">
                Esta entrada llegó sin pedido, así que nadie sabe todavía de quién vino.
              </p>
            </div>
          )}

          {/* ── La factura ──────────────────────────────────────────────────
              De aquí sale el vencimiento que alimenta el semáforo de cartera y
              el aviso de las 8:00. Sin fecha ni plazo, la deuda de esta entrada
              nunca aparece como próxima a vencer. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input label="N.º de factura" value={numFactura}
              onChange={(e) => setNumFactura(e.target.value)} placeholder="FV-10245" />
            <Input label="Fecha de la factura" type="date" value={fechaFact}
              onChange={(e) => setFechaFact(e.target.value)} />
            <Input label="Plazo (días)" type="number" min="0" max="365" value={diasPlazo}
              onChange={(e) => setDiasPlazo(e.target.value)} placeholder="30" />
          </div>
          {fechaFact && diasPlazo !== '' && Number.isInteger(Number(diasPlazo)) && (
            <p className="text-xs text-gray-500 -mt-1">
              Vence el{' '}
              <b>{new Date(new Date(`${fechaFact}T00:00:00Z`).getTime()
                + Number(diasPlazo) * 86400000).toISOString().slice(0, 10)}</b>.
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">Precio de compra por línea</label>
            <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
              {(detalle?.lineas || []).map((l) => (
                <div key={l.id} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700 truncate">
                      {l.nombre_producto}
                      {/* La variante va PEGADA al nombre y en morado: es lo que
                          distingue dos líneas que si no se leen idénticas. */}
                      {etiquetaVariante(l) && (
                        <span className="text-purple-600 font-medium"> · {etiquetaVariante(l)}</span>
                      )}
                    </p>
                    <p className="text-[11px] text-gray-400 tabular-nums">
                      {l.imei ? l.imei : `${l.cantidad} uds`}
                      {Number(l.precio_unitario) > 0
                        ? ` · ${l.orden_linea_id ? 'del pedido' : 'provisional'} ${formatCOP(l.precio_unitario)}`
                        : ' · sin costo previo'}
                      {/* Lo que llegó sin estar en el pedido. Administración
                          tiene que verlo ANTES de ponerle precio: puede ser lo
                          que no va a pagar. */}
                      {entrada.orden_numero && !l.orden_linea_id && ' · no venía en el pedido'}
                      {l.garantia_dias ? ` · garantía ${l.garantia_dias} días` : ''}
                    </p>
                  </div>
                  <div className="w-32 flex-shrink-0">
                    <InputMoneda
                      value={precioDe(l)}
                      onChange={(v) => setPrecios((prev) => ({ ...prev, [l.id]: Number(v) || 0 }))}
                      placeholder="0"
                      className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-xl
                        text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between text-sm border-t border-gray-100 pt-2">
              <span className="text-gray-500">Total de la factura</span>
              <span className="font-semibold text-gray-800 tabular-nums">{formatCOP(totalEditado)}</span>
            </div>
            {abonado > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Ya abonado</span>
                <span className="text-gray-500 tabular-nums">{formatCOP(abonado)}</span>
              </div>
            )}
          </div>

          {/* ── El pago ─────────────────────────────────────────────────────
              Si la compra ya está saldada no hay nada que ofrecer: preguntar
              "¿ya pagaste?" sobre algo pagado solo invita a un doble abono. */}
          {yaSaldada ? (
            <p className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-xl px-3 py-2.5">
              Esta compra ya está saldada. No hay nada por pagar.
            </p>
          ) : (
            <div className="flex flex-col gap-2 bg-gray-50 border border-gray-100 rounded-xl p-3">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={pagar}
                  onChange={(e) => {
                    setPagar(e.target.checked);
                    // Se precarga el saldo completo: pagar todo es lo normal, y
                    // el que abona una parte solo tiene que bajar la cifra.
                    if (e.target.checked && valorPago === '') setValorPago(saldo);
                  }}
                  className="w-4 h-4 accent-blue-600" />
                <span className="text-sm text-gray-700">
                  {abonado > 0 ? 'Registrar otro abono' : 'Ya se pagó esta compra'}
                </span>
              </label>

              {abonado > 0 && !pagar && (
                <p className="text-xs text-amber-700">
                  Pago parcial: faltan <b>{formatCOP(saldo)}</b> de {formatCOP(totalEditado)}.
                </p>
              )}

              {pagar && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className="text-xs font-medium text-gray-600">Cuánto se pagó</label>
                      <InputMoneda value={valorPago} onChange={setValorPago} placeholder="0"
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
                          text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div className="w-40">
                      <label className="text-xs font-medium text-gray-600">Método</label>
                      <select value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
                          text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                        {metodos.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                      </select>
                    </div>
                  </div>
                  {/* Abonar de más no es un abono: es un saldo a favor, y ese
                      tiene su propio circuito en Acreedores. El backend además
                      lo acota, esto solo lo dice antes. */}
                  {Number(valorPago) > saldo && (
                    <p className="text-xs text-amber-700">
                      El saldo es {formatCOP(saldo)}. Se registrará solo esa cantidad.
                    </p>
                  )}
                  {Number(valorPago) > 0 && Number(valorPago) < saldo && (
                    <p className="text-xs text-gray-500">
                      Quedarían <b>{formatCOP(saldo - Number(valorPago))}</b> por pagar.
                    </p>
                  )}
                  <p className="text-[11px] text-gray-400">
                    El abono queda con la fecha de hoy: para la caja, la fecha del
                    movimiento es el día en que salió el dinero.
                  </p>
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" className="flex-1" onClick={onCerrar}>Cancelar</Button>
            <Button
              className="flex-1"
              loading={mut.isPending}
              disabled={!entrada.proveedor_id && !proveedorId}
              onClick={() => { setError(''); mut.mutate(); }}
            >
              <Check size={15} /> Confirmar
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Vista: la lista ─────────────────────────────────────────────────────────
export default function EntradasPage() {
  const [vista, setVista] = useState(null);   // null | { orden }
  const [aviso, setAviso] = useState('');
  const [busca, setBusca] = useState('');
  const [confirmando, setConfirmando] = useState(null);
  const [detalle,     setDetalle]     = useState(null);
  // La entrada que se está corrigiendo. Se guarda el DETALLE completo, no el id:
  // corregir necesita las líneas con sus nodos, y pedirlas otra vez dejaría el
  // modal en blanco mientras carga algo que la lista ya podría tener.
  const [corrigiendo, setCorrigiendo] = useState(null);
  const { sucursalKey, sucursalLista } = useSucursalKey();
  const queryClient = useQueryClient();
  const { esAdminNegocio } = useAuth();
  const esAdmin = esAdminNegocio();

  const { data: ordenes = [], isLoading: cargandoOrdenes } = useQuery({
    queryKey: ['entradas-ordenes', ...sucursalKey],
    queryFn:  () => getOrdenesParaRecibir().then((r) => r.data.data || []),
    enabled:  sucursalLista,
  });

  const { data: entradas = [], isLoading } = useQuery({
    queryKey: ['entradas', ...sucursalKey],
    queryFn:  () => getEntradas().then((r) => r.data.data || []),
    enabled:  sucursalLista,
  });

  // La bandeja solo la pide administración: la ruta exige el permiso de ver
  // compras y responde con proveedor y totales.
  const { data: porConfirmar = [] } = useQuery({
    queryKey: ['entradas-por-confirmar', ...sucursalKey],
    queryFn:  () => getEntradasPorConfirmar().then((r) => r.data.data || []),
    enabled:  esAdmin && sucursalLista,
  });

  // El detalle se pide al abrir y no con la lista: son líneas con sus nodos, y
  // traerlas para las 30 entradas cuando casi ninguna se va a corregir sería
  // pagar por adelantado algo que casi nunca se usa.
  const abrirCorreccion = async (id) => {
    try {
      const { data } = await getEntradaDetalle(id);
      setCorrigiendo(data.data);
    } catch {
      setAviso('No se pudo abrir la entrada para corregirla');
      setTimeout(() => setAviso(''), 4000);
    }
  };

  // Filtro en memoria: la lista son las ultimas 30, no vale la pena ir al
  // servidor por cada tecla.
  const q = busca.trim().toLowerCase();
  const entradasFiltradas = !q ? entradas : entradas.filter((e) => (
    String(e.numero ?? e.id).includes(q)
    || (e.resumen      || '').toLowerCase().includes(q)
    || (e.recibida_por || '').toLowerCase().includes(q)
    || String(e.orden_numero ?? '').includes(q)
  ));

  if (vista) {
    return (
      <VistaEntrada
        orden={vista.orden}
        onVolver={() => setVista(null)}
        onListo={(msg) => { setVista(null); setAviso(msg); setTimeout(() => setAviso(''), 4000); }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Entradas</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Lo que llega a la bodega. Los precios los pone administración.
          </p>
        </div>
        <Button onClick={() => setVista({ orden: null })}>
          <PackagePlus size={15} /> Registrar entrada
        </Button>
      </div>

      {aviso && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-xl px-3 py-2.5">
          {aviso}
        </p>
      )}

      {/* Bandeja de administración. No es un módulo aparte: es una sección más
          de esta pantalla, visible solo para quien puede decidir plata. */}
      {esAdmin && porConfirmar.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Por confirmar ({porConfirmar.length})
          </p>
          {porConfirmar.map((e) => (
            <div key={e.id}
              onDoubleClick={() => setDetalle(e.id)}
              title="Doble clic para ver qué llegó"
              className="flex items-center justify-between gap-3 p-3 rounded-xl
                border border-amber-200 bg-amber-50/50 cursor-pointer">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800">
                  Entrada #{String(e.numero ?? e.id).padStart(4, '0')}
                </p>
                {e.resumen && (
                  <p className="text-xs text-gray-600 truncate">{e.resumen}
                    {e.lineas > 4 && <span className="text-gray-400"> +{e.lineas - 4} más</span>}
                  </p>
                )}
                <p className="text-xs text-gray-500">
                  {formatFechaHora(e.fecha)} · {e.unidades} uds
                  {e.recibida_por && ` · ${e.recibida_por}`}
                  {e.orden_numero
                    ? ` · OC-${String(e.orden_numero).padStart(4, '0')}`
                    : ' · sin pedido'}
                </p>
                <p className="text-xs mt-0.5">
                  {!e.proveedor_id
                    ? <span className="text-amber-700 font-medium">falta el proveedor</span>
                    : <span className="text-gray-400">{e.proveedor_nombre}</span>}
                  {e.dias_esperando > 0 && (
                    <span className="text-gray-400"> · {e.dias_esperando} día(s) esperando</span>
                  )}
                  {/* Cómo va la deuda de esta entrada, con la MISMA cuenta que
                      el estado de cuenta del proveedor. */}
                  {e.estado_pago === 'Saldada' && (
                    <span className="text-green-600 font-medium"> · pagada</span>
                  )}
                  {e.estado_pago === 'Parcial' && (
                    <span className="text-amber-700 font-medium"> · faltan {formatCOP(e.saldo)}</span>
                  )}
                </p>
              </div>
              <Button size="sm" onClick={() => setConfirmando(e)}>
                <FileCheck2 size={14} /> Confirmar
              </Button>
            </div>
          ))}
        </div>
      )}

      {detalle && (
        <ModalDetalleEntrada entradaId={detalle} onCerrar={() => setDetalle(null)} />
      )}

      {corrigiendo && (
        <ModalCorregirEntrada
          entrada={corrigiendo}
          onClose={() => setCorrigiendo(null)}
          onListo={(msg) => {
            setCorrigiendo(null);
            setAviso(msg);
            setTimeout(() => setAviso(''), 4000);
          }}
        />
      )}

      {confirmando && (
        <ModalConfirmar
          entrada={confirmando}
          onCerrar={() => setConfirmando(null)}
          onListo={(msg) => {
            setConfirmando(null);
            setAviso(msg);
            setTimeout(() => setAviso(''), 4000);
            queryClient.invalidateQueries({ queryKey: ['entradas-por-confirmar'], exact: false });
            queryClient.invalidateQueries({ queryKey: ['entradas'],               exact: false });
          }}
        />
      )}

      {/* Pedidos por llegar — el atajo que llena la lista, no otro flujo. */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Pedidos por llegar
        </p>
        {cargandoOrdenes ? <Spinner className="py-6" /> : ordenes.length === 0 ? (
          <p className="text-sm text-gray-400 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
            No hay pedidos pendientes. Si llegó algo sin pedido, usa «Registrar entrada».
          </p>
        ) : ordenes.map((o) => {
          const pendiente = (o.lineas || []).reduce((n, l) => n + Math.max(0, l.pendiente), 0);
          const pedida    = (o.lineas || []).reduce((n, l) => n + l.pedida, 0);
          return (
            <button
              key={o.id}
              onClick={() => setVista({ orden: o })}
              className="flex items-center justify-between gap-3 p-3 rounded-xl border
                border-gray-100 bg-white hover:border-green-300 hover:bg-green-50/40
                transition-colors text-left"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800">
                  OC-{String(o.numero ?? o.id).padStart(4, '0')}
                </p>
                <p className="text-xs text-gray-400">
                  {(o.lineas || []).length} producto(s)
                  {o.fecha_esperada && ` · esperado ${String(o.fecha_esperada).slice(0, 10)}`}
                </p>
              </div>
              <span className="text-xs text-gray-500 tabular-nums flex-shrink-0">
                faltan {pendiente} de {pedida} &nbsp;›
              </span>
            </button>
          );
        })}
      </div>

      {/* Lo ya registrado. El estado dice si administración ya le puso la
          factura: es toda la trazabilidad que el bodeguero necesita. */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Últimas entradas
          </p>
        </div>
        {/* Buscar por número, producto, pedido o quien recibió: sin esto, dar
            con "la entrada donde llegaron los cargadores" obliga a recorrer la
            lista a ojo. */}
        {entradas.length > 3 && (
          <SearchInput value={busca} onChange={setBusca}
            placeholder="Buscar por número, producto, pedido o quién recibió..." />
        )}
        {isLoading ? <Spinner className="py-8" /> : entradas.length === 0 ? (
          <EmptyState icon={ClipboardList}
            titulo="Sin entradas todavía"
            descripcion="Lo que registres va a aparecer aquí." />
        ) : entradasFiltradas.length === 0 ? (
          <p className="text-sm text-gray-400 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
            Ninguna entrada coincide con «{busca}».
          </p>
        ) : entradasFiltradas.map((e) => (
          <div key={e.id}
            onDoubleClick={() => setDetalle(e.id)}
            title="Doble clic para ver qué llegó"
            className="flex items-center justify-between gap-3 p-3 rounded-xl
              border border-gray-100 bg-white cursor-pointer hover:border-green-200
              transition-colors">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800">
                Entrada #{String(e.numero ?? e.id).padStart(4, '0')}
                {e.estado === 'Cancelada' && <span className="ml-2 text-xs text-red-500">cancelada</span>}
              </p>
              {/* Qué llegó. Con solo el número de documento habría que abrir
                  las entradas una por una para saber cuál es cuál. */}
              {e.resumen && (
                <p className="text-xs text-gray-600 truncate">{e.resumen}
                  {e.lineas > 4 && <span className="text-gray-400"> +{e.lineas - 4} más</span>}
                </p>
              )}
              <p className="text-xs text-gray-400">
                {formatFechaHora(e.fecha)} · {e.unidades} uds
                {e.recibida_por && ` · ${e.recibida_por}`}
                {e.orden_numero && ` · OC-${String(e.orden_numero).padStart(4, '0')}`}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              {e.factura_confirmada
                ? <Badge variant="green">confirmada</Badge>
                : <span className="flex items-center gap-1 text-xs text-amber-600">
                    <Clock size={11} /> por confirmar
                  </span>}
              {/* Corregir solo aparece mientras la entrada siga SIN CONFIRMAR y
                  sin cancelar: es la misma frontera que aplica el backend, y una
                  pantalla que ofrece un botón que el servidor va a rechazar es
                  peor que no ofrecerlo. */}
              {!e.factura_confirmada && e.estado !== 'Cancelada' && (
                <button
                  onClick={(ev) => { ev.stopPropagation(); abrirCorreccion(e.id); }}
                  className="flex items-center gap-1 text-xs font-medium text-blue-600
                             hover:text-blue-700 transition-colors">
                  <Wrench size={11} /> Corregir
                </button>
              )}
              {/* La garantia del proveedor, a la vista. Es la pregunta con la
                  que llega el cliente, y hasta ahora habia que abrir la ficha
                  de cada equipo para responderla. */}
              {e.garantia_hasta && (
                <span className="flex items-center gap-1 text-[11px] text-gray-400 whitespace-nowrap">
                  <ShieldCheck size={11} />
                  garantía hasta {String(e.garantia_hasta).slice(0, 10)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
