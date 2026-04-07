import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAcreedores, getAcreedorById, crearAcreedor, registrarMovimiento, eliminarAcreedor } from '../../api/acreedores.api';
import { getConfig, verificarPin } from '../../api/config.api';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { useAuth }     from '../../context/useAuth';
import { Button }      from '../../components/ui/Button';
import { Input }       from '../../components/ui/Input';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { useMetodosPago } from '../../hooks/useMetodosPago';
import { Modal }       from '../../components/ui/Modal';
import { Badge }       from '../../components/ui/Badge';
import { Spinner }     from '../../components/ui/Spinner';
import { EmptyState }  from '../../components/ui/EmptyState';
import { SearchInput } from '../../components/ui/SearchInput';
import { ReciboAcreedor } from '../../components/Reciboacreedor';
import { Users, Plus, ChevronRight, ChevronLeft, ChevronUp, PenLine, Printer, Trash2, AlertTriangle } from 'lucide-react';
import api from '../../api/axios.config';
import { getCompraById } from '../../api/compras.api';

// ─────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────
const normalizarProductos = (data) => {
  if (Array.isArray(data)) return data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  return [];
};

// ─────────────────────────────────────────────
// CANVAS DE FIRMA
// ─────────────────────────────────────────────
function FirmaCanvas({ onFirma }) {
  const canvasRef                   = useRef(null);
  const [dibujando, setDibujando]   = useState(false);
  const [tieneFirma, setTieneFirma] = useState(false);

  const getPos = (e, canvas) => {
    const rect   = canvas.getBoundingClientRect();
    const source = e.touches ? e.touches[0] : e;
    return { x: source.clientX - rect.left, y: source.clientY - rect.top };
  };

  const iniciar = (e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext('2d');
    const pos    = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setDibujando(true);
  };

  const dibujar = (e) => {
    e.preventDefault();
    if (!dibujando) return;
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext('2d');
    const pos    = getPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#1d4ed8';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.stroke();
    setTieneFirma(true);
  };

  const terminar = () => {
    setDibujando(false);
    if (tieneFirma) onFirma(canvasRef.current.toDataURL());
  };

  const limpiar = () => {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    setTieneFirma(false);
    onFirma(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">Firma</label>
        {tieneFirma && (
          <button onClick={limpiar} className="text-xs text-red-400 hover:text-red-600">Limpiar</button>
        )}
      </div>
      <canvas
        ref={canvasRef} width={340} height={120}
        className="border-2 border-dashed border-gray-200 rounded-xl bg-gray-50 touch-none cursor-crosshair w-full"
        onMouseDown={iniciar} onMouseMove={dibujar} onMouseUp={terminar} onMouseLeave={terminar}
        onTouchStart={iniciar} onTouchMove={dibujar} onTouchEnd={terminar}
      />
      <p className="text-xs text-gray-400 text-center">
        {tieneFirma ? '✓ Firma capturada' : 'Dibuja la firma aquí'}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────
// DETALLE EXPANDIBLE DE COMPRA
// ─────────────────────────────────────────────
function DetalleCompraInline({ compraId }) {
  const [expandido, setExpandido] = useState(false);

  const { data: compra, isLoading } = useQuery({
    queryKey: ['compra-detalle', compraId],
    queryFn:  () => getCompraById(compraId).then((r) => r.data.data),
    enabled:  expandido && !!compraId,
  });

  return (
    <div className="mt-2">
      <button onClick={() => setExpandido((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-700 font-medium transition-colors">
        {expandido ? <ChevronUp size={13} /> : <ChevronRight size={13} />}
        {expandido ? 'Ocultar compra' : `Ver compra #${String(compraId).padStart(6, '0')}`}
      </button>

      {expandido && (
        <div className="mt-2 bg-amber-50 border border-amber-100 rounded-xl p-3 flex flex-col gap-2">
          {isLoading ? (
            <Spinner className="py-4" />
          ) : !compra ? (
            <p className="text-xs text-gray-400">No se pudo cargar la compra</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-amber-700">Compra #{String(compra.id).padStart(6, '0')}</p>
                <span className="text-xs text-gray-400">{formatFechaHora(compra.fecha)}</span>
              </div>
              {compra.proveedor_nombre && (
                <p className="text-xs text-gray-600">Proveedor: <span className="font-medium">{compra.proveedor_nombre}</span></p>
              )}
              <div className="flex flex-col gap-1.5 mt-1">
                {compra.lineas?.map((l) => (
                  <div key={l.id} className="flex items-start justify-between text-xs gap-2 bg-white rounded-lg px-2.5 py-2 border border-amber-100">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 truncate">{l.nombre_producto}</p>
                      {l.imei && <p className="text-gray-400 font-mono">{l.imei}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-gray-500">{l.cantidad} × {formatCOP(l.precio_unitario)}</p>
                      <p className="font-semibold text-gray-800">{formatCOP(l.cantidad * l.precio_unitario)}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center border-t border-amber-200 pt-2 mt-1">
                <span className="text-xs text-gray-500">Total compra</span>
                <span className="text-sm font-bold text-amber-700">{formatCOP(compra.total)}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// MODAL MOVIMIENTO (con checkbox registrar en caja)
// ─────────────────────────────────────────────
function ModalMovimiento({ acreedor, proveedorTipo, onClose, onImprimir }) {
  const queryClient             = useQueryClient();
  const [form,  setForm]        = useState({ tipo: 'Cargo', descripcion: '', valor: '' });
  const [firma, setFirma]       = useState(null);
  const [registrarEnCaja, setRegistrarEnCaja] = useState(proveedorTipo !== 'proveedor');
  const [error, setError]       = useState('');
  const metodosPago = useMetodosPago();
  const [metodoPago, setMetodoPago] = useState('Efectivo');

  const esAbono       = form.tipo === 'Abono';
  const esProveedor   = proveedorTipo === 'proveedor';
  const mostrarCheckbox = esProveedor;

  const mutation = useMutation({
    mutationFn: () => registrarMovimiento(acreedor.id, {
      tipo:              form.tipo,
      descripcion:       form.descripcion,
      valor:             Number(form.valor),
      firma,
      registrar_en_caja: esAbono ? registrarEnCaja : false,
      metodo:            esAbono ? metodoPago : null,
    }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['acreedor',   acreedor.id], exact: false });
      queryClient.invalidateQueries({ queryKey: ['acreedores'],              exact: false });
      const mov = data?.data?.data ?? null;
      onImprimir(mov);
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar'),
  });

  const handleKeyDown = (e, siguienteId) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (siguienteId) document.getElementById(siguienteId)?.focus();
    }
  };

  return (
    <Modal open onClose={onClose} title={`Movimiento — ${acreedor.nombre}`} size="md">
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          {['Cargo', 'Abono'].map((t) => (
            <button key={t}
              onClick={() => {
                setForm({ ...form, tipo: t });
                if (t === 'Cargo') setRegistrarEnCaja(false);
                if (t === 'Abono') setRegistrarEnCaja(proveedorTipo !== 'proveedor');
              }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all
                ${form.tipo === t
                  ? t === 'Cargo'
                    ? 'bg-red-50 border-red-300 text-red-700'
                    : 'bg-green-50 border-green-300 text-green-700'
                  : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
              {t}
            </button>
          ))}
        </div>

        <Input id="descripcion-mov" label="Descripción" placeholder="Ej: Compra mercancía"
          value={form.descripcion}
          onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
          onKeyDown={(e) => handleKeyDown(e, 'valor-acreedor')} />

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Valor</label>
          <InputMoneda id="valor-acreedor" value={form.valor}
            onChange={(val) => setForm({ ...form, valor: val })} placeholder="0"
            className="w-full px-3 py-2 bg-gray-100 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all" />
        </div>

        {mostrarCheckbox && esAbono && (
          <div className={`rounded-xl p-3 border transition-all
            ${registrarEnCaja ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={registrarEnCaja}
                onChange={(e) => setRegistrarEnCaja(e.target.checked)}
                className="rounded accent-blue-600 w-4 h-4 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-700">Registrar en caja</p>
                <p className="text-xs text-gray-400">Si no se marca, el abono no aparecerá en el resumen de caja</p>
              </div>
            </label>
          </div>
        )}

        {esAbono && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">Método de pago</label>
            <div className="flex gap-2 flex-wrap">
              {metodosPago.map((m) => {
                const mId    = m.id;
                const mLabel = m.label;
                return (
                  <button key={mId} type="button" onClick={() => setMetodoPago(mId)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
                      ${metodoPago === mId
                        ? 'bg-blue-50 border-blue-300 text-blue-700'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                    {mLabel}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <FirmaCanvas onFirma={setFirma} />

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Registrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────
// MODAL NUEVO ACREEDOR
// ─────────────────────────────────────────────
function ModalNuevoAcreedor({ onClose }) {
  const queryClient                  = useQueryClient();
  const [form, setForm]              = useState({ nombre: '', cedula: '', telefono: '' });
  const [proveedorId, setProveedorId] = useState('');
  const [error, setError]            = useState('');

  const { data: proveedoresRaw } = useQuery({
    queryKey: ['proveedores'],
    queryFn:  () => api.get('/proveedores').then((r) => r.data.data),
  });
  const proveedores = normalizarProductos(proveedoresRaw);

  const { data: acreedoresData } = useQuery({
    queryKey: ['acreedores'],
    queryFn:  () => api.get('/acreedores').then((r) => r.data.data),
  });
  const acreedores = normalizarProductos(acreedoresData);

  const handleSeleccionarProveedor = (id) => {
    setProveedorId(id);
    setError('');
    if (!id) return;

    const yaVinculado = acreedores.some((a) => String(a.proveedor_id) === id);
    if (yaVinculado) {
      const acreedorExistente = acreedores.find((a) => String(a.proveedor_id) === id);
      setError(`Este proveedor ya está vinculado al acreedor "${acreedorExistente.nombre}"`);
      setProveedorId('');
      return;
    }

    const prov = proveedores.find((p) => String(p.id) === id);
    if (prov) {
      setForm((f) => ({
        ...f,
        nombre:   f.nombre   || prov.nombre   || '',
        cedula:   f.cedula   || prov.nit       || '',
        telefono: f.telefono || prov.telefono  || '',
      }));
    }
  };

  const mutation = useMutation({
    mutationFn: () => crearAcreedor({
      ...form,
      proveedor_id: proveedorId ? Number(proveedorId) : undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['acreedores'], exact: false });
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al crear'),
  });

  const handleKeyDown = (e, siguienteId) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (siguienteId) document.getElementById(siguienteId)?.focus();
      else mutation.mutate();
    }
  };

  return (
    <Modal open onClose={onClose} title="Nuevo Acreedor" size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Proveedor <span className="text-gray-400 font-normal text-xs">(opcional)</span>
          </label>
          <select value={proveedorId}
            onChange={(e) => handleSeleccionarProveedor(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm
              text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Sin proveedor vinculado</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          {proveedorId && (
            <p className="text-xs text-blue-600">Los datos del proveedor se usarán como referencia.</p>
          )}
        </div>

        <Input id="nombre-acreedor" label="Nombre" placeholder="Nombre completo"
          value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
          onKeyDown={(e) => handleKeyDown(e, 'cedula-acreedor')} autoFocus />
        <Input id="cedula-acreedor" label="Cédula / NIT" placeholder="123456789"
          value={form.cedula} onChange={(e) => setForm({ ...form, cedula: e.target.value })}
          onKeyDown={(e) => handleKeyDown(e, 'tel-acreedor')} />
        <Input id="tel-acreedor" label="Teléfono" placeholder="3001234567"
          value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })}
          onKeyDown={(e) => handleKeyDown(e, null)} />

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutation.isPending} onClick={() => mutation.mutate()}
            disabled={!form.nombre.trim() || !form.cedula.trim()}>
            Guardar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────
// LISTA DE ACREEDORES
// ─────────────────────────────────────────────
function ListaAcreedores({ acreedores, acreedorSel, isLoading, busqueda, setBusqueda, onSeleccionar, onNuevo, esAdmin }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <SearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar acreedor..." />
        {esAdmin && (
          <button onClick={onNuevo}
            className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0 hover:bg-blue-700 transition-colors">
            <Plus size={18} className="text-white" />
          </button>
        )}
      </div>
      {isLoading ? (
        <Spinner className="py-10" />
      ) : (
        <div className="flex flex-col gap-1 overflow-y-auto max-h-[65vh]">
          {acreedores.length === 0 ? (
            <EmptyState icon={Users} titulo="Sin acreedores"
              descripcion={esAdmin ? undefined : 'No hay acreedores vinculados a cruces'} />
          ) : (
            acreedores.map((a) => {
              const saldo = Number(a.saldo || 0);
              return (
                <button key={a.id} onClick={() => onSeleccionar(a)}
                  className={`flex items-center justify-between p-3 rounded-xl text-left transition-all border
                    ${acreedorSel?.id === a.id
                      ? 'bg-blue-50 border-blue-200 text-blue-700'
                      : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50'}`}>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{a.nombre}</p>
                    <p className={`text-xs font-semibold mt-0.5 ${saldo > 0 ? 'text-red-500' : 'text-green-600'}`}>
                      {saldo > 0 ? `Debemos: ${formatCOP(saldo)}` : 'Al día'}
                    </p>
                  </div>
                  <ChevronRight size={16} className="text-gray-300" />
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// MODAL ELIMINAR ACREEDOR
// ─────────────────────────────────────────────
function ModalEliminarAcreedor({ acreedor, onClose, onEliminar }) {
  const [pin,         setPin]         = useState('');
  const [error,       setError]       = useState('');
  const [verificando, setVerificando] = useState(false);

  const handleConfirmar = async () => {
    if (!pin.trim()) { setError('Ingresa el PIN de administrador'); return; }
    setVerificando(true);
    setError('');
    try {
      const res = await verificarPin(pin.trim());
      if (!res.data.valido) { setError('PIN incorrecto'); return; }
      onEliminar();
    } catch {
      setError('Error al verificar el PIN. Intenta de nuevo.');
    } finally {
      setVerificando(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Eliminar acreedor" size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-3 py-2">
          <div className="w-14 h-14 rounded-full bg-red-50 border-2 border-red-200 flex items-center justify-center">
            <AlertTriangle size={26} className="text-red-500" />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-gray-900">{acreedor.nombre}</p>
            <p className="text-sm text-gray-500 mt-1">Esta acción no se puede deshacer</p>
          </div>
        </div>

        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex flex-col gap-1">
          <p className="text-sm font-semibold text-red-700">¿Estás seguro?</p>
          <p className="text-xs text-red-600 leading-relaxed">
            Se eliminarán permanentemente todos los datos de este acreedor. Esta operación no se puede revertir.
          </p>
        </div>

        <Input label="PIN de administrador" type="password" placeholder="••••"
          value={pin} onChange={(e) => { setPin(e.target.value); setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmar(); }} autoFocus />

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-xl text-sm font-medium border border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100 transition-colors">
            Cancelar
          </button>
          <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white" loading={verificando} onClick={handleConfirmar}>
            <Trash2 size={14} /> Eliminar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────
// DETALLE ACREEDOR
// ─────────────────────────────────────────────
function DetalleAcreedor({ detalle, loadingDetalle, movimientosUI, onRegistrar, onImprimir, onVolver, onEliminar, esAdmin }) {
  if (loadingDetalle) return <Spinner className="py-20" />;

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onVolver}
        className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 transition-colors lg:hidden w-fit">
        <ChevronLeft size={16} /> Volver a lista
      </button>

      <div className="bg-white border border-gray-100 rounded-2xl p-4 flex items-start justify-between shadow-sm">
        <div>
          <h2 className="font-bold text-gray-900">{detalle?.nombre}</h2>
          <p className="text-xs text-gray-400">CC: {detalle?.cedula} · {detalle?.telefono}</p>
          <p className={`text-lg font-bold mt-2 ${Number(detalle?.saldo) > 0 ? 'text-red-500' : 'text-green-600'}`}>
            {Number(detalle?.saldo) > 0 ? `Debemos: ${formatCOP(detalle?.saldo)}` : 'Sin deuda'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={onRegistrar}><PenLine size={16} /> Registrar</Button>
          {esAdmin && (
            <button onClick={onEliminar}
              className="p-2 rounded-xl border border-dashed border-red-200 text-red-400
                hover:text-red-600 hover:bg-red-50 hover:border-red-300 transition-colors"
              title="Eliminar acreedor">
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-gray-600">Historial</h3>
        {movimientosUI.length === 0 ? (
          <EmptyState icon={PenLine} titulo="Sin movimientos" />
        ) : (
          movimientosUI.map((m) => (
            <div key={m.id} className="bg-white border border-gray-100 rounded-xl p-3 flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={m.tipo === 'Cargo' ? 'red' : 'green'}>{m.tipo}</Badge>
                  <span className="text-sm text-gray-700">{m.descripcion}</span>
                  {m.registrar_en_caja === false && (
                    <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">Sin caja</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1">{formatFechaHora(m.fecha)}</p>
                <div className="flex items-center gap-1 mt-1 text-xs text-gray-400">
                  <span>{formatCOP(m.saldo_antes)}</span>
                  <span>→</span>
                  <span className="font-semibold text-gray-600">{formatCOP(m.saldo_despues)}</span>
                </div>
                {m.firma && <img src={m.firma} alt="firma" className="mt-2 h-12 border border-gray-100 rounded-lg" />}
                {m.compra_id && <DetalleCompraInline compraId={m.compra_id} />}
              </div>
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <span className={`text-sm font-bold ${m.tipo === 'Cargo' ? 'text-red-500' : 'text-green-600'}`}>
                  {m.tipo === 'Cargo' ? '+' : '-'}{formatCOP(m.valor)}
                </span>
                <button onClick={() => onImprimir(m)}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 transition-colors"
                  title="Imprimir recibo">
                  <Printer size={14} />
                  <span className="hidden sm:inline">Recibo</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// PÁGINA PRINCIPAL
// ─────────────────────────────────────────────
export default function AcreedoresPage() {
  const { esAdminNegocio } = useAuth();
  const esAdmin            = esAdminNegocio();

  const [busqueda,      setBusqueda]      = useState('');
  const [acreedorSel,   setAcreedorSel]   = useState(null);
  const [modalMov,      setModalMov]      = useState(false);
  const [modalNuevo,    setModalNuevo]    = useState(false);
  const [movImprimir,   setMovImprimir]   = useState(null);
  const [modalEliminar, setModalEliminar] = useState(false);

  const queryClient = useQueryClient();

  const mutEliminar = useMutation({
    mutationFn: () => eliminarAcreedor(acreedorSel.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['acreedores'], exact: false });
      setModalEliminar(false);
      setAcreedorSel(null);
    },
    onError: (err) => {
      setModalEliminar(false);
      alert(err.response?.data?.error || 'No se puede eliminar este acreedor');
    },
  });

  // Admin ve todos los acreedores, supervisor ve solo los de cruces
  const { data: acreedoresData, isLoading } = useQuery({
    queryKey: esAdmin ? ['acreedores', busqueda] : ['acreedores-cruces', busqueda],
    queryFn:  () => esAdmin
      ? getAcreedores(busqueda).then((r) => r.data.data)
      : api.get('/acreedores/cruces', { params: { filtro: busqueda || undefined } }).then((r) => r.data.data),
  });

  const { data: detalle, isLoading: loadingDetalle } = useQuery({
    queryKey: ['acreedor', acreedorSel?.id],
    queryFn:  () => getAcreedorById(acreedorSel.id).then((r) => r.data.data),
    enabled:  !!acreedorSel,
  });

  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn:  () => getConfig().then((r) => r.data.data),
  });

  const acreedores    = acreedoresData || [];
  const movimientosUI = detalle?.movimientos ? [...detalle.movimientos].reverse() : [];

  const handleSeleccionar = (a) => setAcreedorSel(a);
  const handleVolver      = () => setAcreedorSel(null);
  const handleImprimir    = (mov) => { setModalMov(false); setMovImprimir(mov); };

  const listaProps = {
    acreedores, acreedorSel, isLoading, busqueda, setBusqueda, esAdmin,
    onSeleccionar: handleSeleccionar,
    onNuevo: () => setModalNuevo(true),
  };

  const detalleProps = {
    detalle, loadingDetalle, movimientosUI, esAdmin,
    onRegistrar: () => setModalMov(true),
    onImprimir:  handleImprimir,
    onVolver:    handleVolver,
    onEliminar:  () => setModalEliminar(true),
  };

  return (
    <>
      <div className="hidden lg:flex gap-4">
        <div className="w-64 flex-shrink-0">
          <ListaAcreedores {...listaProps} />
        </div>
        <div className="flex-1">
          {!acreedorSel ? (
            <EmptyState icon={Users} titulo="Selecciona un acreedor"
              descripcion="Elige un acreedor para ver su historial" />
          ) : (
            <DetalleAcreedor {...detalleProps} />
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:hidden">
        {!acreedorSel ? (
          <ListaAcreedores {...listaProps} />
        ) : (
          <DetalleAcreedor {...detalleProps} />
        )}
      </div>

      {modalMov && acreedorSel && (
        <ModalMovimiento
          acreedor={acreedorSel}
          proveedorTipo={esAdmin ? 'proveedor' : 'cruce'}
          onClose={() => setModalMov(false)}
          onImprimir={handleImprimir}
        />
      )}
      {modalNuevo && <ModalNuevoAcreedor onClose={() => setModalNuevo(false)} />}
      {modalEliminar && acreedorSel && (
        <ModalEliminarAcreedor acreedor={acreedorSel} onClose={() => setModalEliminar(false)} onEliminar={() => mutEliminar.mutate()} />
      )}
      {movImprimir && detalle && (
        <ReciboAcreedor acreedor={detalle} movimiento={movImprimir} config={configData} onClose={() => setMovImprimir(null)} />
      )}
    </>
  );
}