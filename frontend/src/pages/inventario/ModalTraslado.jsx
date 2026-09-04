import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { buscarEquivalentes, ejecutarTraslado, buscarProductosEnSucursal } from '../../api/traslados.api';
import { getSucursales } from '../../api/sucursales.api';
import { Modal }         from '../../components/ui/Modal';
import { Button }        from '../../components/ui/Button';
import { Spinner }       from '../../components/ui/Spinner';
import { SearchInput }   from '../../components/ui/SearchInput';
import useCarritoStore   from '../../store/carritoStore';
import useSucursalStore  from '../../store/sucursalStore';
import { useAuth }       from '../../context/useAuth';
import {
  ArrowRightLeft, ChevronRight, ChevronLeft, CheckCircle, AlertTriangle,
  Package, ShoppingBag, Search, X,
} from 'lucide-react';

// ─── Utilidades de normalización (espejo del backend) ─────────────────────────
const _norm = (s) =>
  (s || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ');

const _tokens = (s) => _norm(s).split(/\s+/).filter((t) => t.length >= 2);

/** Devuelve true si `nombre` coincide con `query` usando tokens y subcadenas */
const _matches = (nombre, query) => {
  if (!query.trim()) return true;
  const q = _norm(query);
  const n = _norm(nombre);
  if (n.includes(q) || q.includes(n)) return true;
  const qt = _tokens(query);
  const nt = _tokens(nombre);
  return qt.length > 0 && qt.some((t) => nt.some((nt2) => nt2.startsWith(t) || t.startsWith(nt2)));
};

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
function SelectorDestino({ equivalencia, seleccionId, onSeleccionar, sucursalDestinoId }) {
  const [busqueda, setBusqueda]               = useState('');
  const [resultadosManuales, setResultadosManuales] = useState(null); // null = mostrando sugerencias
  const [buscandoManual, setBuscandoManual]   = useState(false);
  const [errorManual, setErrorManual]         = useState('');

  const sugerencias   = equivalencia.sugerencias || [];
  const filtradas     = sugerencias.filter((s) => _matches(s.nombre, busqueda));
  const listaVisible  = resultadosManuales !== null ? resultadosManuales : filtradas;

  const handleChangeBusqueda = (v) => {
    setBusqueda(v);
    setErrorManual('');
    if (!v.trim()) setResultadosManuales(null);
  };

  const handleBuscarEnDestino = async () => {
    if (!busqueda.trim() || busqueda.trim().length < 2) return;
    setBuscandoManual(true);
    setErrorManual('');
    try {
      const res = await buscarProductosEnSucursal(sucursalDestinoId, equivalencia.tipo, busqueda.trim());
      setResultadosManuales(res.data.data || []);
    } catch {
      setErrorManual('Error al buscar. Intenta de nuevo.');
      setResultadosManuales([]);
    } finally {
      setBuscandoManual(false);
    }
  };

  const handleVolverSugerencias = () => {
    setResultadosManuales(null);
    setBusqueda('');
    setErrorManual('');
  };

  const msgVacio = resultadosManuales !== null
    ? 'No se encontraron productos con ese término en la sucursal destino'
    : busqueda.trim()
    ? 'Sin coincidencias — prueba el botón "Buscar" para ampliar la búsqueda'
    : 'No hay productos disponibles en la sucursal destino';

  return (
    <div className="flex flex-col gap-2">
      {/* Barra de búsqueda + botón buscar en backend */}
      <div className="flex gap-2 items-center">
        <div className="flex-1">
          <SearchInput
            value={busqueda}
            onChange={handleChangeBusqueda}
            placeholder="Buscar en sucursal destino..."
          />
        </div>
        {busqueda.trim().length >= 2 && (
          <button
            type="button"
            onClick={handleBuscarEnDestino}
            disabled={buscandoManual}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-xs
              font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors
              whitespace-nowrap flex-shrink-0"
          >
            <Search size={11} />
            {buscandoManual ? 'Buscando...' : 'Buscar'}
          </button>
        )}
      </div>

      {/* Banner de resultados manuales */}
      {resultadosManuales !== null && (
        <div className="flex items-center justify-between text-xs px-0.5">
          <span className={resultadosManuales.length === 0 ? 'text-red-500' : 'text-blue-600'}>
            {errorManual || (resultadosManuales.length === 0
              ? 'Sin resultados para esa búsqueda'
              : `${resultadosManuales.length} resultado${resultadosManuales.length !== 1 ? 's' : ''} encontrado${resultadosManuales.length !== 1 ? 's' : ''}`)}
          </span>
          <button
            type="button"
            onClick={handleVolverSugerencias}
            className="text-gray-400 underline hover:text-gray-600"
          >
            Ver sugerencias
          </button>
        </div>
      )}

      {/* Lista de productos */}
      <div className="flex flex-col gap-1 max-h-[46vh] sm:max-h-80 overflow-y-auto">
        {listaVisible.length === 0 ? (
          <p className="text-xs text-gray-400 px-2 py-3 text-center">{msgVacio}</p>
        ) : (
          listaVisible.map((prod) => {
            const esSel = seleccionId === prod.id;
            return (
              <button key={prod.id} onClick={() => onSeleccionar(prod.id, prod.nombre)}
                className={`flex items-center justify-between gap-2 p-2.5 rounded-xl text-left text-sm border transition-all
                  ${esSel
                    ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-200'
                    : 'bg-white border-gray-100 hover:border-blue-200 hover:bg-blue-50/30'}`}>
                <div className="flex-1 min-w-0">
                  <p className={`font-medium line-clamp-2 leading-snug ${esSel ? 'text-blue-800' : 'text-gray-800'}`}>
                    {prod.nombre}
                  </p>
                  <p className="text-xs text-gray-400 line-clamp-2 leading-snug">
                    {[prod.marca, prod.modelo, prod.linea_nombre].filter(Boolean).join(' · ')}
                    {prod.stock != null && ` · Stock: ${prod.stock}`}
                    {prod.disponibles != null && ` · ${prod.disponibles} disp.`}
                  </p>
                </div>
                {esSel && <CheckCircle size={16} className="text-blue-600 flex-shrink-0" />}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Vista de elección de destino ────────────────────────────────────────────
// Elegir el destino DENTRO de la tarjeta metía un buscador y una lista con
// scroll dentro de otra lista con scroll: en un celular no cabía nada. Aquí la
// elección se lleva el modal entero — y por eso la lista de atrás puede
// quedarse siempre desplegada, sin esconder productos para hacer sitio.
function VistaSelectorDestino({
  item, equivalencia, seleccionId, sucursalDestinoId, onSeleccionar, onVolver, posicion, total,
}) {
  const TipoIcon = item.tipo === 'serial' ? Package : ShoppingBag;

  return (
    <div className="flex flex-col gap-3">
      <button onClick={onVolver}
        className="flex items-center gap-1 self-start text-sm font-medium text-blue-600 hover:text-blue-700">
        <ChevronLeft size={16} /> Volver a la lista
      </button>

      {/* Qué se está vinculando — a la vista todo el tiempo */}
      <div className="flex items-start gap-2.5 bg-gray-50 rounded-xl px-3 py-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
          ${item.tipo === 'serial' ? 'bg-blue-100' : 'bg-green-100'}`}>
          <TipoIcon size={14} className={item.tipo === 'serial' ? 'text-blue-600' : 'text-green-600'} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-400">Producto {posicion} de {total}</p>
          <p className="text-sm font-semibold text-gray-900 leading-snug break-words">{item.nombre}</p>
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            {item.imei && <span className="text-xs text-gray-500 font-mono">{item.imei}</span>}
            {item.tipo === 'cantidad' && <span className="text-xs text-gray-500">×{item.cantidad || 1} und</span>}
            <BadgeNivel nivel={equivalencia.nivel} />
          </div>
        </div>
      </div>

      <p className="text-xs font-medium text-gray-500">
        ¿Con cuál producto de la sucursal destino se vincula?
      </p>

      <SelectorDestino
        equivalencia={equivalencia}
        seleccionId={seleccionId}
        onSeleccionar={onSeleccionar}
        sucursalDestinoId={sucursalDestinoId}
      />
    </div>
  );
}

// ─── Fila de un item a trasladar ─────────────────────────────────────────────
// Nunca se colapsa ni se corta: el nombre completo, el IMEI o la cantidad, el
// nivel de coincidencia y a qué producto quedó vinculada. Con veinte productos
// en el carrito, lo que hace falta es poder LEER la lista de un tirón.
function FilaItem({ item, equivalencia, seleccionId, nombreDestino, onAbrir, onEliminar }) {
  const TipoIcon    = item.tipo === 'serial' ? Package : ShoppingBag;
  const sinOpciones = !equivalencia || (equivalencia.sugerencias || []).length === 0;

  return (
    <div className={`rounded-2xl border
      ${sinOpciones
        ? 'border-red-200 bg-red-50/30'
        : seleccionId
        ? 'border-green-200 bg-green-50/20'
        : 'border-amber-200 bg-amber-50/20'}`}>

      <div className="flex items-start gap-2.5 px-3 pt-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
          ${item.tipo === 'serial' ? 'bg-blue-100' : 'bg-green-100'}`}>
          <TipoIcon size={14} className={item.tipo === 'serial' ? 'text-blue-600' : 'text-green-600'} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 leading-snug break-words">{item.nombre}</p>
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            {item.imei && <span className="text-xs text-gray-500 font-mono">{item.imei}</span>}
            {item.tipo === 'cantidad' && <span className="text-xs text-gray-500">×{item.cantidad || 1} und</span>}
            {equivalencia && <BadgeNivel nivel={equivalencia.nivel} />}
          </div>
        </div>
        <button
          onClick={() => onEliminar(item.key)}
          title="Quitar del traslado"
          className="-mr-1 -mt-1 p-2 text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
        >
          <X size={14} />
        </button>
      </div>

      {/* En qué quedó — la fila siempre lo dice, vinculada o no */}
      <div className="px-3 pb-3 pt-2">
        {sinOpciones ? (
          <p className="flex items-start gap-1.5 text-xs text-red-600">
            <AlertTriangle size={13} className="flex-shrink-0 mt-px" />
            Sin equivalente en la sucursal destino. Créalo allá o quítalo del carrito.
          </p>
        ) : seleccionId ? (
          <button onClick={() => onAbrir(item.key)}
            className="w-full flex items-center gap-2 bg-white border border-green-200 rounded-xl
              px-3 py-2 text-left hover:border-green-300 transition-colors">
            <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
            <span className="flex-1 min-w-0 text-xs text-gray-700 leading-snug break-words">
              {nombreDestino || 'Producto destino vinculado'}
            </span>
            <span className="text-xs font-medium text-blue-600 flex-shrink-0">Cambiar</span>
          </button>
        ) : (
          <button onClick={() => onAbrir(item.key)}
            className="w-full flex items-center justify-center gap-1.5 bg-blue-600 text-white
              text-xs font-medium rounded-xl px-3 py-2.5 hover:bg-blue-700 transition-colors">
            <Search size={13} /> Elegir producto destino
            <ChevronRight size={13} />
          </button>
        )}
      </div>
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

// ─── Paso 2: Mapear productos ────────────────────────────────────────────────
function PasoMapeo({
  items, equivalencias, selecciones, nombresDestino, onAbrir, onEliminar,
  soloPendientes, setSoloPendientes,
}) {
  const totalItems  = items.length;
  const mapeados    = Object.values(selecciones).filter(Boolean).length;
  const sinOpciones = equivalencias.filter((e) => (e.sugerencias || []).length === 0).length;

  const pendientes = items.filter((i) => !selecciones[i.key]);
  const visibles   = soloPendientes ? pendientes : items;

  const chip = (activo) =>
    `flex-1 text-xs font-medium py-1.5 rounded-lg transition-colors
     ${activo ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-gray-500">Vincula cada producto con su destino</p>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0
          ${mapeados === totalItems ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
          {mapeados}/{totalItems}
        </span>
      </div>

      {totalItems > 4 && (
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          <button type="button" onClick={() => setSoloPendientes(false)} className={chip(!soloPendientes)}>
            Todos ({totalItems})
          </button>
          <button type="button" onClick={() => setSoloPendientes(true)} className={chip(soloPendientes)}>
            Faltan ({pendientes.length})
          </button>
        </div>
      )}

      {sinOpciones > 0 && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
          <p className="text-xs text-red-600">
            {sinOpciones} producto{sinOpciones !== 1 ? 's' : ''} no tiene{sinOpciones === 1 ? '' : 'n'} equivalente
            en la sucursal destino. Créalo{sinOpciones !== 1 ? 's' : ''} primero o retíra{sinOpciones !== 1 ? 'los' : 'lo'} del carrito.
          </p>
        </div>
      )}

      {visibles.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6">
          <CheckCircle size={22} className="text-green-500" />
          <p className="text-sm text-gray-500">Todos los productos quedaron vinculados</p>
          <button type="button" onClick={() => setSoloPendientes(false)}
            className="text-xs font-medium text-blue-600 underline">
            Ver los {totalItems} productos
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 max-h-[58vh] sm:max-h-[50vh] overflow-y-auto">
          {visibles.map((item) => (
            <FilaItem
              key={item.key}
              item={item}
              equivalencia={equivalencias.find((e) => e.key === item.key)}
              seleccionId={selecciones[item.key] || null}
              nombreDestino={nombresDestino[item.key] || null}
              onAbrir={onAbrir}
              onEliminar={onEliminar}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Modal principal ──────────────────────────────────────────────────────────
export function ModalTraslado({ open, onClose }) {
  const queryClient = useQueryClient();
  const { items, limpiarCarrito, eliminarItem } = useCarritoStore();
  const { usuario } = useAuth();
  const sucursalStore = useSucursalStore((s) => s.sucursalActiva);

  // Admin usa el store, supervisor usa su sucursal del token
  const sucursalOrigenId = sucursalStore || usuario?.sucursal_id || null;

  const [paso, setPaso]                         = useState(1);
  const [sucursalDestinoId, setSucursalDestinoId] = useState(null);
  const [equivalencias, setEquivalencias]       = useState([]);
  const [selecciones, setSelecciones]           = useState({});
  // El nombre del destino se guarda al elegirlo: el que sale de una búsqueda
  // manual no está en las sugerencias, y la fila tiene que poder mostrarlo.
  const [nombresDestino, setNombresDestino]     = useState({});
  const [itemEditando, setItemEditando]         = useState(null);
  // Con veinte productos, la mayoría entra vinculada sola por coincidencia
  // exacta: poder dejar en pantalla únicamente los que faltan es la diferencia
  // entre atender cuatro y revisar veinte. Vive aquí y no en la lista porque la
  // lista se desmonta al abrir la vista de elección — dentro, el filtro se
  // perdería en cada producto vinculado.
  const [soloPendientes, setSoloPendientes]     = useState(false);
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
      const autoNom = {};
      data.forEach((eq) => {
        if (!eq.auto_seleccionado) return;
        autoSel[eq.key] = eq.auto_seleccionado;
        autoNom[eq.key] = (eq.sugerencias || []).find((sg) => sg.id === eq.auto_seleccionado)?.nombre || null;
      });
      setSelecciones(autoSel);
      setNombresDestino(autoNom);
      setItemEditando(null);
      setSoloPendientes(false);
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

  const handleEliminarItem = (key) => {
    const restantes = items.filter((i) => i.key !== key);
    eliminarItem(key);
    setSelecciones((prev) => { const next = { ...prev }; delete next[key]; return next; });
    setNombresDestino((prev) => { const next = { ...prev }; delete next[key]; return next; });
    if (itemEditando === key) setItemEditando(null);
    if (restantes.length === 0) {
      setPaso(1);
      setSucursalDestinoId(null);
      setEquivalencias([]);
    }
  };

  const handleSeleccionarSucursal = (id) => {
    setSucursalDestinoId(id);
    setError('');
    mutBuscar.mutate(id);
  };

  const handleSeleccionarDestino = (key, productoDestinoId, nombre) => {
    setSelecciones((prev) => ({ ...prev, [key]: productoDestinoId }));
    setNombresDestino((prev) => ({ ...prev, [key]: nombre || null }));
    setItemEditando(null);   // vuelve solo a la lista, con la fila ya en verde
  };

  const handleConfirmar = () => {
    setError('');
    const sinMapear = items.filter((item) => !selecciones[item.key]);
    if (sinMapear.length > 0) {
      return setError(`Faltan ${sinMapear.length} producto(s) por vincular`);
    }
    mutEjecutar.mutate();
  };

  // Elegir destino es una vista aparte dentro del mismo modal, no un desplegable
  // dentro de la fila: así la búsqueda tiene la pantalla entera y la lista de
  // productos nunca tiene que esconder nada para hacerle sitio.
  const itemEditandoObj  = itemEditando ? items.find((i) => i.key === itemEditando) : null;
  const equivEditando    = itemEditando ? equivalencias.find((e) => e.key === itemEditando) : null;
  const editandoDestino  = Boolean(itemEditandoObj && equivEditando);

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
        <div className="flex items-center gap-2 sm:gap-3 bg-gray-50 rounded-xl px-3 sm:px-4 py-3">
          <div className="flex-1 min-w-0 text-center">
            <p className="text-xs text-gray-400">Origen</p>
            <p className="text-sm font-semibold text-gray-800 truncate">{sucursalOrigenNombre}</p>
          </div>
          <ArrowRightLeft size={18} className="text-gray-400 flex-shrink-0" />
          <div className="flex-1 min-w-0 text-center">
            <p className="text-xs text-gray-400">Destino</p>
            <p className={`text-sm font-semibold truncate ${sucursalDestinoId ? 'text-blue-700' : 'text-gray-300'}`}>
              {sucursalDestinoNombre || 'Seleccionar...'}
            </p>
          </div>
        </div>

        {/* Resumen de items */}
        {!editandoDestino && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Package size={12} />
            <span>{items.length} producto{items.length !== 1 ? 's' : ''} en el carrito</span>
          </div>
        )}

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

        {/* Paso 2a: elegir el destino de UN producto, con el modal entero */}
        {paso === 2 && editandoDestino && (
          <VistaSelectorDestino
            item={itemEditandoObj}
            equivalencia={equivEditando}
            seleccionId={selecciones[itemEditando] || null}
            sucursalDestinoId={sucursalDestinoId}
            posicion={items.findIndex((i) => i.key === itemEditando) + 1}
            total={items.length}
            onVolver={() => setItemEditando(null)}
            onSeleccionar={(id, nombre) => handleSeleccionarDestino(itemEditando, id, nombre)}
          />
        )}

        {/* Paso 2: Mapear productos */}
        {paso === 2 && !editandoDestino && (
          <>
            <PasoMapeo
              items={items}
              equivalencias={equivalencias}
              selecciones={selecciones}
              nombresDestino={nombresDestino}
              onAbrir={setItemEditando}
              onEliminar={handleEliminarItem}
              soloPendientes={soloPendientes}
              setSoloPendientes={setSoloPendientes}
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

            <div className="flex flex-col-reverse sm:flex-row gap-2">
              <Button variant="secondary" className="sm:flex-1"
                onClick={() => {
                  setPaso(1); setSucursalDestinoId(null); setEquivalencias([]);
                  setSelecciones({}); setNombresDestino({}); setItemEditando(null); setError('');
                }}>
                Cambiar sucursal
              </Button>
              <Button className="sm:flex-1" loading={mutEjecutar.isPending}
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