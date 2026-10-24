import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Repeat2, Banknote, Hourglass, ChevronLeft, ChevronRight, CheckCircle2, Printer, Info, Camera, X,
} from 'lucide-react';
import api from '../../../api/axios.config';
import { buscarCandidatos, crearGarantia, adjuntarFotoGarantia } from '../../../api/garantiasProveedor.api';
import { Modal }       from '../../../components/ui/Modal';
import { Button }      from '../../../components/ui/Button';
import { Spinner }     from '../../../components/ui/Spinner';
import { SearchInput } from '../../../components/ui/SearchInput';
import { InputMoneda } from '../../../components/ui/InputMoneda';
import { useMetodosPago } from '../../../hooks/useMetodosPago';
import { useGarantiasProveedor } from '../../../hooks/useEnGarantia';
import { formatCOP } from '../../../utils/formatters';
import {
  FALLAS_RAPIDAS, ACCESORIOS, origenDeCandidato, mensajeError, numeroDe,
} from './garantiasUi';
import { TarjetaCandidato, OpcionGrande, Pasos } from './piezasGarantia';
import { refrescarTrasGarantia } from './refrescar';

// ─────────────────────────────────────────────────────────────────────────────
// Recibir un producto en garantía. Tres pasos cortos, y el del medio solo si
// hay un cliente de por medio:
//   1. ¿Qué producto? — un solo campo (IMEI, código, # de factura o préstamo,
//      o nombre); desde una factura, un préstamo o el inventario llega ya puesto.
//   2. ¿Qué pasa con el cliente? — otra unidad, el dinero, o que espere.
//   3. ¿A qué proveedor? — viene propuesto por la compra; se puede cambiar o
//      dejar para cuando se arme el envío.
// Al terminar se ofrece el comprobante para el cliente (POS, PDF o compartir).
//
// Lo que manda el navegador es solo QUÉ unidad y QUÉ se decidió: el backend
// vuelve a resolver la unidad, su costo y su estado.
// ─────────────────────────────────────────────────────────────────────────────

export function ModalNuevaGarantia({ origen = null, onClose, onCreada, onImprimir }) {
  const queryClient = useQueryClient();
  const metodos = useMetodosPago();
  const { puede, fotosActivas } = useGarantiasProveedor();

  const [paso, setPaso]               = useState(0);
  const [busqueda, setBusqueda]       = useState('');
  const [elegido, setElegido]         = useState(null);
  const [cantidad, setCantidad]       = useState(1);
  const [fallaEscrita, setFalla]      = useState(null);    // null = no la ha tocado
  const [estadoFisico, setEstadoFisico] = useState('');
  const [accesorios, setAccesorios]   = useState([]);
  const [accion, setAccion]           = useState(null);     // cambio | reembolso | pendiente
  const [busqReemplazo, setBusqReemplazo] = useState('');
  const [reemplazo, setReemplazo]     = useState(null);     // candidato del inventario
  const [metodo, setMetodo]           = useState('Efectivo');
  const [valor, setValor]             = useState('');
  const [proveedorId, setProveedorId] = useState(null);     // null = el propuesto
  const [notas, setNotas]             = useState('');
  const [error, setError]             = useState('');
  const [creada, setCreada]           = useState(null);
  const [fotos, setFotos]             = useState([]);       // File[] que se suben al registrar
  const [fotosGuardadas, setFotosGuardadas] = useState({ ok: 0, errores: [] });

  // ── Paso 1: la unidad ─────────────────────────────────────────────────────
  const { data: iniciales = [], isLoading: cargandoIni } = useQuery({
    queryKey: ['garantias-candidatos', 'origen', origen],
    queryFn:  () => buscarCandidatos(origen).then((r) => r.data.data),
    enabled:  !!origen,
    staleTime: 0,
  });
  const q = busqueda.trim();
  const { data: encontrados = [], isFetching: buscando } = useQuery({
    queryKey: ['garantias-candidatos', 'q', q],
    queryFn:  () => buscarCandidatos({ q }).then((r) => r.data.data),
    enabled:  !origen && q.length >= 2,
  });
  const lista = origen ? iniciales : encontrados;
  // Desde un documento con una sola unidad posible, ya viene elegida.
  const candidato = elegido ?? (origen && iniciales.length === 1 && !iniciales[0].bloqueo ? iniciales[0] : null);
  const conCliente = candidato && candidato.origen_tipo !== 'inventario';
  const max = candidato?.cantidad_max || 1;
  const cant = candidato?.tipo === 'serial' ? 1 : Math.min(Math.max(1, Number(cantidad) || 1), max);

  // ── Paso 2: el reemplazo para el cliente (del inventario de la sede) ──────
  const qr = busqReemplazo.trim();
  const { data: reemplazosRaw = [], isFetching: buscandoRemp } = useQuery({
    queryKey: ['garantias-candidatos', 'reemplazo', qr],
    queryFn:  () => buscarCandidatos({ q: qr }).then((r) => r.data.data),
    enabled:  accion === 'cambio' && candidato?.tipo === 'serial' && qr.length >= 2,
  });
  const reemplazos = reemplazosRaw.filter((c) => c.origen_tipo === 'inventario' && c.tipo === 'serial'
    && c.serial_id !== candidato?.serial_id);

  // ── Paso 3: proveedores (puede fallar si el usuario no los ve: se degrada) ──
  const { data: proveedores, isError: sinProveedores } = useQuery({
    queryKey: ['proveedores'],
    queryFn:  () => api.get('/proveedores').then((r) => r.data.data),
    retry: false,
  });
  const propuesto = candidato?.procedencia?.proveedor_id ? String(candidato.procedencia.proveedor_id) : '';
  const proveedorElegido = proveedorId ?? propuesto;

  const tope = (Number(candidato?.precio_venta) || 0) * cant;
  const esCredito = candidato?.factura?.es_credito;
  const puedeCambio = puede('cliente');
  const puedeReembolso = puede('reembolsar') && candidato?.origen_tipo === 'factura';

  const pasos = conCliente ? ['Producto', 'Cliente', 'Proveedor'] : ['Producto', 'Proveedor'];
  const pasoProveedor = conCliente ? 2 : 1;

  // Desde una orden de Servicios la falla ya está escrita: arranca con esa.
  const falla = fallaEscrita ?? candidato?.orden_servicio?.falla ?? '';

  const listoPaso1 = !!candidato && !candidato.bloqueo && falla.trim().length > 0;
  const listoPaso2 = !conCliente || (accion === 'pendiente')
    || (accion === 'cambio' && (candidato?.tipo === 'cantidad' || !!reemplazo))
    || (accion === 'reembolso');

  const mut = useMutation({
    mutationFn: () => {
      let resolucion = null;
      if (conCliente && accion === 'cambio') {
        resolucion = { tipo: 'cambio', unidad: candidato.tipo === 'serial' ? { serial_id: reemplazo.serial_id } : undefined };
      } else if (conCliente && accion === 'reembolso') {
        resolucion = { tipo: 'reembolso', metodo, valor: esCredito || valor === '' ? undefined : Number(valor) };
      }
      return crearGarantia({
        origen: origenDeCandidato(candidato),
        cantidad: cant,
        falla: falla.trim(),
        estado_fisico: estadoFisico.trim() || null,
        accesorios,
        notas: notas.trim() || null,
        proveedor_id: proveedorElegido ? Number(proveedorElegido) : null,
        resolucion_cliente: resolucion,
      });
    },
    onSuccess: async (r) => {
      // Las fotos van DESPUÉS: necesitan el caso. Una que falle no deshace la
      // garantía; se dice cuál y se puede volver a subir desde el detalle.
      const resultado = { ok: 0, errores: [] };
      for (const f of fotos) {
        try { await adjuntarFotoGarantia(r.data.data.reclamo.id, f); resultado.ok += 1; }
        catch (err) { resultado.errores.push(`${f.name}: ${mensajeError(err, 'no se guardó')}`); }
      }
      setFotosGuardadas(resultado);
      refrescarTrasGarantia(queryClient);
      setCreada(r.data.data);
      onCreada?.(r.data.data);
    },
    onError: (err) => setError(mensajeError(err, 'No se pudo registrar la garantía')),
  });

  const toggleAccesorio = (a) => setAccesorios((l) => (l.includes(a) ? l.filter((x) => x !== a) : [...l, a]));
  const agregarFalla = (f) => setFalla(falla.toLowerCase().includes(f.toLowerCase()) ? falla : (falla ? `${falla}, ${f}` : f));

  // ── Listo ─────────────────────────────────────────────────────────────────
  if (creada) {
    const rec = creada.reclamo;
    const mov = creada.movimiento_cliente;
    return (
      <Modal open onClose={onClose} title="Garantía registrada" size="md">
        <div className="flex flex-col items-center text-center gap-3 py-2">
          <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center">
            <CheckCircle2 size={28} className="text-green-600" />
          </div>
          <div>
            <p className="text-base font-semibold text-gray-900">Garantía #{numeroDe(rec)}</p>
            <p className="text-sm text-gray-500">{creada.linea.nombre_producto}{creada.linea.imei ? ` · ${creada.linea.imei}` : ''}</p>
          </div>
          <div className="w-full text-left text-sm bg-gray-50 rounded-xl p-3 flex flex-col gap-1">
            <p className="text-gray-700">• La unidad quedó <b>en garantía</b>: no cuenta en el stock vendible.</p>
            {mov?.tipo === 'cambio' && <p className="text-gray-700">• Al cliente se le entregó otra unidad (salió del stock).</p>}
            {mov?.tipo === 'reembolso' && (
              <p className="text-gray-700">• {mov.metodo === 'Crédito'
                ? `El crédito bajó ${formatCOP(mov.valor)}.`
                : `Se le devolvieron ${formatCOP(mov.valor)} (${mov.metodo}) y la venta de la línea se deshizo.`}</p>
            )}
            {conCliente && !mov && <p className="text-gray-700">• El cliente queda esperando: entrégale cuando llegue la reposición.</p>}
            {fotosGuardadas.ok > 0 && <p className="text-gray-700">• {fotosGuardadas.ok} foto(s) guardada(s) como prueba para el proveedor.</p>}
            {fotosGuardadas.errores.map((e) => <p key={e} className="text-red-600">• {e}</p>)}
            <p className="text-gray-700">• Envíala al proveedor desde Proveedores → Garantías.</p>
          </div>
          <div className="w-full flex flex-col sm:flex-row gap-2 mt-1">
            {onImprimir && (
              <Button className="flex-1" onClick={() => onImprimir(rec.id)}>
                <Printer size={16} /> {conCliente ? 'Comprobante para el cliente' : 'Imprimir'}
              </Button>
            )}
            <Button variant="secondary" className="flex-1" onClick={onClose}>Listo</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Recibir en garantía" size="lg">
      <div className="flex flex-col gap-4">
        <Pasos pasos={pasos} actual={paso} />

        {/* ── 1. Producto ─────────────────────────────────────────────── */}
        {paso === 0 && (
          <div className="flex flex-col gap-3">
            {!origen && !elegido && (
              <>
                <SearchInput value={busqueda} onChange={setBusqueda} autoFocus
                  placeholder="IMEI, código, # de factura o préstamo, o nombre del producto…"
                  onEnter={() => { if (encontrados.length === 1 && !encontrados[0].bloqueo) setElegido(encontrados[0]); }} />
                {q.length < 2 && (
                  <p className="text-xs text-gray-400 flex items-start gap-1.5">
                    <Info size={13} className="flex-shrink-0 mt-0.5" />
                    También puedes abrirla desde la factura, el préstamo o el producto en el inventario: llega con todo puesto.
                  </p>
                )}
              </>
            )}
            {(origen ? cargandoIni : buscando) && <Spinner className="py-4" />}
            {!candidato && (origen || q.length >= 2) && !(origen ? cargandoIni : buscando) && (
              lista.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">No se encontró nada con eso en esta sucursal.</p>
              ) : (
                <div className="flex flex-col gap-2 max-h-80 overflow-y-auto">
                  {lista.map((c) => <TarjetaCandidato key={c.clave} c={c} onElegir={setElegido} />)}
                </div>
              )
            )}

            {candidato && (
              <>
                <TarjetaCandidato c={candidato} elegido />
                {(elegido && (!origen || iniciales.length > 1)) && (
                  <button type="button" onClick={() => setElegido(null)} className="text-xs text-blue-600 self-start hover:underline">
                    Elegir otro producto
                  </button>
                )}
                {candidato.tipo === 'cantidad' && max > 1 && (
                  <label className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-700">¿Cuántas unidades?</span>
                    <input type="number" min={1} max={max} value={cantidad}
                      onChange={(e) => setCantidad(e.target.value)}
                      className="w-24 px-3 py-2 border border-gray-200 rounded-xl text-sm" />
                    <span className="text-xs text-gray-400">de {max}</span>
                  </label>
                )}
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-gray-700">¿Qué falla tiene? *</span>
                  <div className="flex flex-wrap gap-1.5">
                    {FALLAS_RAPIDAS.map((f) => (
                      <button key={f} type="button" onClick={() => agregarFalla(f)}
                        className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-600 hover:border-rose-300 hover:text-rose-700">
                        {f}
                      </button>
                    ))}
                  </div>
                  <textarea rows={2} value={falla} onChange={(e) => setFalla(e.target.value)}
                    placeholder="Describe la falla como la cuenta el cliente…"
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-gray-700">¿Qué entregó con el producto?</span>
                  <div className="flex flex-wrap gap-1.5">
                    {ACCESORIOS.map((a) => {
                      const on = accesorios.includes(a);
                      return (
                        <button key={a} type="button" onClick={() => toggleAccesorio(a)} aria-pressed={on}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors
                            ${on ? 'border-rose-400 bg-rose-50 text-rose-700' : 'border-gray-200 text-gray-600'}`}>
                          {on ? '✓ ' : ''}{a}
                        </button>
                      );
                    })}
                  </div>
                  <input value={estadoFisico} onChange={(e) => setEstadoFisico(e.target.value)}
                    placeholder="Estado físico (opcional): rayones, golpes, humedad…"
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />
                </div>
                {fotosActivas && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-gray-700">Fotos del daño (opcional)</span>
                    <label className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border-2 border-dashed border-gray-200
                      text-sm text-gray-500 hover:border-rose-300 hover:text-rose-700 cursor-pointer">
                      <Camera size={16} /> Tomar o elegir fotos
                      <input type="file" accept="image/*,application/pdf" multiple className="hidden"
                        onChange={(e) => { const nuevas = [...(e.target.files || [])]; setFotos((l) => [...l, ...nuevas].slice(0, 12)); e.target.value = ''; }} />
                    </label>
                    {fotos.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {fotos.map((f, i) => (
                          <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 text-xs bg-gray-100 rounded-lg px-2 py-1">
                            {f.name.length > 22 ? `${f.name.slice(0, 20)}…` : f.name}
                            <button type="button" onClick={() => setFotos((l) => l.filter((_, j) => j !== i))} aria-label="Quitar"><X size={11} /></button>
                          </span>
                        ))}
                      </div>
                    )}
                    <span className="text-[11px] text-gray-400">Es la prueba que pide el proveedor. Se guardan en privado.</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── 2. Cliente ──────────────────────────────────────────────── */}
        {paso === 1 && conCliente && (
          <div className="flex flex-col gap-2.5">
            <p className="text-sm text-gray-600">
              ¿Qué se hace con <b>{candidato.cliente?.nombre || 'el cliente'}</b>?
            </p>
            <OpcionGrande activa={accion === 'cambio'} onClick={() => setAccion('cambio')} icono={Repeat2} color="blue"
              titulo="Le entrego otra unidad ahora" deshabilitada={!puedeCambio}
              descripcion={candidato.origen_tipo === 'prestamo'
                ? 'Sale del stock y el préstamo pasa a la unidad nueva'
                : 'Sale del stock vendible; la venta sigue igual'}
              nota={!puedeCambio ? 'Tu usuario no tiene este permiso' : null} />
            {accion === 'cambio' && candidato.tipo === 'serial' && (
              <div className="ml-12 flex flex-col gap-2">
                {reemplazo ? (
                  <>
                    <TarjetaCandidato c={reemplazo} compacta />
                    <button type="button" onClick={() => setReemplazo(null)} className="text-xs text-blue-600 self-start hover:underline">
                      Cambiar el equipo
                    </button>
                  </>
                ) : (
                  <>
                    <SearchInput value={busqReemplazo} onChange={setBusqReemplazo} autoFocus
                      placeholder="Escanea o busca el IMEI del equipo que le entregas…"
                      onEnter={() => { if (reemplazos.length === 1 && !reemplazos[0].bloqueo) setReemplazo(reemplazos[0]); }} />
                    {buscandoRemp && <Spinner className="py-2" />}
                    {qr.length >= 2 && !buscandoRemp && (
                      reemplazos.length === 0
                        ? <p className="text-xs text-gray-400">No hay equipos disponibles con ese IMEI en la sucursal.</p>
                        : <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                            {reemplazos.map((c) => <TarjetaCandidato key={c.clave} c={c} compacta onElegir={setReemplazo} />)}
                          </div>
                    )}
                  </>
                )}
              </div>
            )}
            {accion === 'cambio' && candidato.tipo === 'cantidad' && (
              <p className="ml-12 text-xs text-gray-500">
                Se entregan {cant} unidad(es) de <b>{candidato.nombre_producto}{candidato.variante_texto ? ` · ${candidato.variante_texto}` : ''}</b> del stock.
              </p>
            )}

            <OpcionGrande activa={accion === 'reembolso'} onClick={() => setAccion('reembolso')} icono={Banknote} color="green"
              titulo="Le devuelvo el dinero" deshabilitada={!puedeReembolso}
              descripcion={esCredito
                ? `Se descuenta del crédito: ${formatCOP(tope)}`
                : `Sale de la caja y se deshace la venta de la línea (hasta ${formatCOP(tope)})`}
              nota={candidato.origen_tipo === 'prestamo'
                ? 'En un préstamo activo se devuelve con «Devolver» en el préstamo'
                : !puede('reembolsar') ? 'Tu usuario no tiene este permiso' : null} />
            {accion === 'reembolso' && !esCredito && (
              <div className="ml-12 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-gray-500">Valor que se devuelve</span>
                  <InputMoneda value={valor === '' ? tope : valor} onChange={setValor} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-gray-500">Cómo se devuelve</span>
                  <select value={metodo} onChange={(e) => setMetodo(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white">
                    {metodos.filter((m) => m.id !== 'Credito').map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </label>
                <p className="sm:col-span-2 text-[11px] text-gray-400">Necesita la caja de la sucursal abierta.</p>
              </div>
            )}

            <OpcionGrande activa={accion === 'pendiente'} onClick={() => setAccion('pendiente')} icono={Hourglass} color="amber"
              titulo="Queda esperando"
              descripcion="Se le entrega (o se le devuelve el dinero) cuando el proveedor responda" />
          </div>
        )}

        {/* ── 3. Proveedor ────────────────────────────────────────────── */}
        {paso === pasoProveedor && candidato && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-gray-700">¿A qué proveedor se le reclama?</span>
              {sinProveedores || !proveedores ? (
                <p className="text-sm text-gray-600 bg-gray-50 rounded-xl px-3 py-2">
                  {candidato.procedencia?.proveedor_nombre
                    ? <>Se propone <b>{candidato.procedencia.proveedor_nombre}</b> (de la compra).</>
                    : 'Lo decide quien arme el envío al proveedor.'}
                </p>
              ) : (
                <select value={proveedorElegido} onChange={(e) => setProveedorId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white">
                  <option value="">Decidir después (al enviar)</option>
                  {proveedores.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}{String(p.id) === propuesto ? ' · de la compra' : ''}
                    </option>
                  ))}
                </select>
              )}
              {candidato.procedencia?.estado === 'vencida' && (
                <span className="text-xs text-red-600">La garantía del proveedor ya venció: puede que no la cubra.</span>
              )}
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-gray-700">Notas (opcional)</span>
              <textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm" />
            </label>
            <div className="rounded-xl bg-gray-50 p-3 text-sm text-gray-700 flex flex-col gap-1">
              <p className="font-medium text-gray-800">Resumen</p>
              <p>• {cant} × {candidato.nombre_producto}{candidato.imei ? ` (${candidato.imei})` : ''}: {falla.trim()}</p>
              {conCliente && (
                <p>• Cliente: {accion === 'cambio' ? 'se le entrega otra unidad'
                  : accion === 'reembolso' ? (esCredito ? `se descuenta del crédito ${formatCOP(tope)}` : `se le devuelven ${formatCOP(valor === '' ? tope : valor)}`)
                  : 'queda esperando'}</p>
              )}
              <p>• La unidad sale del stock vendible hasta que el proveedor responda.</p>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>}

        <div className="flex gap-2">
          {paso > 0 ? (
            <Button variant="secondary" onClick={() => { setError(''); setPaso((p) => p - 1); }}>
              <ChevronLeft size={16} /> Atrás
            </Button>
          ) : (
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          )}
          {paso < pasoProveedor ? (
            <Button className="flex-1" disabled={paso === 0 ? !listoPaso1 : !listoPaso2}
              onClick={() => { setError(''); setPaso((p) => p + 1); }}>
              Siguiente <ChevronRight size={16} />
            </Button>
          ) : (
            <Button className="flex-1" loading={mut.isPending} disabled={!listoPaso1 || !listoPaso2}
              onClick={() => { setError(''); mut.mutate(); }}>
              Registrar garantía
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
