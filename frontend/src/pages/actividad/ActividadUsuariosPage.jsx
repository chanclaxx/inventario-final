import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, ShoppingCart, PackagePlus, Vault,
  ArrowLeftRight, TrendingUp, Package, Wrench,
  ChevronLeft, ChevronRight, Filter, X,
  User, MapPin, Calendar, CreditCard,
  FileText, Tag, StickyNote, Smartphone,
} from 'lucide-react';
import { getActividadUsuarios } from '../../api/usuarios.api';
import api from '../../api/axios.config';
import { Modal }      from '../../components/ui/Modal';
import { Spinner }    from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatCOP, formatFechaHora, fechaHoyBogota } from '../../utils/formatters';

// ─── Tipos de filtro (valores = claves de TABLA_POR_TIPO en el backend) ────────

const TIPOS = [
  { value: '',                   label: 'Todos'          },
  { value: 'venta',              label: 'Ventas'         },
  { value: 'compra',             label: 'Compras'        },
  { value: 'caja',               label: 'Caja'           },
  { value: 'traslado',           label: 'Traslados'      },
  { value: 'inventario_serial',  label: 'Inv. serial'    },
  { value: 'inventario_cantidad',label: 'Inv. cantidad'  },
  { value: 'servicio',           label: 'Servicios'      },
  { value: 'credito',            label: 'Créditos'       },
  { value: 'prestamo',           label: 'Préstamos'      },
  { value: 'usuario',            label: 'Usuarios'       },
];

// ─── Meta por tabla (viene del campo item.tabla en auditoria) ─────────────────

const TABLA_META = {
  facturas:           { Icn: ShoppingCart,   bg: 'bg-green-100',  text: 'text-green-600',  border: 'border-green-200',  label: 'Venta'         },
  compras:            { Icn: PackagePlus,    bg: 'bg-blue-100',   text: 'text-blue-600',   border: 'border-blue-200',   label: 'Compra'        },
  traslados:          { Icn: ArrowLeftRight, bg: 'bg-purple-100', text: 'text-purple-600', border: 'border-purple-200', label: 'Traslado'      },
  caja:               { Icn: Vault,          bg: 'bg-yellow-100', text: 'text-yellow-600', border: 'border-yellow-200', label: 'Caja'          },
  productos_serial:   { Icn: Smartphone,     bg: 'bg-indigo-100', text: 'text-indigo-600', border: 'border-indigo-200', label: 'Inv. serial'   },
  productos_cantidad: { Icn: Package,        bg: 'bg-cyan-100',   text: 'text-cyan-600',   border: 'border-cyan-200',   label: 'Inv. cantidad' },
  servicios:          { Icn: Wrench,         bg: 'bg-orange-100', text: 'text-orange-600', border: 'border-orange-200', label: 'Servicio'      },
  creditos:           { Icn: CreditCard,     bg: 'bg-rose-100',   text: 'text-rose-600',   border: 'border-rose-200',   label: 'Crédito'       },
  prestamos:          { Icn: TrendingUp,     bg: 'bg-teal-100',   text: 'text-teal-600',   border: 'border-teal-200',   label: 'Préstamo'      },
  usuarios:           { Icn: User,           bg: 'bg-gray-100',   text: 'text-gray-600',   border: 'border-gray-200',   label: 'Usuario'       },
};

const getMeta = (tabla) =>
  TABLA_META[tabla] ?? { Icn: Activity, bg: 'bg-gray-100', text: 'text-gray-500', border: 'border-gray-200', label: tabla ?? '?' };

const getValor = (item) => {
  const d = item.detalle ?? {};
  return Number(d.valor ?? d.precio ?? d.monto ?? d.saldo_inicial ?? d.saldo_final ?? 0);
};

const ROL_LABEL = {
  admin_negocio: 'Admin',
  supervisor:    'Supervisor',
  vendedor:      'Vendedor',
};

const LIMIT = 30;

// ─── Fila dentro del modal ────────────────────────────────────────────────────

function FilaDetalle({ icono, label, value, mono }) {
  if (value === null || value === undefined || value === '' || value === '—') return null;
  const Icn = icono;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <div className="w-7 h-7 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icn size={13} className="text-gray-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-400 leading-none mb-0.5">{label}</p>
        <p className={`text-sm text-gray-800 font-medium break-words ${mono ? 'font-mono' : ''}`}>{value}</p>
      </div>
    </div>
  );
}

// ─── Modal de detalle ─────────────────────────────────────────────────────────

function ModalDetalle({ item, onClose }) {
  if (!item) return null;
  const meta   = getMeta(item.tabla);
  const MetaIcn = meta.Icn;
  const d       = item.detalle ?? {};
  const valor   = getValor(item);

  const camposExtra = () => {
    switch (item.tabla) {
      case 'facturas':
        return (
          <>
            <FilaDetalle icono={User}       label="Cliente"        value={d.cliente} />
            <FilaDetalle icono={CreditCard} label="Cédula"         value={d.cedula}  mono />
            <FilaDetalle icono={Tag}        label="Estado"         value={d.estado} />
          </>
        );
      case 'compras':
        return (
          <>
            <FilaDetalle icono={FileText}   label="N.° factura"    value={d.numero_factura}   mono />
            <FilaDetalle icono={Tag}        label="Estado"         value={d.estado} />
            <FilaDetalle icono={CreditCard} label="Método de pago" value={d.metodo} />
            {/* Corrección de precios: total_nuevo solo lo trae este evento */}
            {d.total_nuevo != null && (
              <>
                <FilaDetalle icono={CreditCard} label="Total anterior"   value={formatCOP(Number(d.total_anterior))} />
                <FilaDetalle icono={CreditCard} label="Total corregido"  value={formatCOP(Number(d.total_nuevo))} />
                {d.lineas != null && (
                  <FilaDetalle icono={Package} label="Productos ajustados" value={`${d.lineas} ítem(s)`} />
                )}
                {d.motivo && (
                  <FilaDetalle icono={StickyNote} label="Motivo" value={d.motivo} />
                )}
              </>
            )}
          </>
        );
      case 'traslados':
        return (
          <>
            <FilaDetalle icono={Tag}        label="Productos"      value={d.items != null ? `${d.items} ítem(s)` : null} />
            <FilaDetalle icono={StickyNote} label="Notas"          value={d.notas} />
          </>
        );
      case 'caja':
        return (
          <>
            {d.saldo_inicial != null && (
              <FilaDetalle icono={CreditCard} label="Saldo inicial" value={formatCOP(Number(d.saldo_inicial))} />
            )}
            {d.saldo_final != null && (
              <FilaDetalle icono={CreditCard} label="Saldo final"   value={formatCOP(Number(d.saldo_final))} />
            )}
            {d.total_ventas != null && (
              <FilaDetalle icono={ShoppingCart} label="Total ventas" value={formatCOP(Number(d.total_ventas))} />
            )}
            <FilaDetalle icono={Tag}        label="Tipo"           value={d.tipo} />
            <FilaDetalle icono={StickyNote} label="Concepto"       value={d.concepto} />
          </>
        );
      case 'productos_serial':
      case 'productos_cantidad':
        return (
          <>
            <FilaDetalle icono={Tag}        label="Producto"       value={d.producto} />
            <FilaDetalle icono={Smartphone} label="IMEI"           value={d.imei}          mono />
            <FilaDetalle icono={Smartphone} label="IMEI anterior"  value={d.imei_anterior} mono />
            <FilaDetalle icono={Tag}        label="Marca"          value={d.marca} />
            <FilaDetalle icono={Tag}        label="Modelo"         value={d.modelo} />
            {d.precio_anterior != null && (
              <FilaDetalle icono={CreditCard} label="Precio anterior" value={formatCOP(d.precio_anterior)} />
            )}
            {d.precio_nuevo != null && (
              <FilaDetalle icono={CreditCard} label="Precio nuevo"    value={formatCOP(d.precio_nuevo)} />
            )}
            {d.cantidad != null && (
              <FilaDetalle icono={Package}  label="Cantidad"       value={String(d.cantidad)} />
            )}
            <FilaDetalle icono={Tag}        label="Tipo ajuste"    value={d.tipo} />
            <FilaDetalle icono={StickyNote} label="Notas"          value={d.notas} />
          </>
        );
      case 'servicios':
        return (
          <>
            <FilaDetalle icono={User}       label="Cliente"        value={d.cliente} />
            <FilaDetalle icono={Wrench}     label="Equipo"         value={d.equipo} />
            {d.monto != null && (
              <FilaDetalle icono={CreditCard} label="Abono"        value={formatCOP(Number(d.monto))} />
            )}
            {Number(d.saldo_pendiente) > 0 && (
              <FilaDetalle icono={TrendingUp} label="Saldo pendiente" value={formatCOP(Number(d.saldo_pendiente))} />
            )}
          </>
        );
      case 'creditos':
        return (
          <>
            {d.monto != null && (
              <FilaDetalle icono={CreditCard} label="Abono"        value={formatCOP(Number(d.monto))} />
            )}
            {d.saldo_nuevo != null && (
              <FilaDetalle icono={TrendingUp} label="Saldo restante" value={formatCOP(Number(d.saldo_nuevo))} />
            )}
          </>
        );
      case 'prestamos':
        return (
          <>
            <FilaDetalle icono={User}       label="Prestatario"    value={d.prestatario} />
            <FilaDetalle icono={Tag}        label="Producto"       value={d.producto} />
            <FilaDetalle icono={Smartphone} label="IMEI"           value={d.imei}   mono />
            {d.cantidad != null && (
              <FilaDetalle icono={Package}  label="Cantidad"       value={String(d.cantidad)} />
            )}
            {d.cantidad_devuelta != null && (
              <FilaDetalle icono={Package}  label="Cantidad devuelta" value={String(d.cantidad_devuelta)} />
            )}
            {d.cantidad_pendiente != null && (
              <FilaDetalle icono={Package}  label="Cantidad pendiente" value={String(d.cantidad_pendiente)} />
            )}
            {d.monto != null && (
              <FilaDetalle icono={CreditCard} label="Abono"        value={formatCOP(Number(d.monto))} />
            )}
            <FilaDetalle icono={CreditCard} label="Método de pago" value={d.metodo} />
            <FilaDetalle icono={StickyNote} label="Descripción"    value={d.descripcion} />
          </>
        );
      case 'usuarios':
        return (
          <>
            <FilaDetalle icono={User}       label="Nombre"         value={d.nombre} />
            <FilaDetalle icono={Tag}        label="Rol"            value={ROL_LABEL[d.rol] ?? d.rol} />
          </>
        );
      default:
        return null;
    }
  };

  return (
    <Modal open onClose={onClose} title="Detalle del movimiento" size="sm">
      <div className="flex flex-col gap-4">

        <div className={`flex items-center gap-3 p-3 rounded-2xl border ${meta.bg} ${meta.border}`}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-white/60">
            <MetaIcn size={18} className={meta.text} />
          </div>
          <div>
            <p className={`text-sm font-bold ${meta.text}`}>{meta.label}</p>
            <p className="text-xs text-gray-500">{formatFechaHora(item.fecha)}</p>
          </div>
        </div>

        <p className="text-sm font-semibold text-gray-800 leading-snug">{item.accion}</p>

        {valor > 0 && (
          <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5">
            <span className="text-xs text-gray-500 font-medium">Monto</span>
            <span className="text-lg font-bold text-gray-900 tabular-nums">
              {formatCOP(valor)}
            </span>
          </div>
        )}

        <div className="flex flex-col">
          <FilaDetalle icono={User}     label="Usuario"  value={`${item.usuario_nombre} (${ROL_LABEL[item.usuario_rol] ?? item.usuario_rol})`} />
          <FilaDetalle icono={MapPin}   label="Sucursal" value={item.sucursal_nombre} />
          <FilaDetalle icono={Calendar} label="Fecha"    value={formatFechaHora(item.fecha)} />
          {camposExtra()}
        </div>

      </div>
    </Modal>
  );
}

// ─── Ítem de la lista ─────────────────────────────────────────────────────────

function ItemActividad({ item, onClick }) {
  const meta    = getMeta(item.tabla);
  const { Icn } = meta;
  const valor   = getValor(item);

  const iniciales = item.usuario_nombre
    ? item.usuario_nombre.split(' ').slice(0, 2).map((p) => p[0]).join('').toUpperCase()
    : '?';

  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-3 py-3 px-4 hover:bg-gray-50 active:bg-gray-100
        transition-colors rounded-xl text-left"
    >
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${meta.bg}`}>
        <Icn size={14} className={meta.text} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{item.accion}</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[9px] font-bold
                  flex items-center justify-center flex-shrink-0">
                  {iniciales}
                </span>
                <span className="text-xs text-gray-600 font-medium">{item.usuario_nombre}</span>
              </div>
              <span className="text-gray-300 text-xs">·</span>
              <span className="text-xs text-gray-400">{item.sucursal_nombre ?? '—'}</span>
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

          <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
            {valor > 0 && (
              <span className="text-sm font-semibold text-gray-800 tabular-nums">
                {formatCOP(valor)}
              </span>
            )}
            <span className="text-xs text-gray-400 tabular-nums whitespace-nowrap">
              {formatFechaHora(item.fecha)}
            </span>
          </div>
        </div>
      </div>
    </button>
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

  const [itemSeleccionado, setItemSeleccionado] = useState(null);

  const setFiltro = (key, value) =>
    setFiltros((f) => ({ ...f, [key]: value, page: key !== 'page' ? 1 : value }));

  const { data: usuariosData } = useQuery({
    queryKey: ['usuarios'],
    queryFn:  () => api.get('/usuarios').then((r) => r.data.data),
  });
  const usuarios = usuariosData ?? [];

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

  const actividad  = data?.actividad ?? [];
  const total      = data?.total     ?? 0;
  const totalPags  = Math.max(1, Math.ceil(total / LIMIT));
  const hayFiltros = filtros.usuario_id || filtros.fecha_desde || filtros.fecha_hasta || filtros.tipo;

  const limpiarFiltros = () =>
    setFiltros({ usuario_id: '', fecha_desde: '', fecha_hasta: '', tipo: '', page: 1 });

  return (
    <div className="flex flex-col gap-4">

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

      {/* ── Lista ── */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">

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
              : 'La actividad se registrará a partir de ahora'}
          />
        ) : (
          <div className="divide-y divide-gray-50 px-1 py-1">
            {actividad.map((item) => (
              <ItemActividad
                key={item.id}
                item={item}
                onClick={() => setItemSeleccionado(item)}
              />
            ))}
          </div>
        )}

        {totalPags > 1 && !isLoading && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-50">
            <button
              onClick={() => setFiltro('page', filtros.page - 1)}
              disabled={filtros.page <= 1}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium
                text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
                text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Siguiente <ChevronRight size={15} />
            </button>
          </div>
        )}
      </div>

      {itemSeleccionado && (
        <ModalDetalle
          item={itemSeleccionado}
          onClose={() => setItemSeleccionado(null)}
        />
      )}
    </div>
  );
}
