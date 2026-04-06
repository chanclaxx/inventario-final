import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios.config';
import { getGarantias, crearGarantia, actualizarGarantia, eliminarGarantia } from '../../api/garantias.api';
import { getLineas, crearLinea, actualizarLinea, eliminarLinea }             from '../../api/productos.api';
import { UsuariosConfig }   from './UsuariosConfig';
import { SucursalesConfig } from './SucursalesConfig';
import { PasswordConfig }   from './PasswordConfig';
import { MetodosPagoConfig } from './MetodosPagoConfig';
import { Button }  from '../../components/ui/Button';
import { Input }   from '../../components/ui/Input';
import { Modal }   from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { Badge }   from '../../components/ui/Badge';
import {
  Settings, Save, Eye, EyeOff, Plus, Trash2,
  GripVertical, ToggleLeft, ToggleRight, Tag, Lock,
  Building2, ShieldCheck, FileSliders, BookOpen, Users, Printer, Palette,
} from 'lucide-react';

// ─── Secciones del sidebar ────────────────────────────────────────────────────

const SECCIONES = [
  { id: 'negocio',    label: 'Negocio',          Icn: Building2   },
  { id: 'seguridad',  label: 'Seguridad',         Icn: ShieldCheck },
  { id: 'formulario', label: 'Formulario venta',  Icn: FileSliders },
  { id: 'catalogo',   label: 'Catálogo',          Icn: BookOpen    },
  { id: 'equipo',     label: 'Equipo',            Icn: Users       },
];

// ─── Hook compartido de config ────────────────────────────────────────────────
function useConfigQuery() {
  return useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
  });
}

// ─── Toggle reutilizable ──────────────────────────────────────────────────────
function Toggle({ enabled, onChange, label, description }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {description && <span className="text-xs text-gray-400">{description}</span>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!enabled)}
        className="flex-shrink-0 transition-colors"
        aria-pressed={enabled}
      >
        {enabled
          ? <ToggleRight size={28} className="text-blue-600" />
          : <ToggleLeft  size={28} className="text-gray-300" />}
      </button>
    </div>
  );
}

// ─── Toggle solo lectura ──────────────────────────────────────────────────────
function ToggleReadOnly({ enabled, label, description }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-gray-700">{label}</span>
          <Lock size={11} className="text-gray-300" />
        </div>
        {description && <span className="text-xs text-gray-400">{description}</span>}
        <span className="text-xs text-gray-300 mt-0.5">
          Solo puede ser modificado por el administrador del sistema
        </span>
      </div>
      <div className="flex-shrink-0 cursor-not-allowed opacity-60">
        {enabled
          ? <ToggleRight size={28} className="text-blue-400" />
          : <ToggleLeft  size={28} className="text-gray-300" />}
      </div>
    </div>
  );
}

// ─── Líneas de producto ───────────────────────────────────────────────────────
function LineasConfig() {
  const queryClient               = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editando,  setEditando]  = useState(null);
  const [nombre,    setNombre]    = useState('');
  const [error,     setError]     = useState('');

  const { data: lineas = [] } = useQuery({
    queryKey: ['lineas'],
    queryFn:  () => getLineas().then((r) => r.data.data),
  });

  const mutCrear = useMutation({
    mutationFn: () => crearLinea(nombre),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lineas'], exact: false });
      cerrarModal();
    },
    onError: (e) => setError(e.response?.data?.error || 'Error al crear la línea'),
  });

  const mutEditar = useMutation({
    mutationFn: () => actualizarLinea(editando.id, nombre),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lineas'], exact: false });
      cerrarModal();
    },
    onError: (e) => setError(e.response?.data?.error || 'Error al actualizar la línea'),
  });

  const mutEliminar = useMutation({
    mutationFn: (id) => eliminarLinea(id),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['lineas'], exact: false }),
    onError:    (e) => alert(e.response?.data?.error || 'Error al eliminar la línea'),
  });

  const abrirNuevo  = () => { setEditando(null); setNombre(''); setError(''); setModalOpen(true); };
  const abrirEditar = (l) => { setEditando(l); setNombre(l.nombre); setError(''); setModalOpen(true); };
  const cerrarModal = () => { setModalOpen(false); setEditando(null); setNombre(''); setError(''); };

  const handleGuardar = () => {
    if (!nombre.trim()) return setError('El nombre es requerido');
    editando ? mutEditar.mutate() : mutCrear.mutate();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag size={15} className="text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-700">Líneas de producto</h3>
        </div>
        <button
          onClick={abrirNuevo}
          className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center
            hover:bg-blue-700 transition-colors"
        >
          <Plus size={15} className="text-white" />
        </button>
      </div>
      <p className="text-xs text-gray-400 -mt-2">
        Agrupa tus productos por línea. Ej: Consolas, Videojuegos, Accesorios.
      </p>

      {lineas.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">Sin líneas configuradas</p>
      ) : (
        <div className="flex flex-col gap-2">
          {lineas.map((l) => {
            const lineaId     = l.id;
            const lineaNombre = l.nombre;
            return (
              <div key={lineaId} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <GripVertical size={15} className="text-gray-300 flex-shrink-0" />
                <p className="text-sm font-medium text-gray-800 flex-1 min-w-0 truncate">
                  {lineaNombre}
                </p>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => abrirEditar(l)}
                    className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors">
                    <Settings size={14} />
                  </button>
                  <button onClick={() => mutEliminar.mutate(lineaId)}
                    disabled={mutEliminar.isPending}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={modalOpen} onClose={cerrarModal}
        title={editando ? 'Editar línea' : 'Nueva línea'} size="sm">
        <div className="flex flex-col gap-4">
          <Input label="Nombre de la línea" placeholder="Ej: Consolas, Videojuegos..."
            value={nombre} onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleGuardar(); }} autoFocus />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={cerrarModal}>Cancelar</Button>
            <Button className="flex-1" loading={mutCrear.isPending || mutEditar.isPending}
              onClick={handleGuardar} disabled={!nombre.trim()}>
              {editando ? 'Guardar cambios' : 'Crear línea'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Garantías ────────────────────────────────────────────────────────────────
function GarantiasConfig() {
  const queryClient               = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editando,  setEditando]  = useState(null);
  const [form,      setForm]      = useState({ titulo: '', texto: '', orden: 0, lineas: [] });
  const [error,     setError]     = useState('');

  const { data: garantias = [] } = useQuery({
    queryKey: ['garantias'],
    queryFn:  () => getGarantias().then((r) => r.data.data),
  });

  const { data: lineas = [] } = useQuery({
    queryKey: ['lineas'],
    queryFn:  () => getLineas().then((r) => r.data.data),
  });

  const mutCrear = useMutation({
    mutationFn: () => crearGarantia(form),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['garantias'], exact: false }); cerrarModal(); },
    onError: (e) => setError(e.response?.data?.error || 'Error'),
  });

  const mutEditar = useMutation({
    mutationFn: () => actualizarGarantia(editando.id, form),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['garantias'], exact: false }); cerrarModal(); },
    onError: (e) => setError(e.response?.data?.error || 'Error'),
  });

  const mutEliminar = useMutation({
    mutationFn: (id) => eliminarGarantia(id),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['garantias'], exact: false }),
  });

  const abrirNuevo  = () => { setEditando(null); setForm({ titulo: '', texto: '', orden: garantias.length, lineas: [] }); setError(''); setModalOpen(true); };
  const abrirEditar = (g) => { setEditando(g); setForm({ titulo: g.titulo, texto: g.texto, orden: g.orden, lineas: g.lineas || [] }); setError(''); setModalOpen(true); };
  const cerrarModal = () => { setModalOpen(false); setEditando(null); setError(''); };

  const handleGuardar = () => {
    if (!form.titulo.trim()) return setError('El título es requerido');
    if (!form.texto.trim())  return setError('El texto es requerido');
    if (!form.lineas.length) return setError('Selecciona al menos una línea');
    editando ? mutEditar.mutate() : mutCrear.mutate();
  };

  const toggleLinea = (lineaId) => {
    setForm((f) => ({
      ...f,
      lineas: f.lineas.includes(lineaId)
        ? f.lineas.filter((id) => id !== lineaId)
        : [...f.lineas, lineaId],
    }));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Garantías y Términos</h3>
        <button onClick={abrirNuevo}
          className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center hover:bg-blue-700 transition-colors">
          <Plus size={15} className="text-white" />
        </button>
      </div>

      {garantias.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">Sin garantías configuradas</p>
      ) : (
        <div className="flex flex-col gap-2">
          {[...garantias].sort((a, b) => a.orden - b.orden).map((g) => {
            const garantiaId      = g.id;
            const lineasAsignadas = lineas.filter((l) => g.lineas?.includes(l.id)).map((l) => l.nombre);
            return (
              <div key={garantiaId} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                <GripVertical size={16} className="text-gray-300 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{g.titulo}</p>
                  <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{g.texto}</p>
                  {lineasAsignadas.length > 0 ? (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {lineasAsignadas.map((nombre) => (
                        <span key={nombre}
                          className="text-xs bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-full">
                          {nombre}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-yellow-500 mt-1">Sin líneas asignadas</p>
                  )}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => abrirEditar(g)}
                    className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors">
                    <Settings size={14} />
                  </button>
                  <button onClick={() => mutEliminar.mutate(garantiaId)}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={modalOpen} onClose={cerrarModal}
        title={editando ? 'Editar Garantía' : 'Nueva Garantía'} size="md">
        <div className="flex flex-col gap-4">
          <Input label="Título" placeholder="Ej: Garantía de Celulares"
            value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Texto de garantía</label>
            <textarea rows={6} placeholder="Escribe los términos y condiciones..."
              value={form.texto} onChange={(e) => setForm({ ...form, texto: e.target.value })}
              className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm text-gray-900
                placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500
                focus:bg-white transition-all resize-none" />
          </div>
          <Input label="Orden (número)" type="number" value={form.orden}
            onChange={(e) => setForm({ ...form, orden: Number(e.target.value) })} />
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-gray-700">
              Líneas que aplican
              <span className="text-gray-400 font-normal text-xs ml-1">
                (aparece en facturas con productos de estas líneas)
              </span>
            </label>
            {lineas.length === 0 ? (
              <p className="text-xs text-gray-400">No hay líneas configuradas. Créalas primero.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {lineas.map((l) => {
                  const lineaId     = l.id;
                  const lineaNombre = l.nombre;
                  const marcada     = form.lineas.includes(lineaId);
                  return (
                    <label key={lineaId}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors
                        ${marcada ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-100 hover:border-gray-200'}`}>
                      <input type="checkbox" checked={marcada} onChange={() => toggleLinea(lineaId)}
                        className="accent-blue-600 w-4 h-4 flex-shrink-0" />
                      <span className={`text-sm font-medium ${marcada ? 'text-blue-700' : 'text-gray-700'}`}>
                        {lineaNombre}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={cerrarModal}>Cancelar</Button>
            <Button className="flex-1" loading={mutCrear.isPending || mutEditar.isPending} onClick={handleGuardar}>
              {editando ? 'Guardar cambios' : 'Crear garantía'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Campos opcionales del formulario de venta ────────────────────────────────
const CAMPOS_EDITABLES = [
  { clave: 'campo_direccion_cliente', label: 'Dirección del cliente', description: 'Muestra el campo de dirección al registrar una venta' },
];

const CAMPOS_READONLY = [
  { clave: 'campo_email_cliente', label: 'Envío de facturas por email', description: 'Envía automáticamente la factura al correo del cliente' },
];

// ─── Configuración de impresora ──────────────────────────────────────────────
const PRESETS_PAPEL = [
  { label: '80mm (estándar)', valor: '80' },
  { label: '58mm (compacto)', valor: '58' },
];

function ImpresoraConfig({ valores, set }) {
  const escala     = valores['impresion_escala']      || '1.5';
  const anchoPapel = valores['impresion_ancho_papel'] || '80';
  const fuenteSize = valores['impresion_fuente_size'] || '13';
  const padding    = valores['impresion_padding']     || '2';

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Printer size={15} className="text-gray-400" />
        <h3 className="text-sm font-semibold text-gray-700">Configuración de impresora</h3>
      </div>

      <div className="flex flex-col gap-4">

        {/* Ancho del papel */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-600">Ancho del papel</label>
          <div className="flex gap-2">
            {PRESETS_PAPEL.map((p) => {
              const presetValor = p.valor;
              const presetLabel = p.label;
              return (
                <button
                  key={presetValor}
                  type="button"
                  onClick={() => set('impresion_ancho_papel', presetValor)}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-all
                    ${anchoPapel === presetValor
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'}`}
                >
                  {presetLabel}
                </button>
              );
            })}
          </div>
        </div>

        {/* Escala de impresión */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-gray-600">Escala de impresión</label>
            <span className="text-sm font-bold text-gray-800 tabular-nums">
              {Number(escala).toFixed(2)}×
            </span>
          </div>
          <input
            type="range" min="0.5" max="3.0" step="0.05"
            value={escala}
            onChange={(e) => set('impresion_escala', e.target.value)}
            className="w-full accent-blue-600 h-2 rounded-full"
          />
          <div className="flex justify-between text-xs text-gray-400">
            <span>0.5× (pequeño)</span>
            <span>3.0× (grande)</span>
          </div>
          <p className="text-xs text-gray-400">
            Equivale al valor de "Escala" en el diálogo de impresión del navegador.
            Ajusta hasta que la factura llene bien el papel sin cortarse.
          </p>
        </div>

        {/* Tamaño de fuente */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-gray-600">Tamaño de fuente</label>
            <span className="text-sm font-bold text-gray-800 tabular-nums">{fuenteSize}px</span>
          </div>
          <input
            type="range" min="9" max="18" step="1"
            value={fuenteSize}
            onChange={(e) => set('impresion_fuente_size', e.target.value)}
            className="w-full accent-blue-600 h-2 rounded-full"
          />
          <div className="flex justify-between text-xs text-gray-400">
            <span>9px (compacto)</span>
            <span>18px (grande)</span>
          </div>
        </div>

        {/* Padding */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-gray-600">Margen interno (padding)</label>
            <span className="text-sm font-bold text-gray-800 tabular-nums">{padding}mm</span>
          </div>
          <input
            type="range" min="0" max="8" step="0.5"
            value={padding}
            onChange={(e) => set('impresion_padding', e.target.value)}
            className="w-full accent-blue-600 h-2 rounded-full"
          />
          <div className="flex justify-between text-xs text-gray-400">
            <span>0mm (sin margen)</span>
            <span>8mm (amplio)</span>
          </div>
        </div>

        {/* Preview visual */}
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-gray-600">Vista previa (pantalla)</p>
          <div className="flex justify-center bg-gray-100 rounded-xl p-4 overflow-hidden">
            <div
              style={{
                width:           `${anchoPapel}mm`,
                fontSize:        `${fuenteSize}px`,
                padding:         `${padding}mm`,
                fontFamily:      "'Courier New', monospace",
                background:      'white',
                border:          '1px solid #e5e7eb',
                boxSizing:       'border-box',
                transform:       `scale(${Math.min(Number(escala), 1.2)})`,
                transformOrigin: 'top center',
              }}
            >
              <p style={{ textAlign: 'center', fontWeight: 900, marginBottom: 4 }}>FACTURA DE VENTA</p>
              <p style={{ textAlign: 'center', marginBottom: 4 }}>Vista previa · {anchoPapel}mm</p>
              <div style={{ borderTop: '1.5px solid #000', margin: '4px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', margin: '2px 0' }}>
                <span>Producto ejemplo</span><span>$50.000</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', margin: '2px 0' }}>
                <span>Producto 2</span><span>$30.000</span>
              </div>
              <div style={{ borderTop: '1.5px solid #000', margin: '4px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, fontSize: `${Number(fuenteSize) + 1}px` }}>
                <span>TOTAL:</span><span>$80.000</span>
              </div>
              <p style={{ textAlign: 'center', marginTop: 6, fontSize: `${Number(fuenteSize) - 2}px` }}>
                ¡Gracias por su compra!
              </p>
            </div>
          </div>
          <p className="text-xs text-gray-400 text-center">
            La escala real en impresión puede verse diferente al preview
          </p>
        </div>

      </div>
    </div>
  );
}

// ─── Colores de serial ────────────────────────────────────────────────────────
function ColoresSerialConfig({ valores, set }) {
  const activo   = valores['colores_serial_activo'] === '1';
  const listaRaw = valores['colores_serial_lista'];
  const colores  = (() => {
    try { return JSON.parse(listaRaw || '[]'); }
    catch { return []; }
  })();

  const [nuevoColor, setNuevoColor] = useState('');
  const [error,      setError]      = useState('');

  const setColores = (nuevaLista) => {
    set('colores_serial_lista', JSON.stringify(nuevaLista));
  };

  const handleAgregar = () => {
    const limpio = nuevoColor.trim();
    if (!limpio)               return setError('El nombre del color es requerido');
    if (colores.includes(limpio)) return setError('Este color ya existe');
    setColores([...colores, limpio]);
    setNuevoColor('');
    setError('');
  };

  const handleEliminar = (color) => {
    setColores(colores.filter((c) => c !== color));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Palette size={15} className="text-gray-400" />
        <h3 className="text-sm font-semibold text-gray-700">Colores de serial</h3>
      </div>
      <p className="text-xs text-gray-400 -mt-2">
        Al activar esta opción, podrás asignar un color a cada serial registrado.
      </p>

      <Toggle
        label="Activar colores por serial"
        description="Muestra un selector de color al agregar o editar un serial"
        enabled={activo}
        onChange={(val) => set('colores_serial_activo', val ? '1' : '0')}
      />

      {activo && (
        <div className="flex flex-col gap-3">
          {colores.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-2">
              Sin colores configurados
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {colores.map((color) => {
                const colorNombre = color;
                return (
                  <div key={colorNombre}
                    className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                    <GripVertical size={15} className="text-gray-300 flex-shrink-0" />
                    <p className="text-sm font-medium text-gray-800 flex-1 min-w-0 truncate">
                      {colorNombre}
                    </p>
                    <button
                      onClick={() => handleEliminar(colorNombre)}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400
                        hover:text-red-500 transition-colors flex-shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={nuevoColor}
              onChange={(e) => { setNuevoColor(e.target.value); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAgregar(); }}
              placeholder="Ej: Negro, Azul, Rojo..."
              className="flex-1 px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm
                text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2
                focus:ring-blue-500 focus:bg-white transition-all"
            />
            <button
              onClick={handleAgregar}
              className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center
                hover:bg-blue-700 transition-colors flex-shrink-0"
            >
              <Plus size={15} className="text-white" />
            </button>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )}
    </div>
  );
}

// ─── Secciones ────────────────────────────────────────────────────────────────

function SeccionNegocio({ valores, set, form, mutation, guardado }) {
  const camposNegocio = [
    { clave: 'nombre_negocio', label: 'Nombre del negocio', placeholder: 'Mi Tienda' },
    { clave: 'nit',            label: 'NIT',                placeholder: '900123456-1' },
    { clave: 'direccion',      label: 'Dirección',          placeholder: 'Calle 10 # 5-20' },
    { clave: 'telefono',       label: 'Teléfono',           placeholder: '3001234567' },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Datos del negocio</h2>
        <p className="text-xs text-gray-400 mt-0.5">Esta información aparece en las facturas impresas.</p>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
        {camposNegocio.map(({ clave, label, placeholder }) => (
          <Input key={clave} label={label} placeholder={placeholder}
            value={valores[clave] || ''} onChange={(e) => set(clave, e.target.value)} />
        ))}
      </div>

      <ImpresoraConfig valores={valores} set={set} />

      <div className="flex items-center gap-3">
        <Button className="flex-1" loading={mutation.isPending} onClick={() => mutation.mutate(form)}>
          <Save size={16} /> Guardar cambios
        </Button>
        {guardado && <Badge variant="green">✓ Guardado</Badge>}
      </div>
    </div>
  );
}

function SeccionSeguridad({ form, set, mutation, guardado }) {
  const [verPin, setVerPin] = useState(false);
  const pinNuevo = form['pin_eliminacion'] || '';

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Seguridad</h2>
        <p className="text-xs text-gray-400 mt-0.5">Controla el acceso a acciones sensibles del sistema.</p>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
        <div className="relative">
          <Input label="PIN de eliminación / cancelación"
            type={verPin ? 'text' : 'password'}
            placeholder="Dejar vacío para mantener el actual"
            value={pinNuevo}
            onChange={(e) => set('pin_eliminacion', e.target.value)} />
          <button type="button" onClick={() => setVerPin((v) => !v)}
            className="absolute right-3 top-8 text-gray-400 hover:text-gray-600 transition-colors">
            {verPin ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <p className="text-xs text-gray-400 -mt-2">
          {pinNuevo
            ? 'Se guardará un nuevo PIN al hacer clic en Guardar cambios.'
            : 'Escribe un nuevo PIN solo si quieres cambiarlo. Vacío mantiene el actual.'}
        </p>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <PasswordConfig />
      </div>

      <div className="flex items-center gap-3">
        <Button className="flex-1" loading={mutation.isPending} onClick={() => mutation.mutate(form)}>
          <Save size={16} /> Guardar cambios
        </Button>
        {guardado && <Badge variant="green">✓ Guardado</Badge>}
      </div>
    </div>
  );
}

function SeccionFormulario({ valores, set, form, mutation, guardado }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Formulario de venta</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Activa los campos adicionales que quieres recolectar al facturar.
        </p>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
        {CAMPOS_EDITABLES.map((campo) => {
          const clave   = campo.clave;
          const enabled = valores[clave] === '1';
          return (
            <Toggle key={clave} label={campo.label} description={campo.description}
              enabled={enabled} onChange={(val) => set(clave, val ? '1' : '0')} />
          );
        })}

        {CAMPOS_READONLY.length > 0 && (
          <div className="border-t border-gray-100 pt-4 flex flex-col gap-4">
            {CAMPOS_READONLY.map((campo) => {
              const clave   = campo.clave;
              const enabled = valores[clave] === '1';
              return (
                <ToggleReadOnly key={clave} label={campo.label}
                  description={campo.description} enabled={enabled} />
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button className="flex-1" loading={mutation.isPending} onClick={() => mutation.mutate(form)}>
          <Save size={16} /> Guardar cambios
        </Button>
        {guardado && <Badge variant="green">✓ Guardado</Badge>}
      </div>
    </div>
  );
}

// ─── SeccionCatalogo — recibe props para ColoresSerialConfig y botón guardar ──
function SeccionCatalogo({ valores, set, form, mutation, guardado }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Catálogo</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Organiza tus productos en líneas y configura las garantías por categoría.
        </p>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <LineasConfig />
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <GarantiasConfig />
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <ColoresSerialConfig valores={valores} set={set} />
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <MetodosPagoConfig valores={valores} set={set} />
      </div>

      <div className="flex items-center gap-3">
        <Button className="flex-1" loading={mutation.isPending} onClick={() => mutation.mutate(form)}>
          <Save size={16} /> Guardar cambios
        </Button>
        {guardado && <Badge variant="green">✓ Guardado</Badge>}
      </div>
    </div>
  );
}

function SeccionEquipo() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Equipo</h2>
        <p className="text-xs text-gray-400 mt-0.5">Gestiona los usuarios y sucursales de tu negocio.</p>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <SucursalesConfig />
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <UsuariosConfig />
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function ConfigPage() {
  const queryClient                 = useQueryClient();
  const { data: config, isLoading } = useConfigQuery();
  const [form,          setForm]    = useState({});
  const [guardado,      setGuardado] = useState(false);
  const [seccionActiva, setSeccionActiva] = useState('negocio');

  const mutation = useMutation({
    mutationFn: (payload) => api.put('/config', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'], exact: false });
      setForm((f) => {
        const siguiente = { ...f };
        delete siguiente['pin_eliminacion'];
        return siguiente;
      });
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2000);
    },
  });

  if (isLoading) return <Spinner className="py-32" />;

  const valores = { ...config, ...form };
  const set     = (clave, valor) => setForm((f) => ({ ...f, [clave]: valor }));

  return (
    <div className="flex flex-col gap-4">

      {/* ── Encabezado ── */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center">
          <Settings size={20} className="text-gray-500" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-900">Configuración</h1>
          <p className="text-xs text-gray-400">Administra tu negocio y preferencias</p>
        </div>
      </div>

      <div className="flex gap-5 items-start">

        {/* ── Sidebar ── */}
        <nav className="flex-shrink-0 w-12 sm:w-44 flex flex-col gap-1">
          {SECCIONES.map((sec) => {
            const secId    = sec.id;
            const secLabel = sec.label;
            const SecIcn   = sec.Icn;
            const activa   = seccionActiva === secId;
            return (
              <button
                key={secId}
                onClick={() => setSeccionActiva(secId)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-left
                  transition-all w-full
                  ${activa
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'}`}
              >
                <SecIcn size={17} className="flex-shrink-0" />
                <span className="hidden sm:block text-sm font-medium truncate">{secLabel}</span>
              </button>
            );
          })}
        </nav>

        {/* ── Contenido ── */}
        <div className="flex-1 min-w-0">
          {seccionActiva === 'negocio'    && (
            <SeccionNegocio valores={valores} set={set} form={form} mutation={mutation} guardado={guardado} />
          )}
          {seccionActiva === 'seguridad'  && (
            <SeccionSeguridad form={form} set={set} mutation={mutation} guardado={guardado} />
          )}
          {seccionActiva === 'formulario' && (
            <SeccionFormulario valores={valores} set={set} form={form} mutation={mutation} guardado={guardado} />
          )}
          {seccionActiva === 'catalogo'   && (
            <SeccionCatalogo valores={valores} set={set} form={form} mutation={mutation} guardado={guardado} />
          )}
          {seccionActiva === 'equipo'     && <SeccionEquipo />}
        </div>

      </div>
    </div>
  );
}