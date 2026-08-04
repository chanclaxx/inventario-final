import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Globe, Package, ShoppingBag, Copy, Check, ExternalLink, Eye, EyeOff,
  ImageOff, Image as ImageIcon, Star, Settings, AlertCircle, CheckSquare, Square,
  RefreshCw,
} from 'lucide-react';
import { getVitrina, getItemsCatalogo, publicarMasivo, refrescarCatalogo } from '../../api/catalogo.api';
import { SearchInput }  from '../../components/ui/SearchInput';
import { Button }       from '../../components/ui/Button';
import { Spinner }      from '../../components/ui/Spinner';
import { EmptyState }   from '../../components/ui/EmptyState';
import { formatCOP }    from '../../utils/formatters';
import { useSucursalKey } from '../../hooks/useSucursalKey';
import { useAuth }        from '../../context/useAuth';
import { ModalFichaCatalogo } from './ModalFichaCatalogo';

// ─────────────────────────────────────────────────────────────────────────────
// Pestaña "Catálogo" del inventario.
//
// Muestra TODO el inventario de la sucursal con un interruptor por producto.
// Nada está publicado por defecto: el admin decide uno por uno, o en bloque.
//
// Esta pantalla no modifica el inventario. Lo único que escribe son las fichas
// de `catalogo_items`.
// ─────────────────────────────────────────────────────────────────────────────

// La URL pública se arma con VITE_CATALOGO_URL. Sin esa variable no se puede
// adivinar el dominio, así que se muestra solo el slug y se avisa en Ajustes.
const BASE_CATALOGO = import.meta.env.VITE_CATALOGO_URL || '';

const SUBTABS = [
  { id: 'serial',   label: 'Con Serial',   Icn: Package     },
  { id: 'cantidad', label: 'Por Cantidad', Icn: ShoppingBag },
];

const FILTROS = [
  { id: 'todos',        label: 'Todos'         },
  { id: 'publicados',   label: 'Publicados'    },
  { id: 'sin-publicar', label: 'Sin publicar'  },
  { id: 'sin-foto',     label: 'Sin foto'      },
];

const normalizar = (texto) =>
  String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ── Enlace público, listo para pegar en WhatsApp ────────────────────────────
function EnlacePublico({ vitrina, refrescoActivo }) {
  const [copiado, setCopiado] = useState(false);

  // El catálogo público cachea su HTML: los cambios hechos desde aquí lo
  // refrescan solos, pero un precio editado en Inventario no. Este botón lo
  // fuerza sin esperar los 30 minutos del refresco automático.
  const refrescar = useMutation({ mutationFn: refrescarCatalogo });

  if (!vitrina) return null;

  const url = BASE_CATALOGO
    ? `${BASE_CATALOGO.replace(/\/+$/, '')}/${vitrina.slug}`
    : null;

  const copiar = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin permiso de portapapeles (http, navegador viejo): el enlace igual se
      // ve completo en pantalla y se puede seleccionar a mano.
      setCopiado(false);
    }
  };

  return (
    <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm
      ${vitrina.activo ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
      <Globe size={15} className={vitrina.activo ? 'text-green-600' : 'text-amber-600'} />

      <div className="flex-1 min-w-0">
        {vitrina.activo ? (
          <p className="font-mono text-xs text-gray-700 truncate">
            {url || `/${vitrina.slug}`}
          </p>
        ) : (
          <p className="text-xs text-amber-700">
            La vitrina está apagada. Actívala en Ajustes → Catálogo web.
          </p>
        )}
      </div>

      {vitrina.activo && (
        <div className="flex items-center gap-1 flex-shrink-0">
          {refrescoActivo && (
            <button
              onClick={() => refrescar.mutate()}
              disabled={refrescar.isPending}
              title={refrescar.isSuccess
                ? 'Catálogo actualizado'
                : 'Actualizar ahora el catálogo público'}
              className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600
                hover:bg-white transition-colors disabled:opacity-50"
            >
              {refrescar.isSuccess
                ? <Check size={14} className="text-green-600" />
                : <RefreshCw size={14} className={refrescar.isPending ? 'animate-spin' : ''} />}
            </button>
          )}
          {url && (
            <>
              <button onClick={copiar} title="Copiar enlace"
                className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-white transition-colors">
                {copiado ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
              </button>
              <a href={url} target="_blank" rel="noopener noreferrer" title="Abrir catálogo"
                className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-white transition-colors">
                <ExternalLink size={14} />
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tarjeta de producto ─────────────────────────────────────────────────────
function TarjetaCatalogo({ p, seleccionado, onSeleccionar, onAbrir }) {
  const precio = p.precio_publico ?? p.precio;

  return (
    <div
      onClick={() => onAbrir(p)}
      className={`border rounded-2xl p-3.5 flex flex-col gap-2.5 cursor-pointer
        transition-colors select-none
        ${p.publicado
          ? 'bg-white border-green-200 hover:border-green-300'
          : 'bg-gray-50 border-gray-200 hover:border-gray-300'}`}
    >
      <div className="flex items-start gap-2.5">
        <button
          onClick={(e) => { e.stopPropagation(); onSeleccionar(p.producto_id); }}
          className="flex-shrink-0 mt-0.5 text-gray-300 hover:text-blue-600 transition-colors"
          title="Seleccionar"
        >
          {seleccionado
            ? <CheckSquare size={17} className="text-blue-600" />
            : <Square size={17} />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className={`font-medium text-sm break-words leading-snug
              ${p.publicado ? 'text-gray-900' : 'text-gray-500'}`}>
              {p.titulo || p.nombre}
            </p>
            {p.destacado && <Star size={12} className="flex-shrink-0 text-amber-400" fill="currentColor" />}
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[11px] text-gray-400">
            {p.linea  && <span>{p.linea}</span>}
            {(p.marca || p.marca_inventario) && <span>· {p.marca || p.marca_inventario}</span>}
            {p.modelo && <span>· {p.modelo}</span>}
          </div>
        </div>

        <div className="flex-shrink-0">
          {p.publicado
            ? <Eye    size={15} className="text-green-600" />
            : <EyeOff size={15} className="text-gray-300"  />}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px]">
          <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md
            ${p.imagenes > 0 ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
            {p.imagenes > 0
              ? <><ImageIcon size={10} /> {p.imagenes}</>
              : <><ImageOff size={10} /> sin foto</>}
          </span>
          <span className={p.disponible ? 'text-gray-400' : 'text-red-400'}>
            {p.disponible ? `${p.stock} disp.` : 'agotado'}
          </span>
        </div>

        <span className={`text-sm font-semibold tabular-nums
          ${precio != null ? 'text-gray-900' : 'text-gray-300'}`}>
          {precio != null ? formatCOP(Number(precio)) : 'Sin precio'}
        </span>
      </div>
    </div>
  );
}

export function TabCatalogo() {
  const queryClient = useQueryClient();
  const { esAdminNegocio } = useAuth();
  const { sucursalKey, sucursalLista } = useSucursalKey();

  const [subtab,      setSubtab]      = useState('serial');
  const [busqueda,    setBusqueda]    = useState('');
  const [filtro,      setFiltro]      = useState('todos');
  const [linea,       setLinea]       = useState('');
  const [seleccion,   setSeleccion]   = useState(() => new Set());
  const [fichaAbierta, setFichaAbierta] = useState(null);

  const { data: vitrinaRes } = useQuery({
    queryKey: ['catalogo-vitrina', ...sucursalKey],
    queryFn:  () => getVitrina().then((r) => r.data),
    enabled:  sucursalLista,
    retry:    false,
  });

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['catalogo-items', subtab, ...sucursalKey],
    queryFn:  () => getItemsCatalogo(subtab).then((r) => r.data.data),
    enabled:  sucursalLista,
  });

  const publicar = useMutation({
    mutationFn: ({ ids, publicado }) => publicarMasivo(subtab, ids, publicado),
    onSuccess: () => {
      setSeleccion(new Set());
      queryClient.invalidateQueries({ queryKey: ['catalogo-items'], exact: false });
    },
  });

  const lineas = useMemo(
    () => [...new Set(items.map((i) => i.linea).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')),
    [items]
  );

  const visibles = useMemo(() => {
    const q = normalizar(busqueda);
    return items.filter((p) => {
      if (linea && p.linea !== linea) return false;
      if (filtro === 'publicados'   && !p.publicado) return false;
      if (filtro === 'sin-publicar' &&  p.publicado) return false;
      if (filtro === 'sin-foto'     &&  p.imagenes > 0) return false;
      if (!q) return true;
      return normalizar(`${p.nombre} ${p.titulo || ''} ${p.marca || p.marca_inventario || ''} ${p.modelo || ''}`)
        .includes(q);
    });
  }, [items, busqueda, filtro, linea]);

  const publicados = items.filter((p) => p.publicado).length;

  const alternarSeleccion = (id) => {
    setSeleccion((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(id)) siguiente.delete(id); else siguiente.add(id);
      return siguiente;
    });
  };

  const seleccionarVisibles = () => {
    const todos = visibles.every((p) => seleccion.has(p.producto_id));
    setSeleccion(todos ? new Set() : new Set(visibles.map((p) => p.producto_id)));
  };

  if (!sucursalLista) {
    return <EmptyState icon={Globe} titulo="Selecciona una sucursal"
      descripcion="Cada sucursal tiene su propio catálogo web." />;
  }

  // Sin vitrina creada: el catálogo no existe todavía para esta sucursal.
  if (vitrinaRes && !vitrinaRes.data) {
    return (
      <EmptyState
        icon={Globe}
        titulo="Esta sucursal aún no tiene catálogo web"
        descripcion={esAdminNegocio()
          ? 'Créalo en Ajustes → Catálogo web: eliges la dirección y ya puedes empezar a publicar productos.'
          : 'Pídele al administrador del negocio que lo active en Ajustes.'}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">

      <EnlacePublico
        vitrina={vitrinaRes?.data}
        refrescoActivo={vitrinaRes?.refresco_activo === true}
      />

      {vitrinaRes && vitrinaRes.imagenes_activas === false && (
        <p className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50
          border border-amber-200 rounded-xl px-3 py-2.5">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          El almacenamiento de imágenes no está configurado en el servidor: puedes
          publicar productos, pero todavía no subir fotos.
        </p>
      )}

      {/* ── Sub-tabs por tipo de producto ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
          {SUBTABS.map((t) => (
            <button
              key={t.id}
              onClick={() => { setSubtab(t.id); setSeleccion(new Set()); setLinea(''); }}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium
                transition-all duration-150
                ${subtab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <t.Icn size={15} />
              {t.label}
            </button>
          ))}
        </div>

        <p className="text-xs text-gray-400">
          <span className="font-semibold text-gray-600">{publicados}</span> de {items.length} publicados
        </p>
      </div>

      {/* ── Filtros ── */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <SearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar producto…" />
        </div>

        <select
          value={linea}
          onChange={(e) => setLinea(e.target.value)}
          className="px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm text-gray-700
            focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Todas las líneas</option>
          {lineas.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-0.5">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFiltro(f.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors
              ${filtro === f.id ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Barra de acciones masivas ── */}
      {visibles.length > 0 && (
        <div className="flex items-center justify-between gap-2 flex-wrap px-1">
          <button
            onClick={seleccionarVisibles}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-blue-600"
          >
            <CheckSquare size={14} />
            {visibles.every((p) => seleccion.has(p.producto_id))
              ? 'Quitar selección'
              : `Seleccionar los ${visibles.length} visibles`}
          </button>

          {seleccion.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">{seleccion.size} seleccionado{seleccion.size === 1 ? '' : 's'}</span>
              <Button size="sm" variant="secondary" loading={publicar.isPending}
                onClick={() => publicar.mutate({ ids: [...seleccion], publicado: false })}>
                <EyeOff size={14} /> Ocultar
              </Button>
              <Button size="sm" loading={publicar.isPending}
                onClick={() => publicar.mutate({ ids: [...seleccion], publicado: true })}>
                <Eye size={14} /> Publicar
              </Button>
            </div>
          )}
        </div>
      )}

      {publicar.isError && (
        <p className="flex items-start gap-2 text-xs text-red-600 bg-red-50
          border border-red-200 rounded-xl px-3 py-2.5">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          {publicar.error?.response?.data?.error || 'No se pudo actualizar la publicación'}
        </p>
      )}

      {/* ── Grid ── */}
      {isLoading ? (
        <Spinner className="py-20" />
      ) : visibles.length === 0 ? (
        <EmptyState
          icon={Settings}
          titulo="Sin productos que mostrar"
          descripcion={items.length === 0
            ? 'Esta sucursal no tiene productos de este tipo en el inventario.'
            : 'Ningún producto coincide con el filtro.'}
        />
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {visibles.map((p) => (
            <TarjetaCatalogo
              key={`${p.tipo}-${p.producto_id}`}
              p={p}
              seleccionado={seleccion.has(p.producto_id)}
              onSeleccionar={alternarSeleccion}
              onAbrir={setFichaAbierta}
            />
          ))}
        </div>
      )}

      {fichaAbierta && (
        <ModalFichaCatalogo
          producto={fichaAbierta}
          imagenesActivas={vitrinaRes?.imagenes_activas !== false}
          onClose={() => setFichaAbierta(null)}
        />
      )}
    </div>
  );
}
