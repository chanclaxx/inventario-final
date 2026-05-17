import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, ShoppingCart, PackagePlus, Vault,
  ArrowLeftRight, TrendingUp, TrendingDown,
  ChevronLeft, ChevronRight, Filter, X,
} from 'lucide-react';
import { getActividadUsuarios } from '../../api/usuarios.api';
import api from '../../api/axios.config';
import { Spinner }    from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatCOP, formatFechaHora, fechaHoyBogota } from '../../utils/formatters';

// ─── Config por tipo de actividad ────────────────────────────────────────────

const TIPOS = [
  { value: '',               label: 'Todos'          },
  { value: 'venta',          label: 'Ventas'         },
  { value: 'compra',         label: 'Compras'        },
  { value: 'apertura_caja',  label: 'Caja'           },
  { value: 'traslado',       label: 'Traslados'      },
  { value: 'movimiento_caja',label: 'Mov. de caja'   },
];

const TIPO_META = {
  venta:           { Icn: ShoppingCart,  bg: 'bg-green-100',  text: 'text-green-600',  label: 'Venta'         },
  compra:          { Icn: PackagePlus,   bg: 'bg-blue-100',   text: 'text-blue-600',   label: 'Compra'        },
  apertura_caja:   { Icn: Vault,         bg: 'bg-yellow-100', text: 'text-yellow-600', label: 'Caja'          },
  traslado:        { Icn: ArrowLeftRight,bg: 'bg-purple-100', text: 'text-purple-600', label: 'Traslado'      },
  movimiento_caja: { Icn: TrendingUp,    bg: 'bg-orange-100', text: 'text-orange-600', label: 'Mov. caja'     },
};

const ROL_LABEL = {
  admin_negocio: 'Admin',
  supervisor:    'Supervisor',
  vendedor:      'Vendedor',
};

const LIMIT = 30;

// ─── Componente de ítem de actividad ─────────────────────────────────────────

function ItemActividad({ item }) {
  const meta = TIPO_META[item.tipo] ?? { Icn: Activity, bg: 'bg-gray-100', text: 'text-gray-500', label: item.tipo };
  const { Icn } = meta;

  const iniciales = item.usuario_nombre
    ? item.usuario_nombre.split(' ').slice(0, 2).map((p) => p[0]).join('').toUpperCase()
    : '?';

  const tieneValor = item.valor !== null && item.valor !== undefined;

  return (
    <div className="flex items-start gap-3 py-3 px-4 hover:bg-gray-50 transition-colors rounded-xl">
      {/* Icono tipo */}
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${meta.bg}`}>
        <Icn size={14} className={meta.text} />
      </div>

      {/* Contenido */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{item.descripcion}</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {/* Avatar + nombre usuario */}
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[9px] font-bold
                  flex items-center justify-center flex-shrink-0">
                  {iniciales}
                </span>
                <span className="text-xs text-gray-600 font-medium">{item.usuario_nombre}</span>
              </div>
              <span className="text-gray-300 text-xs">·</span>
              <span className="text-xs text-gray-400">{item.sucursal_nombre}</span>
              <span className="text-gray-300 text-xs">·</span>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${meta.bg} ${meta.text}`}>
                {meta.label}
              </span>
              {item.usuario_rol && (
                <>
                  <span className="text-gray-300 text-xs">·</span>
                  <span className="text-xs text-gray-400">{ROL_LABEL[item.usuario_rol] ?? item.usuario_rol}</span>
                </>
              )}
            </div>
          </div>

          {/* Valor + fecha */}
          <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
            {tieneValor && Number(item.valor) > 0 && (
              <span className="text-sm font-semibold text-gray-800 tabular-nums">
                {formatCOP(Number(item.valor))}
              </span>
            )}
            <span className="text-xs text-gray-400 tabular-nums whitespace-nowrap">
              {formatFechaHora(item.fecha)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function ActividadUsuariosPage() {
  const hoy = fechaHoyBogota();

  const [filtros, setFiltros] = useState({
    usuario_id:  '',
    fecha_desde: '',
    fecha_hasta: '',
    tipo:        '',
    page:        1,
  });

  const setFiltro = (key, value) =>
    setFiltros((f) => ({ ...f, [key]: value, page: key !== 'page' ? 1 : value }));

  // ── Usuarios del negocio para el select ──────────────────────────────────
  const { data: usuariosData } = useQuery({
    queryKey: ['usuarios'],
    queryFn:  () => api.get('/usuarios').then((r) => r.data.data),
  });
  const usuarios = usuariosData ?? [];

  // ── Actividad ─────────────────────────────────────────────────────────────
  const queryParams = {
    ...(filtros.usuario_id  && { usuario_id:  filtros.usuario_id  }),
    ...(filtros.fecha_desde && { fecha_desde: filtros.fecha_desde }),
    ...(filtros.fecha_hasta && { fecha_hasta: filtros.fecha_hasta }),
    ...(filtros.tipo        && { tipo:        filtros.tipo        }),
    page:  filtros.page,
    limit: LIMIT,
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['actividad-usuarios', queryParams],
    queryFn:  () => getActividadUsuarios(queryParams).then((r) => r.data),
    keepPreviousData: true,
  });

  const actividad = data?.actividad ?? [];
  const total     = data?.total     ?? 0;
  const totalPags = Math.max(1, Math.ceil(total / LIMIT));

  const hayFiltros = filtros.usuario_id || filtros.fecha_desde || filtros.fecha_hasta || filtros.tipo;

  const limpiarFiltros = () => setFiltros({
    usuario_id: '', fecha_desde: '', fecha_hasta: '', tipo: '', page: 1,
  });

  return (
    <div className="flex flex-col gap-4">

      {/* ── Encabezado ── */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
          <Activity size={20} className="text-blue-600" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-900">Actividad de usuarios</h1>
          <p className="text-xs text-gray-400">Historial de acciones realizadas por tu equipo</p>
        </div>
      </div>

      {/* ── Filtros ── */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={13} className="text-gray-400" />
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filtros</span>
          {hayFiltros && (
            <button
              onClick={limpiarFiltros}
              className="ml-auto flex items-center gap-1 text-xs text-red-500 hover:text-red-700
                px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
            >
              <X size={11} /> Limpiar
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Usuario */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Usuario</label>
            <select
              value={filtros.usuario_id}
              onChange={(e) => setFiltro('usuario_id', e.target.value)}
              className="px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm text-gray-900
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
            >
              <option value="">Todos</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>{u.nombre}</option>
              ))}
            </select>
          </div>

          {/* Tipo */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Tipo</label>
            <select
              value={filtros.tipo}
              onChange={(e) => setFiltro('tipo', e.target.value)}
              className="px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm text-gray-900
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
            >
              {TIPOS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Desde */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Desde</label>
            <input
              type="date"
              value={filtros.fecha_desde}
              max={filtros.fecha_hasta || hoy}
              onChange={(e) => setFiltro('fecha_desde', e.target.value)}
              className="px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm text-gray-900
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
            />
          </div>

          {/* Hasta */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Hasta</label>
            <input
              type="date"
              value={filtros.fecha_hasta}
              min={filtros.fecha_desde}
              max={hoy}
              onChange={(e) => setFiltro('fecha_hasta', e.target.value)}
              className="px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm text-gray-900
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
            />
          </div>
        </div>
      </div>

      {/* ── Lista de actividad ── */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">

        {/* Cabecera con conteo */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            {isLoading ? 'Cargando...' : `${total} registro${total !== 1 ? 's' : ''}`}
          </span>
          {totalPags > 1 && (
            <span className="text-xs text-gray-400">
              Página {filtros.page} de {totalPags}
            </span>
          )}
        </div>

        {/* Contenido */}
        {isLoading ? (
          <Spinner className="py-16" />
        ) : isError ? (
          <div className="py-12 text-center">
            <p className="text-sm text-red-500">Error al cargar la actividad</p>
          </div>
        ) : actividad.length === 0 ? (
          <EmptyState
            icon={Activity}
            titulo="Sin actividad"
            descripcion={hayFiltros
              ? 'No hay resultados para los filtros aplicados'
              : 'Aún no hay actividad registrada en tu negocio'}
          />
        ) : (
          <div className="divide-y divide-gray-50 px-1 py-1">
            {actividad.map((item) => (
              <ItemActividad key={`${item.tipo}-${item.id}`} item={item} />
            ))}
          </div>
        )}

        {/* Paginación */}
        {totalPags > 1 && !isLoading && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-50">
            <button
              onClick={() => setFiltro('page', filtros.page - 1)}
              disabled={filtros.page <= 1}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium
                text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed
                transition-colors"
            >
              <ChevronLeft size={15} /> Anterior
            </button>
            <span className="text-xs text-gray-400 tabular-nums">
              {(filtros.page - 1) * LIMIT + 1}–{Math.min(filtros.page * LIMIT, total)} de {total}
            </span>
            <button
              onClick={() => setFiltro('page', filtros.page + 1)}
              disabled={filtros.page >= totalPags}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium
                text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed
                transition-colors"
            >
              Siguiente <ChevronRight size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
