import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  buscarEquivalentes, ejecutarTraslado, buscarProductosEnSucursal,
  getCatalogoSucursal, buscarSerialesProducto,
} from '../../api/traslados.api';
import { getSucursales }  from '../../api/sucursales.api';
import { Modal }          from '../../components/ui/Modal';
import { Button }         from '../../components/ui/Button';
import { Spinner }        from '../../components/ui/Spinner';
import { SearchInput }    from '../../components/ui/SearchInput';
import useSucursalStore   from '../../store/sucursalStore';
import { useAuth }        from '../../context/useAuth';
import {
  ArrowRightLeft, ChevronDown, ChevronUp, ChevronRight,
  CheckCircle, AlertTriangle, Package, ShoppingBag, Search, Plus, Minus,
} from 'lucide-react';

// ─── Normalización (espejo del backend) ──────────────────────────────────────

const _norm = (s) =>
  (s || '').toLowerCase().trim().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[-_]/g, ' ').replace(/\s+/g, ' ');

const _tokens = (s) => _norm(s).split(/\s+/).filter((t) => t.length >= 2);

const _matches = (nombre, query) => {
  if (!query.trim()) return true;
  const q = _norm(query);
  const n = _norm(nombre);
  if (n.includes(q) || q.includes(n)) return true;
  const qt = _tokens(query);
  const nt = _tokens(nombre);
  return qt.length > 0 && qt.some((t) => nt.some((nt2) => nt2.startsWith(t) || t.startsWith(nt2)));
};

// ─── Badge de coincidencia ────────────────────────────────────────────────────

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

// ─── Selector de equivalente en MI sucursal ───────────────────────────────────

function SelectorMiProducto({ equivalencia, seleccionId, onSeleccionar, miSucursalId }) {
  const [busqueda, setBusqueda]                   = useState('');
  const [resultadosManuales, setResultadosManuales] = useState(null);
  const [buscando, setBuscando]                   = useState(false);
  const [errorBusqueda, setErrorBusqueda]         = useState('');

  const sugerencias  = equivalencia.sugerencias || [];
  const filtradas    = sugerencias.filter((s) => _matches(s.nombre, busqueda));
  const listaVisible = resultadosManuales !== null ? resultadosManuales : filtradas;

  const handleBuscarEnMiSucursal = async () => {
    if (!busqueda.trim() || busqueda.trim().length < 2) return;
    setBuscando(true);
    setErrorBusqueda('');
    try {
      const res = await buscarProductosEnSucursal(miSucursalId, equivalencia.tipo, busqueda.trim());
      setResultadosManuales(res.data.data || []);
    } catch {
      setErrorBusqueda('Error al buscar. Intenta de nuevo.');
      setResultadosManuales([]);
    } finally {
      setBuscando(false);
    }
  };

  const msgVacio = resultadosManuales !== null
    ? 'No se encontraron productos con ese término en tu sucursal'
    : busqueda.trim()
    ? 'Sin coincidencias — prueba el botón "Buscar"'
    : 'No hay productos disponibles en tu sucursal';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 items-center">
        <div className="flex-1">
          <SearchInput
            value={busqueda}
            onChange={(v) => { setBusqueda(v); setErrorBusqueda(''); if (!v.trim()) setResultadosManuales(null); }}
            placeholder="Buscar en mi sucursal..."
          />
        </div>
        {busqueda.trim().length >= 2 && (
          <button
            type="button"
            onClick={handleBuscarEnMiSucursal}
            disabled={buscando}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-xs
              font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors
              whitespace-nowrap flex-shrink-0"
          >
            <Search size={11} />
            {buscando ? 'Buscando...' : 'Buscar'}
          </button>
        )}
      </div>

      {resultadosManuales !== null && (
        <div className="flex items-center justify-between text-xs px-0.5">
          <span className={resultadosManuales.length === 0 ? 'text-red-500' : 'text-blue-600'}>
            {errorBusqueda || (resultadosManuales.length === 0
              ? 'Sin resultados'
              : `${resultadosManuales.length} resultado${resultadosManuales.length !== 1 ? 's' : ''} encontrado${resultadosManuales.length !== 1 ? 's' : ''}`)}
          </span>
          <button
            type="button"
            onClick={() => { setResultadosManuales(null); setBusqueda(''); }}
            className="text-gray-400 underline hover:text-gray-600"
          >
            Ver sugerencias
          </button>
        </div>
      )}

      <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
        {listaVisible.length === 0 ? (
          <p className="text-xs text-gray-400 px-2 py-3 text-center">{msgVacio}</p>
        ) : listaVisible.map((prod) => {
          const esSel = seleccionId === prod.id;
          return (
            <button
              key={prod.id}
              onClick={() => onSeleccionar(prod.id)}
              className={`flex items-center justify-between p-2.5 rounded-xl text-left text-sm border transition-all
                ${esSel
                  ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-200'
                  : 'bg-white border-gray-100 hover:border-blue-200 hover:bg-blue-50/30'}`}
            >
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
        })}
      </div>
    </div>
  );
}

// ─── Card de item a mapear (paso 3) ──────────────────────────────────────────

function ItemMapeo({ item, equivalencia, seleccionId, onSeleccionar, miSucursalId }) {
  const [expandido, setExpandido] = useState(!equivalencia?.auto_seleccionado);
  const TipoIcon   = item.tipo === 'serial' ? Package : ShoppingBag;
  const sinOpciones = !equivalencia || (equivalencia.sugerencias || []).length === 0;

  return (
    <div className={`rounded-2xl border overflow-hidden transition-all
      ${sinOpciones
        ? 'border-red-200 bg-red-50/30'
        : seleccionId
        ? 'border-green-200 bg-green-50/20'
        : 'border-amber-200 bg-amber-50/20'}`}>

      <button
        onClick={() => setExpandido(!expandido)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/50 transition-colors"
      >
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

      {expandido && equivalencia && (
        <div className="px-4 pb-3 border-t border-gray-100">
          <p className="text-xs text-gray-500 font-medium py-2">
            Selecciona el producto en tu sucursal:
          </p>
          <SelectorMiProducto
            equivalencia={equivalencia}
            seleccionId={seleccionId}
            onSeleccionar={(id) => { onSeleccionar(id); setExpandido(false); }}
            miSucursalId={miSucursalId}
          />
        </div>
      )}
    </div>
  );
}

// ─── Paso 1: Seleccionar sucursal origen ──────────────────────────────────────

function PasoSucursalOrigen({ sucursales, miSucursalId, seleccionadoId, onSeleccionar }) {
  const otras = sucursales.filter((s) => s.id !== miSucursalId);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-500">¿De qué sucursal quieres traer productos?</p>
      <div className="flex flex-col gap-2">
        {otras.map((s) => (
          <button
            key={s.id}
            onClick={() => onSeleccionar(s.id)}
            className={`flex items-center justify-between p-3.5 rounded-xl border text-left transition-all
              ${seleccionadoId === s.id
                ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-200'
                : 'bg-white border-gray-200 hover:border-blue-200 hover:bg-blue-50/30'}`}
          >
            <div>
              <p className={`text-sm font-semibold ${seleccionadoId === s.id ? 'text-blue-800' : 'text-gray-800'}`}>
                {s.nombre}
              </p>
              {s.direccion && <p className="text-xs text-gray-400 mt-0.5">{s.direccion}</p>}
            </div>
            {seleccionadoId === s.id && <CheckCircle size={18} className="text-blue-600" />}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Paso 2: Explorar y seleccionar productos de la sucursal origen ───────────

function PasoSeleccionProductos({ sucursalOrigenId, itemsSeleccionados, onToggleSerial, onCambiarCantidad }) {
  const [tipo, setTipo]                         = useState('serial');
  const [busqueda, setBusqueda]                 = useState('');
  const [busquedaServidor, setBusquedaServidor] = useState('');
  const [productoExpandidoId, setProductoExpandidoId] = useState(null);

  const { data: catalogo, isLoading, isFetching } = useQuery({
    queryKey: ['catalogo-jalar', sucursalOrigenId, tipo, busquedaServidor],
    queryFn:  () => getCatalogoSucursal(sucursalOrigenId, tipo, busquedaServidor).then((r) => r.data.data),
    enabled:  !!sucursalOrigenId,
    staleTime: 30_000,
  });

  const { data: seriales, isLoading: loadingSeriales } = useQuery({
    queryKey: ['seriales-jalar', sucursalOrigenId, productoExpandidoId],
    queryFn:  () => buscarSerialesProducto(sucursalOrigenId, productoExpandidoId).then((r) => r.data.data),
    enabled:  !!sucursalOrigenId && !!productoExpandidoId && tipo === 'serial',
    staleTime: 10_000,
  });

  const handleCambiarTipo = (t) => {
    setTipo(t);
    setProductoExpandidoId(null);
    setBusqueda('');
    setBusquedaServidor('');
  };

  const handleBuscarServidor = () => {
    if (busqueda.trim().length >= 2) setBusquedaServidor(busqueda.trim());
  };

  // Filtro client-side sobre el catálogo ya cargado
  const lista = (catalogo || []).filter((p) => _matches(p.nombre, busqueda));

  const serialesSelCount  = itemsSeleccionados.filter((i) => i.tipo === 'serial').length;
  const cantidadSelCount  = itemsSeleccionados.filter((i) => i.tipo === 'cantidad').length;

  return (
    <div className="flex flex-col gap-3">

      {/* Tabs serial / cantidad */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
        {[
          { id: 'serial',   label: 'Con serial',   Icon: Package,     count: serialesSelCount },
          { id: 'cantidad', label: 'Por cantidad',  Icon: ShoppingBag, count: cantidadSelCount },
        ].map(({ id, label, Icon, count }) => (
          <button
            key={id}
            onClick={() => handleCambiarTipo(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg
              text-xs font-medium transition-all
              ${tipo === id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Icon size={12} />
            {label}
            {count > 0 && (
              <span className={`ml-1 text-white text-xs px-1.5 rounded-full
                ${id === 'serial' ? 'bg-blue-500' : 'bg-green-500'}`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Barra de búsqueda */}
      <div className="flex gap-2 items-center">
        <div className="flex-1">
          <SearchInput
            value={busqueda}
            onChange={(v) => { setBusqueda(v); if (!v.trim()) setBusquedaServidor(''); }}
            placeholder={`Buscar ${tipo === 'serial' ? 'equipos' : 'productos'}...`}
          />
        </div>
        {busqueda.trim().length >= 2 && (
          <button
            type="button"
            onClick={handleBuscarServidor}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-xs
              font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors
              whitespace-nowrap flex-shrink-0"
          >
            <Search size={11} />
            {isFetching ? 'Buscando...' : 'Buscar'}
          </button>
        )}
      </div>

      {/* Lista de productos */}
      {isLoading ? (
        <Spinner className="py-8" />
      ) : lista.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">
          {busqueda.trim()
            ? 'Sin resultados — prueba el botón Buscar'
            : tipo === 'serial'
            ? 'No hay equipos disponibles en esta sucursal'
            : 'No hay productos con stock en esta sucursal'}
        </p>
      ) : (
        <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">

          {/* ── Tab SERIAL ── */}
          {tipo === 'serial' && lista.map((producto) => {
            const expandido = productoExpandidoId === producto.id;
            const selCount  = itemsSeleccionados.filter(
              (i) => i.tipo === 'serial' && i.productoOrigenId === producto.id
            ).length;
            return (
              <div
                key={producto.id}
                className={`rounded-xl border overflow-hidden transition-all
                  ${selCount > 0 ? 'border-blue-200 bg-blue-50/10' : 'border-gray-100 bg-white'}`}
              >
                <button
                  onClick={() => setProductoExpandidoId(expandido ? null : producto.id)}
                  className="w-full flex items-center gap-3 px-3.5 py-3 text-left hover:bg-blue-50/30 transition-colors"
                >
                  <div className="w-7 h-7 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Package size={13} className="text-blue-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{producto.nombre}</p>
                    <p className="text-xs text-gray-400">
                      {[producto.marca, producto.modelo].filter(Boolean).join(' ')}
                      {' · '}
                      <span className="font-medium text-blue-600">
                        {producto.disponibles} disponible{Number(producto.disponibles) !== 1 ? 's' : ''}
                      </span>
                      {selCount > 0 && (
                        <span className="text-green-600 font-medium">
                          {' · '}{selCount} seleccionado{selCount !== 1 ? 's' : ''}
                        </span>
                      )}
                    </p>
                  </div>
                  {expandido
                    ? <ChevronUp   size={14} className="text-gray-400 flex-shrink-0" />
                    : <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />}
                </button>

                {expandido && (
                  <div className="border-t border-gray-100 px-3.5 pb-3 pt-2 flex flex-col gap-1.5">
                    {loadingSeriales ? (
                      <div className="flex items-center justify-center py-3 gap-2">
                        <Spinner className="py-0 scale-75" />
                        <span className="text-xs text-gray-400">Cargando seriales...</span>
                      </div>
                    ) : !seriales || seriales.length === 0 ? (
                      <p className="text-xs text-gray-400 py-2 text-center">No hay seriales disponibles</p>
                    ) : seriales.map((serial) => {
                      const key          = `serial-${serial.id}`;
                      const seleccionado = itemsSeleccionados.some((i) => i.key === key);
                      return (
                        <button
                          key={serial.id}
                          onClick={() => onToggleSerial(serial, producto, key)}
                          className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all
                            ${seleccionado
                              ? 'bg-blue-50 border border-blue-200'
                              : 'hover:bg-gray-50 border border-transparent'}`}
                        >
                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all
                            ${seleccionado ? 'bg-blue-500 border-blue-500' : 'border-gray-300'}`}>
                            {seleccionado && (
                              <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                                <path d="M1 3L3.5 5.5L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </div>
                          <span className="font-mono text-xs text-gray-700 flex-1">{serial.imei}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* ── Tab CANTIDAD ── */}
          {tipo === 'cantidad' && lista.map((producto) => {
            const key      = `cantidad-${producto.id}`;
            const selItem  = itemsSeleccionados.find((i) => i.key === key);
            const cantActual = selItem?.cantidad || 0;
            const stockMax   = Number(producto.stock);
            return (
              <div
                key={producto.id}
                className={`flex items-center gap-3 px-3.5 py-3 rounded-xl border transition-all
                  ${cantActual > 0
                    ? 'border-green-200 bg-green-50/20'
                    : 'border-gray-100 bg-white'}`}
              >
                <div className="w-7 h-7 bg-green-50 rounded-lg flex items-center justify-center flex-shrink-0">
                  <ShoppingBag size={13} className="text-green-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{producto.nombre}</p>
                  <p className="text-xs text-gray-400">
                    {producto.linea_nombre && `${producto.linea_nombre} · `}
                    Stock: <span className="font-medium">{stockMax}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => onCambiarCantidad(producto, Math.max(0, cantActual - 1), key)}
                    disabled={cantActual === 0}
                    className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center
                      text-gray-600 hover:bg-gray-100 disabled:opacity-30 transition-all"
                  >
                    <Minus size={12} />
                  </button>
                  <span className={`text-sm font-bold min-w-[20px] text-center
                    ${cantActual > 0 ? 'text-green-700' : 'text-gray-400'}`}>
                    {cantActual}
                  </span>
                  <button
                    onClick={() => onCambiarCantidad(producto, Math.min(stockMax, cantActual + 1), key)}
                    disabled={cantActual >= stockMax}
                    className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center
                      text-gray-600 hover:bg-gray-100 disabled:opacity-30 transition-all"
                  >
                    <Plus size={12} />
                  </button>
                </div>
              </div>
            );
          })}

        </div>
      )}
    </div>
  );
}

// ─── Paso 3: Mapear a mis productos ──────────────────────────────────────────

function PasoMapeoDestino({ itemsSeleccionados, equivalencias, selecciones, onSeleccionar, miSucursalId }) {
  const totalItems  = itemsSeleccionados.length;
  const mapeados    = Object.values(selecciones).filter(Boolean).length;
  const sinOpciones = equivalencias.filter((e) => (e.sugerencias || []).length === 0).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Vincula cada producto con el tuyo</p>
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
            en tu sucursal. Créalo{sinOpciones !== 1 ? 's' : ''} primero o retíra{sinOpciones !== 1 ? 'los' : 'lo'} de la selección.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto">
        {itemsSeleccionados.map((item) => {
          const equiv = equivalencias.find((e) => e.key === item.key);
          return (
            <ItemMapeo
              key={item.key}
              item={item}
              equivalencia={equiv}
              seleccionId={selecciones[item.key] || null}
              onSeleccionar={(id) => onSeleccionar(item.key, id)}
              miSucursalId={miSucursalId}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Modal principal ──────────────────────────────────────────────────────────

export function ModalJalarTraslado({ open, onClose }) {
  const queryClient = useQueryClient();
  const { usuario } = useAuth();
  const sucursalStore = useSucursalStore((s) => s.sucursalActiva);
  const miSucursalId  = sucursalStore || usuario?.sucursal_id || null;

  const [paso, setPaso]                             = useState(1);
  const [sucursalOrigenId, setSucursalOrigenId]     = useState(null);
  const [itemsSeleccionados, setItemsSeleccionados] = useState([]);
  const [equivalencias, setEquivalencias]           = useState([]);
  const [selecciones, setSelecciones]               = useState({});
  const [notas, setNotas]                           = useState('');
  const [error, setError]                           = useState('');

  useEffect(() => {
    if (open) {
      setPaso(1);
      setSucursalOrigenId(null);
      setItemsSeleccionados([]);
      setEquivalencias([]);
      setSelecciones({});
      setNotas('');
      setError('');
    }
  }, [open]);

  const { data: sucursalesRaw } = useQuery({
    queryKey: ['sucursales'],
    queryFn:  () => getSucursales().then((r) => r.data.data),
    enabled:  open,
  });
  const sucursales = sucursalesRaw || [];

  // Buscar equivalentes en MI sucursal para los ítems seleccionados del origen
  const mutBuscar = useMutation({
    mutationFn: () => buscarEquivalentes({
      sucursal_destino_id: miSucursalId,
      items: itemsSeleccionados.map((item) => ({
        key:      item.key,
        tipo:     item.tipo,
        nombre:   item.nombre,
        marca:    item.marca    || null,
        modelo:   item.modelo   || null,
        linea_id: item.linea_id || null,
      })),
    }),
    onSuccess: (res) => {
      const data = res.data.data;
      setEquivalencias(data);
      const autoSel = {};
      data.forEach((eq) => { if (eq.auto_seleccionado) autoSel[eq.key] = eq.auto_seleccionado; });
      setSelecciones(autoSel);
      setPaso(3);
      setError('');
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al buscar equivalentes'),
  });

  // Ejecutar traslado: origen = otra sucursal, destino = la mía
  const mutEjecutar = useMutation({
    mutationFn: () => {
      const lineas = itemsSeleccionados.map((item) => {
        const destinoId = selecciones[item.key];
        if (item.tipo === 'serial') {
          return { tipo: 'serial', serial_id: item.serial_id, producto_destino_id: destinoId };
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
        sucursal_destino_id: miSucursalId,
        notas:               notas || null,
        lineas,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productos-serial'],   exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['traslados'],          exact: false });
      setPaso(4);
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al ejecutar traslado'),
  });

  const handleToggleSerial = (serial, producto, key) => {
    const yaSeleccionado = itemsSeleccionados.some((i) => i.key === key);
    if (yaSeleccionado) {
      setItemsSeleccionados((prev) => prev.filter((i) => i.key !== key));
    } else {
      setItemsSeleccionados((prev) => [...prev, {
        key,
        tipo:            'serial',
        serial_id:       serial.id,
        productoOrigenId: producto.id,
        nombre:          producto.nombre,
        marca:           producto.marca   || null,
        modelo:          producto.modelo  || null,
        linea_id:        producto.linea_id || null,
        imei:            serial.imei,
      }]);
    }
  };

  const handleCambiarCantidad = (producto, cantidad, key) => {
    if (cantidad === 0) {
      setItemsSeleccionados((prev) => prev.filter((i) => i.key !== key));
    } else {
      setItemsSeleccionados((prev) => {
        const sin = prev.filter((i) => i.key !== key);
        return [...sin, {
          key,
          tipo:       'cantidad',
          producto_id: producto.id,
          nombre:     producto.nombre,
          linea_id:   producto.linea_id || null,
          cantidad,
        }];
      });
    }
  };

  const handleContinuarSeleccion = () => {
    if (itemsSeleccionados.length === 0) {
      return setError('Selecciona al menos un producto para traer');
    }
    setError('');
    mutBuscar.mutate();
  };

  const handleConfirmar = () => {
    setError('');
    const sinMapear = itemsSeleccionados.filter((item) => !selecciones[item.key]);
    if (sinMapear.length > 0) {
      return setError(`Faltan ${sinMapear.length} producto(s) por vincular`);
    }
    mutEjecutar.mutate();
  };

  const miSucursalNombre  = sucursales.find((s) => s.id === miSucursalId)?.nombre  || '';
  const origenNombre      = sucursales.find((s) => s.id === sucursalOrigenId)?.nombre || '';
  const todosMapeados     = itemsSeleccionados.length > 0 && itemsSeleccionados.every((item) => selecciones[item.key]);

  // ── Paso 4: éxito ─────────────────────────────────────────────────────────
  if (paso === 4) {
    return (
      <Modal open={open} onClose={onClose} title="Traslado completado" size="sm">
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center">
            <CheckCircle size={28} className="text-green-600" />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-gray-900">Productos recibidos</p>
            <p className="text-sm text-gray-500 mt-1">
              {itemsSeleccionados.length} producto{itemsSeleccionados.length !== 1 ? 's' : ''} traído{itemsSeleccionados.length !== 1 ? 's' : ''} desde{' '}
              <span className="font-medium">{origenNombre}</span>{' '}a{' '}
              <span className="font-medium">{miSucursalNombre}</span>
            </p>
          </div>
          <Button className="w-full" onClick={onClose}>Cerrar</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Traer de otra sucursal" size="md">
      <div className="flex flex-col gap-4">

        {/* Header visual: origen → mi sucursal */}
        <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3">
          <div className="flex-1 text-center">
            <p className="text-xs text-gray-400">Origen</p>
            <p className={`text-sm font-semibold ${sucursalOrigenId ? 'text-blue-700' : 'text-gray-300'}`}>
              {origenNombre || 'Seleccionar...'}
            </p>
          </div>
          <ArrowRightLeft size={18} className="text-gray-400 flex-shrink-0" />
          <div className="flex-1 text-center">
            <p className="text-xs text-gray-400">Destino (tú)</p>
            <p className="text-sm font-semibold text-gray-800">{miSucursalNombre}</p>
          </div>
        </div>

        {/* ── Paso 1: Seleccionar sucursal ── */}
        {paso === 1 && (
          <PasoSucursalOrigen
            sucursales={sucursales}
            miSucursalId={miSucursalId}
            seleccionadoId={sucursalOrigenId}
            onSeleccionar={(id) => { setSucursalOrigenId(id); setPaso(2); setError(''); }}
          />
        )}

        {/* ── Paso 2: Seleccionar productos ── */}
        {paso === 2 && (
          <>
            <PasoSeleccionProductos
              sucursalOrigenId={sucursalOrigenId}
              itemsSeleccionados={itemsSeleccionados}
              onToggleSerial={handleToggleSerial}
              onCambiarCantidad={handleCambiarCantidad}
            />

            {/* Resumen de selección */}
            {itemsSeleccionados.length > 0 && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 flex items-center gap-2">
                <CheckCircle size={14} className="text-blue-500 flex-shrink-0" />
                <p className="text-sm text-blue-700 flex-1">
                  <span className="font-semibold">{itemsSeleccionados.length} item{itemsSeleccionados.length !== 1 ? 's' : ''}</span>
                  {' '}seleccionado{itemsSeleccionados.length !== 1 ? 's' : ''}
                </p>
                <button
                  type="button"
                  onClick={() => setItemsSeleccionados([])}
                  className="text-xs text-blue-400 hover:text-blue-600 transition-colors"
                >
                  Limpiar
                </button>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => { setPaso(1); setSucursalOrigenId(null); setItemsSeleccionados([]); setError(''); }}
              >
                Cambiar sucursal
              </Button>
              <Button
                className="flex-1"
                loading={mutBuscar.isPending}
                onClick={handleContinuarSeleccion}
                disabled={itemsSeleccionados.length === 0}
              >
                <ArrowRightLeft size={14} />
                Continuar{itemsSeleccionados.length > 0 ? ` (${itemsSeleccionados.length})` : ''}
              </Button>
            </div>
          </>
        )}

        {/* ── Paso 3: Mapear a mis productos ── */}
        {paso === 3 && (
          <>
            <PasoMapeoDestino
              itemsSeleccionados={itemsSeleccionados}
              equivalencias={equivalencias}
              selecciones={selecciones}
              onSeleccionar={(key, id) => setSelecciones((prev) => ({ ...prev, [key]: id }))}
              miSucursalId={miSucursalId}
            />

            <input
              type="text"
              placeholder="Notas del traslado (opcional)"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all"
            />

            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => { setPaso(2); setEquivalencias([]); setSelecciones({}); setError(''); }}
              >
                Volver
              </Button>
              <Button
                className="flex-1"
                loading={mutEjecutar.isPending}
                onClick={handleConfirmar}
                disabled={!todosMapeados}
              >
                <ArrowRightLeft size={14} />
                Traer {itemsSeleccionados.length} producto{itemsSeleccionados.length !== 1 ? 's' : ''}
              </Button>
            </div>
          </>
        )}

      </div>
    </Modal>
  );
}
