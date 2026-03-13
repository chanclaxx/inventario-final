import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAcreedores, getAcreedorById, crearAcreedor, registrarMovimiento } from '../../api/acreedores.api';
import { getConfig } from '../../api/config.api';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { Button }     from '../../components/ui/Button';
import { Input }      from '../../components/ui/Input';
import { Modal }      from '../../components/ui/Modal';
import { Badge }      from '../../components/ui/Badge';
import { Spinner }    from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { SearchInput } from '../../components/ui/SearchInput';
import { ReciboAcreedor } from '../../components/Reciboacreedor';
import { Users, Plus, ChevronRight, ChevronLeft, PenLine, Printer } from 'lucide-react';

// ─────────────────────────────────────────────
// CANVAS DE FIRMA
// ─────────────────────────────────────────────
function FirmaCanvas({ onFirma }) {
  const canvasRef               = useRef(null);
  const [dibujando, setDibujando] = useState(false);
  const [tieneFirma, setTieneFirma] = useState(false);

  const getPos = (e, canvas) => {
    const rect   = canvas.getBoundingClientRect();
    const source = e.touches ? e.touches[0] : e;
    return {
      x: source.clientX - rect.left,
      y: source.clientY - rect.top,
    };
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
    if (tieneFirma) {
      onFirma(canvasRef.current.toDataURL());
    }
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
          <button onClick={limpiar} className="text-xs text-red-400 hover:text-red-600">
            Limpiar
          </button>
        )}
      </div>
      <canvas
        ref={canvasRef}
        width={340}
        height={120}
        className="border-2 border-dashed border-gray-200 rounded-xl bg-gray-50 touch-none cursor-crosshair w-full"
        onMouseDown={iniciar}
        onMouseMove={dibujar}
        onMouseUp={terminar}
        onMouseLeave={terminar}
        onTouchStart={iniciar}
        onTouchMove={dibujar}
        onTouchEnd={terminar}
      />
      <p className="text-xs text-gray-400 text-center">
        {tieneFirma ? '✓ Firma capturada' : 'Dibuja la firma aquí'}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────
// MODAL MOVIMIENTO
// ─────────────────────────────────────────────
function ModalMovimiento({ acreedor, onClose }) {
  const queryClient               = useQueryClient();
  const [form,  setForm]          = useState({ tipo: 'Cargo', descripcion: '', valor: '' });
  const [firma, setFirma]         = useState(null);
  const [error, setError]         = useState('');
  const [movRegistrado, setMovRegistrado] = useState(null);

  const mutation = useMutation({
    mutationFn: () => registrarMovimiento(acreedor.id, {
      tipo:        form.tipo,
      descripcion: form.descripcion,
      valor:       Number(form.valor),
      firma,
    }),
    onSuccess: (data) => {
      // Acreedores es de negocio (negocio_id) → sin sucursalKey, igual exact: false por consistencia
      queryClient.invalidateQueries({ queryKey: ['acreedor',   acreedor.id], exact: false });
      queryClient.invalidateQueries({ queryKey: ['acreedores'],              exact: false });
      setMovRegistrado(data?.data?.data ?? null);
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar'),
  });

  const handleKeyDown = (e, siguienteId) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (siguienteId) document.getElementById(siguienteId)?.focus();
    }
  };

  if (movRegistrado) {
    return (
      <Modal open onClose={onClose} title="Movimiento registrado" size="sm">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-600">
            El movimiento fue registrado correctamente. ¿Deseas imprimir el recibo?
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onClose}>
              No, cerrar
            </Button>
            <Button className="flex-1" onClick={onClose}>
              <Printer size={15} /> Imprimir recibo
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={`Movimiento — ${acreedor.nombre}`} size="md">
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          {['Cargo', 'Abono'].map((t) => (
            <button
              key={t}
              onClick={() => setForm({ ...form, tipo: t })}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all
                ${form.tipo === t
                  ? t === 'Cargo'
                    ? 'bg-red-50 border-red-300 text-red-700'
                    : 'bg-green-50 border-green-300 text-green-700'
                  : 'bg-gray-50 border-gray-200 text-gray-600'}`}
            >
              {t}
            </button>
          ))}
        </div>

        <Input
          id="descripcion-mov"
          label="Descripción"
          placeholder="Ej: Compra mercancía"
          value={form.descripcion}
          onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
          onKeyDown={(e) => handleKeyDown(e, 'valor-acreedor')}
        />
        <Input
          id="valor-acreedor"
          label="Valor"
          type="number"
          placeholder="0"
          value={form.valor}
          onChange={(e) => setForm({ ...form, valor: e.target.value })}
        />

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
  const queryClient               = useQueryClient();
  const [form,  setForm]          = useState({ nombre: '', cedula: '', telefono: '' });
  const [error, setError]         = useState('');

  const mutation = useMutation({
    mutationFn: () => crearAcreedor(form),
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
        <Input
          id="nombre-acreedor"
          label="Nombre"
          placeholder="Nombre completo"
          value={form.nombre}
          onChange={(e) => setForm({ ...form, nombre: e.target.value })}
          onKeyDown={(e) => handleKeyDown(e, 'cedula-acreedor')}
        />
        <Input
          id="cedula-acreedor"
          label="Cédula"
          placeholder="123456789"
          value={form.cedula}
          onChange={(e) => setForm({ ...form, cedula: e.target.value })}
          onKeyDown={(e) => handleKeyDown(e, 'tel-acreedor')}
        />
        <Input
          id="tel-acreedor"
          label="Teléfono"
          placeholder="3001234567"
          value={form.telefono}
          onChange={(e) => setForm({ ...form, telefono: e.target.value })}
          onKeyDown={(e) => handleKeyDown(e, null)}
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Guardar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────
// LISTA DE ACREEDORES (componente extraído)
// ─────────────────────────────────────────────
function ListaAcreedores({ acreedores, acreedorSel, isLoading, busqueda, setBusqueda, onSeleccionar, onNuevo }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <SearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar acreedor..." />
        <button
          onClick={onNuevo}
          className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0 hover:bg-blue-700 transition-colors"
        >
          <Plus size={18} className="text-white" />
        </button>
      </div>

      {isLoading ? (
        <Spinner className="py-10" />
      ) : (
        <div className="flex flex-col gap-1 overflow-y-auto max-h-[65vh]">
          {acreedores.length === 0 ? (
            <EmptyState icon={Users} titulo="Sin acreedores" />
          ) : (
            acreedores.map((a) => {
              const saldo = Number(a.saldo || 0);
              return (
                <button
                  key={a.id}
                  onClick={() => onSeleccionar(a)}
                  className={`flex items-center justify-between p-3 rounded-xl text-left transition-all border
                    ${acreedorSel?.id === a.id
                      ? 'bg-blue-50 border-blue-200 text-blue-700'
                      : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50'}`}
                >
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
// DETALLE ACREEDOR (componente extraído)
// ─────────────────────────────────────────────
function DetalleAcreedor({ detalle, loadingDetalle, movimientosUI, onRegistrar, onImprimir, onVolver }) {
  if (loadingDetalle) return <Spinner className="py-20" />;

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={onVolver}
        className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 transition-colors lg:hidden w-fit"
      >
        <ChevronLeft size={16} />
        Volver a lista
      </button>

      <div className="bg-white border border-gray-100 rounded-2xl p-4 flex items-start justify-between shadow-sm">
        <div>
          <h2 className="font-bold text-gray-900">{detalle?.nombre}</h2>
          <p className="text-xs text-gray-400">CC: {detalle?.cedula} · {detalle?.telefono}</p>
          <p className={`text-lg font-bold mt-2 ${Number(detalle?.saldo) > 0 ? 'text-red-500' : 'text-green-600'}`}>
            {Number(detalle?.saldo) > 0 ? `Debemos: ${formatCOP(detalle?.saldo)}` : 'Sin deuda'}
          </p>
        </div>
        <Button onClick={onRegistrar}>
          <PenLine size={16} /> Registrar
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-gray-600">Historial</h3>
        {movimientosUI.length === 0 ? (
          <EmptyState icon={PenLine} titulo="Sin movimientos" />
        ) : (
          movimientosUI.map((m) => {
            const PrintIcon = Printer;
            return (
              <div
                key={m.id}
                className="bg-white border border-gray-100 rounded-xl p-3 flex items-start justify-between gap-3"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={m.tipo === 'Cargo' ? 'red' : 'green'}>{m.tipo}</Badge>
                    <span className="text-sm text-gray-700">{m.descripcion}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{formatFechaHora(m.fecha)}</p>
                  <div className="flex items-center gap-1 mt-1 text-xs text-gray-400">
                    <span>{formatCOP(m.saldo_antes)}</span>
                    <span>→</span>
                    <span className="font-semibold text-gray-600">{formatCOP(m.saldo_despues)}</span>
                  </div>
                  {m.firma && (
                    <img
                      src={m.firma}
                      alt="firma"
                      className="mt-2 h-12 border border-gray-100 rounded-lg"
                    />
                  )}
                </div>

                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <span className={`text-sm font-bold ${m.tipo === 'Cargo' ? 'text-red-500' : 'text-green-600'}`}>
                    {m.tipo === 'Cargo' ? '+' : '-'}{formatCOP(m.valor)}
                  </span>
                  <button
                    onClick={() => onImprimir(m)}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 transition-colors"
                    title="Imprimir recibo"
                  >
                    <PrintIcon size={14} />
                    <span className="hidden sm:inline">Recibo</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// PÁGINA PRINCIPAL
// ─────────────────────────────────────────────
export default function AcreedoresPage() {
  const [busqueda,    setBusqueda]    = useState('');
  const [acreedorSel, setAcreedorSel] = useState(null);
  const [modalMov,    setModalMov]    = useState(false);
  const [modalNuevo,  setModalNuevo]  = useState(false);
  const [movImprimir, setMovImprimir] = useState(null);

  // Acreedores es de negocio (negocio_id) → sin sucursalKey
  const { data: acreedoresData, isLoading } = useQuery({
    queryKey: ['acreedores', busqueda],
    queryFn:  () => getAcreedores(busqueda).then((r) => r.data.data),
  });

  // Detalle por ID único → sin sucursalKey
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

  const listaProps = {
    acreedores,
    acreedorSel,
    isLoading,
    busqueda,
    setBusqueda,
    onSeleccionar: handleSeleccionar,
    onNuevo: () => setModalNuevo(true),
  };

  const detalleProps = {
    detalle,
    loadingDetalle,
    movimientosUI,
    onRegistrar: () => setModalMov(true),
    onImprimir:  setMovImprimir,
    onVolver:    handleVolver,
  };

  return (
    <>
      {/* ── DESKTOP lg+: layout lado a lado ── */}
      <div className="hidden lg:flex gap-4">
        <div className="w-64 flex-shrink-0">
          <ListaAcreedores {...listaProps} />
        </div>
        <div className="flex-1">
          {!acreedorSel ? (
            <EmptyState
              icon={Users}
              titulo="Selecciona un acreedor"
              descripcion="Elige un acreedor para ver su historial"
            />
          ) : (
            <DetalleAcreedor {...detalleProps} />
          )}
        </div>
      </div>

      {/* ── MOBILE / TABLET <lg: una columna ── */}
      <div className="flex flex-col gap-4 lg:hidden">
        {!acreedorSel ? (
          <ListaAcreedores {...listaProps} />
        ) : (
          <DetalleAcreedor {...detalleProps} />
        )}
      </div>

      {modalMov && (
        <ModalMovimiento
          acreedor={acreedorSel}
          onClose={() => setModalMov(false)}
        />
      )}
      {modalNuevo && (
        <ModalNuevoAcreedor onClose={() => setModalNuevo(false)} />
      )}
      {movImprimir && detalle && (
        <ReciboAcreedor
          acreedor={detalle}
          movimiento={movImprimir}
          config={configData}
          onClose={() => setMovImprimir(null)}
        />
      )}
    </>
  );
}