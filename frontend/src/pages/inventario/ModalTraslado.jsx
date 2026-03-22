import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { buscarEquivalentes, ejecutarTraslado } from '../../api/traslados.api';
import { getSucursales } from '../../api/sucursales.api';
import { Modal }         from '../../components/ui/Modal';
import { Button }        from '../../components/ui/Button';
import { Spinner }       from '../../components/ui/Spinner';
import { SearchInput }   from '../../components/ui/SearchInput';
import useCarritoStore   from '../../store/carritoStore';
import useSucursalStore  from '../../store/sucursalStore';
import { useAuth }       from '../../context/useAuth';
import {
  ArrowRightLeft, ChevronRight, CheckCircle, AlertTriangle,
  Package, ShoppingBag,
} from 'lucide-react';

// ─── Indicador de nivel de coincidencia ───────────────────────────────────────
const NIVEL_CONFIG = {
  exacto:  { label: 'Coincidencia exacta',  color: 'text-green-600 bg-green-50 border-green-200' },
  parcial: { label: 'Coincidencia parcial',  color: 'text-amber-600 bg-amber-50 border-amber-200' },
  linea:   { label: 'Misma línea',           color: 'text-blue-600 bg-blue-50 border-blue-200' },
  todos:   { label: 'Sin coincidencia',      color: 'text-red-500 bg-red-50 border-red-200' },
};

function BadgeNivel({ nivel }) {
  const cfg = NIVEL_CONFIG[nivel] || NIVEL_CONFIG.todos;
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

// ─── Selector de producto destino por item ────────────────────────────────────
function SelectorDestino({ equivalencia, seleccionId, onSeleccionar }) {
  const [busqueda, setBusqueda] = useState('');

  const sugerencias = equivalencia.sugerencias || [];
  const filtradas = busqueda.trim()
    ? sugerencias.filter((s) => s.nombre.toLowerCase().includes(busqueda.toLowerCase()))
    : sugerencias;

  return (
    <div className="flex flex-col gap-2">
      {sugerencias.length > 5 && (
        <SearchInput value={busqueda} onChange={setBusqueda} placeholder="Filtrar productos..." />
      )}
      <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
        {filtradas.length === 0 ? (
          <p className="text-xs text-gray-400 px-2 py-3 text-center">
            No hay productos disponibles en la sucursal destino
          </p>
        ) : (
          filtradas.map((prod) => {
            const esSel = seleccionId === prod.id;
            return (
              <button key={prod.id} onClick={() => onSeleccionar(prod.id)}
                className={`flex items-center justify-between p-2.5 rounded-xl text-left text-sm border transition-all
                  ${esSel
                    ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-200'
                    : 'bg-white border-gray-100 hover:border-blue-200 hover:bg-blue-50/30'}`}>
                <div className="flex-1 min-w-0">
                  <p className={`font-medium truncate ${esSel ? 'text-blue-800' : 'text-gray-800'}`}>
                    {prod.nombre}
                  </p>
                  <p className="text-xs text-gray-400 truncate">
                    {[prod.marca, prod.modelo, prod.linea_nombre].filter(Boolean).join(' · ')}
                    {prod.stock != null && ` · Stock: ${prod.stock}`}
                    {prod.disponibles != null && ` · ${prod.disponibles} disp.`}
                  </p>
                </div>
                {esSel && <CheckCircle size={16} className="text-blue-600 flex-shrink-0 ml-2" />}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Card de item a trasladar ─────────────────────────────────────────────────
function ItemTraslado({ item, equivalencia, seleccionId, onSeleccionar }) {
  const [expandido, setExpandido] = useState(!equivalencia?.auto_seleccionado);

  const TipoIcon = item.tipo === 'serial' ? Package : ShoppingBag;
  const sinOpciones = !equivalencia || (equivalencia.sugerencias || []).length === 0;

  return (
    <div className={`rounded-2xl border overflow-hidden transition-all
      ${sinOpciones
        ? 'border-red-200 bg-red-50/30'
        : seleccionId
        ? 'border-green-200 bg-green-50/20'
        : 'border-amber-200 bg-amber-50/20'}`}>

      {/* Header del item */}
      <button onClick={() => setExpandido(!expandido)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/50 transition-colors">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
          ${item.tipo === 'serial' ? 'bg-blue-100' : 'bg-green-100'}`}>
          <TipoIcon size={14} className={item.tipo === 'serial' ? 'text-blue-600' : 'text-green-600'} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{item.nombre}</p>
          <div className="flex items-center gap-2 flex-wrap">
            {item.imei && <span className="text-xs text-gray-400 font-mono">{item.imei}</span>}
            {item.tipo === 'cantidad' && <span className="text-xs text-gray-400">×{item.cantidad || 1}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {equivalencia && <BadgeNivel nivel={equivalencia.nivel} />}
          {seleccionId
            ? <CheckCircle size={16} className="text-green-500" />
            : sinOpciones
            ? <AlertTriangle size={16} className="text-red-400" />
            : <ChevronRight size={14} className={`text-gray-400 transition-transform ${expandido ? 'rotate-90' : ''}`} />}
        </div>
      </button>

      {/* Selector expandido */}
      {expandido && equivalencia && (
        <div className="px-4 pb-3 border-t border-gray-100">
          <p className="text-xs text-gray-500 font-medium py-2">
            Selecciona el producto destino:
          </p>
          <SelectorDestino
            equivalencia={equivalencia}
            seleccionId={seleccionId}
            onSeleccionar={(id) => { onSeleccionar(id); setExpandido(false); }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Paso 1: Seleccionar sucursal destino ─────────────────────────────────────
function PasoSucursal({ sucursales, sucursalOrigenId, sucursalDestinoId, onSeleccionar }) {
  const otrasSucc = sucursales.filter((s) => s.id !== sucursalOrigenId);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-500">¿A qué sucursal quieres trasladar?</p>
      <div className="flex flex-col gap-2">
        {otrasSucc.map((s) => (
          <button key={s.id} onClick={() => onSeleccionar(s.id)}
            className={`flex items-center justify-between p-3.5 rounded-xl border text-left transition-all
              ${sucursalDestinoId === s.id
                ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-200'
                : 'bg-white border-gray-200 hover:border-blue-200 hover:bg-blue-50/30'}`}>
            <div>
              <p className={`text-sm font-semibold ${sucursalDestinoId === s.id ? 'text-blue-800' : 'text-gray-800'}`}>
                {s.nombre}
              </p>
              {s.direccion && <p className="text-xs text-gray-400 mt-0.5">{s.direccion}</p>}
            </div>
            {sucursalDestinoId === s.id && <CheckCircle size={18} className="text-blue-600" />}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Paso 2: Mapear productos ─────────────────────────────────────────────────
function PasoMapeo({ items, equivalencias, selecciones, onSeleccionar }) {
  const totalItems  = items.length;
  const mapeados    = Object.values(selecciones).filter(Boolean).length;
  const sinOpciones = equivalencias.filter((e) => (e.sugerencias || []).length === 0).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Vincula cada producto con su destino</p>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full
          ${mapeados === totalItems ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
          {mapeados}/{totalItems}
        </span>
      </div>

      {sinOpciones > 0 && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
          <p className="text-xs text-red-600">
            {sinOpciones} producto{sinOpciones !== 1 ? 's' : ''} no tiene{sinOpciones === 1 ? '' : 'n'} equivalente
            en la sucursal destino. Créalo{sinOpciones !== 1 ? 's' : ''} primero o retíra{sinOpciones !== 1 ? 'los' : 'lo'} del carrito.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto">
        {items.map((item) => {
          const equiv = equivalencias.find((e) => e.key === item.key);
          return (
            <ItemTraslado
              key={item.key}
              item={item}
              equivalencia={equiv}
              seleccionId={selecciones[item.key] || null}
              onSeleccionar={(id) => onSeleccionar(item.key, id)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Modal principal ──────────────────────────────────────────────────────────
export function ModalTraslado({ open, onClose }) {
  const queryClient = useQueryClient();
  const { items, limpiarCarrito } = useCarritoStore();
  const { usuario } = useAuth();
  const sucursalStore = useSucursalStore((s) => s.sucursalActiva);

  // Admin usa el store, supervisor usa su sucursal del token
  const sucursalOrigenId = sucursalStore || usuario?.sucursal_id || null;

  const [paso, setPaso]                         = useState(1);
  const [sucursalDestinoId, setSucursalDestinoId] = useState(null);
  const [equivalencias, setEquivalencias]       = useState([]);
  const [selecciones, setSelecciones]           = useState({});
  const [notas, setNotas]                       = useState('');
  const [error, setError]                       = useState('');

  // Cargar sucursales del negocio
  const { data: sucursalesRaw } = useQuery({
    queryKey: ['sucursales'],
    queryFn:  () => getSucursales().then((r) => r.data.data),
    enabled:  open,
  });
  const sucursales = sucursalesRaw || [];

  // Buscar equivalentes cuando se selecciona sucursal destino
  const mutBuscar = useMutation({
    mutationFn: (destinoId) => buscarEquivalentes({
      sucursal_destino_id: destinoId,
      items: items.map((item) => ({
        key:      item.key,
        tipo:     item.tipo === 'serial' ? 'serial' : 'cantidad',
        nombre:   item.nombre,
        marca:    item.marca    || null,
        modelo:   item.modelo   || null,
        linea_id: item.linea_id || null,
      })),
    }),
    onSuccess: (res) => {
      const data = res.data.data;
      setEquivalencias(data);

      // Auto-seleccionar los que tienen coincidencia exacta única
      const autoSel = {};
      data.forEach((eq) => {
        if (eq.auto_seleccionado) autoSel[eq.key] = eq.auto_seleccionado;
      });
      setSelecciones(autoSel);
      setPaso(2);
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al buscar equivalentes'),
  });

  // Ejecutar traslado
  const mutEjecutar = useMutation({
    mutationFn: () => {
      const lineas = items.map((item) => {
        const destinoId = selecciones[item.key];
        if (item.tipo === 'serial') {
          return {
            tipo:               'serial',
            serial_id:          item.serial_id,
            producto_destino_id: destinoId,
          };
        }
        return {
          tipo:                'cantidad',
          producto_origen_id:  item.producto_id,
          producto_destino_id: destinoId,
          cantidad:            item.cantidad || 1,
          nombre_producto:     item.nombre,
        };
      });

      return ejecutarTraslado({
        sucursal_origen_id:  sucursalOrigenId,
        sucursal_destino_id: sucursalDestinoId,
        notas:               notas || null,
        lineas,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productos-serial'],   exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['traslados'],          exact: false });
      limpiarCarrito();
      setPaso(3);
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al ejecutar traslado'),
  });

  const handleSeleccionarSucursal = (id) => {
    setSucursalDestinoId(id);
    setError('');
    mutBuscar.mutate(id);
  };

  const handleSeleccionarDestino = (key, productoDestinoId) => {
    setSelecciones((prev) => ({ ...prev, [key]: productoDestinoId }));
  };

  const handleConfirmar = () => {
    setError('');
    const sinMapear = items.filter((item) => !selecciones[item.key]);
    if (sinMapear.length > 0) {
      return setError(`Faltan ${sinMapear.length} producto(s) por vincular`);
    }
    mutEjecutar.mutate();
  };

  const sucursalOrigenNombre = sucursales.find((s) => s.id === sucursalOrigenId)?.nombre || '';
  const sucursalDestinoNombre = sucursales.find((s) => s.id === sucursalDestinoId)?.nombre || '';
  const todosMapeados = items.length > 0 && items.every((item) => selecciones[item.key]);

  // Paso 3: éxito
  if (paso === 3) {
    return (
      <Modal open={open} onClose={onClose} title="Traslado completado" size="sm">
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center">
            <CheckCircle size={28} className="text-green-600" />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-gray-900">Productos trasladados</p>
            <p className="text-sm text-gray-500 mt-1">
              {items.length} producto{items.length !== 1 ? 's' : ''} movido{items.length !== 1 ? 's' : ''} de{' '}
              <span className="font-medium">{sucursalOrigenNombre}</span> a{' '}
              <span className="font-medium">{sucursalDestinoNombre}</span>
            </p>
          </div>
          <Button className="w-full" onClick={onClose}>Cerrar</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Trasladar productos" size="md">
      <div className="flex flex-col gap-4">

        {/* Header visual */}
        <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3">
          <div className="flex-1 text-center">
            <p className="text-xs text-gray-400">Origen</p>
            <p className="text-sm font-semibold text-gray-800">{sucursalOrigenNombre}</p>
          </div>
          <ArrowRightLeft size={18} className="text-gray-400 flex-shrink-0" />
          <div className="flex-1 text-center">
            <p className="text-xs text-gray-400">Destino</p>
            <p className={`text-sm font-semibold ${sucursalDestinoId ? 'text-blue-700' : 'text-gray-300'}`}>
              {sucursalDestinoNombre || 'Seleccionar...'}
            </p>
          </div>
        </div>

        {/* Resumen de items */}
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Package size={12} />
          <span>{items.length} producto{items.length !== 1 ? 's' : ''} en el carrito</span>
        </div>

        {/* Paso 1: Seleccionar sucursal */}
        {paso === 1 && (
          <>
            <PasoSucursal
              sucursales={sucursales}
              sucursalOrigenId={sucursalOrigenId}
              sucursalDestinoId={sucursalDestinoId}
              onSeleccionar={handleSeleccionarSucursal}
            />
            {mutBuscar.isPending && (
              <div className="flex items-center justify-center gap-2 py-4">
                <Spinner className="py-0 scale-75" />
                <span className="text-sm text-gray-500">Buscando equivalentes...</span>
              </div>
            )}
          </>
        )}

        {/* Paso 2: Mapear productos */}
        {paso === 2 && (
          <>
            <PasoMapeo
              items={items}
              equivalencias={equivalencias}
              selecciones={selecciones}
              onSeleccionar={handleSeleccionarDestino}
            />

            <div className="flex flex-col gap-2">
              <input
                type="text" placeholder="Notas del traslado (opcional)"
                value={notas} onChange={(e) => setNotas(e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm
                  focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1"
                onClick={() => { setPaso(1); setSucursalDestinoId(null); setEquivalencias([]); setSelecciones({}); setError(''); }}>
                Cambiar sucursal
              </Button>
              <Button className="flex-1" loading={mutEjecutar.isPending}
                onClick={handleConfirmar} disabled={!todosMapeados}>
                <ArrowRightLeft size={14} />
                Trasladar {items.length} producto{items.length !== 1 ? 's' : ''}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}