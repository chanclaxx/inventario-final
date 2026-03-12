import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getFacturas, getFacturaById, cancelarFactura } from '../../api/facturas.api';
import { getGarantias } from '../../api/garantias.api';
import { formatCOP, formatFecha, formatFechaHora } from '../../utils/formatters';
import { Badge }              from '../../components/ui/Badge';
import { Button }             from '../../components/ui/Button';
import { Modal }              from '../../components/ui/Modal';
import { Input }              from '../../components/ui/Input';
import { Spinner }            from '../../components/ui/Spinner';
import { EmptyState }         from '../../components/ui/EmptyState';
import { FacturaTermica }     from '../../components/FacturaTermica';
import { ModalEditarFactura } from '../../components/modals/ModalEditarFactura';
import api from '../../api/axios.config';

import {
  FileText, ChevronDown, ChevronUp,
  Printer, XCircle, Eye, Search, X, Pencil,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function agruparPorDia(facturas) {
  const grupos = {};
  facturas.forEach((f) => {
    const dia = formatFecha(f.fecha);
    if (!grupos[dia]) grupos[dia] = [];
    grupos[dia].push(f);
  });
  return grupos;
}

function labelTipoRetoma(tipo) {
  if (tipo === 'serial')   return 'Equipo con serial / IMEI';
  if (tipo === 'cantidad') return 'Producto por cantidad';
  return tipo || '—';
}

function dentroDeRango(fechaStr, desde, hasta) {
  if (!desde && !hasta) return true;
  const fechaDia = fechaStr?.slice(0, 10);
  if (!fechaDia) return false;
  if (desde && fechaDia < desde) return false;
  if (hasta && fechaDia > hasta) return false;
  return true;
}

function coincideTexto(factura, texto) {
  if (!texto.trim()) return true;
  const q = texto.toLowerCase();
  return (
    factura.nombre_cliente?.toLowerCase().includes(q)         ||
    factura.cedula?.toLowerCase().includes(q)                 ||
    factura.celular?.toLowerCase().includes(q)                ||
    factura.productos_nombres?.toLowerCase().includes(q)      ||
    factura.productos_imeis?.toLowerCase().includes(q)        ||
    factura.retoma_descripcion?.toLowerCase().includes(q)     ||
    factura.retoma_nombre_producto?.toLowerCase().includes(q) ||
    factura.retoma_imei?.toLowerCase().includes(q)            ||
    String(factura.id).includes(q)
  );
}

// ─── Sección retoma en modal detalle ─────────────────────────────────────────

function SeccionRetoma({ retoma }) {
  if (!retoma) return null;

  const nombreProducto =
    retoma.nombre_producto_serial   ||
    retoma.nombre_producto_cantidad ||
    retoma.nombre_producto          ||
    null;

  return (
    <div className="bg-purple-50 rounded-xl p-3 flex flex-col gap-1.5">
      <p className="text-xs text-purple-500 font-medium">Retoma</p>
      <p className="text-sm text-gray-700">{retoma.descripcion}</p>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1">
        {retoma.tipo_retoma && (
          <>
            <span className="text-xs text-gray-400">Tipo</span>
            <span className="text-xs text-gray-700">{labelTipoRetoma(retoma.tipo_retoma)}</span>
          </>
        )}
        {retoma.imei && (
          <>
            <span className="text-xs text-gray-400">IMEI</span>
            <span className="text-xs font-mono text-gray-700">{retoma.imei}</span>
          </>
        )}
        {nombreProducto && (
          <>
            <span className="text-xs text-gray-400">Producto</span>
            <span className="text-xs text-gray-700">{nombreProducto}</span>
          </>
        )}
        {retoma.tipo_retoma === 'cantidad' && retoma.cantidad_retoma > 0 && (
          <>
            <span className="text-xs text-gray-400">Cantidad</span>
            <span className="text-xs text-gray-700">{retoma.cantidad_retoma}</span>
          </>
        )}
        <span className="text-xs text-gray-400">Inventario</span>
        <span className="text-xs">
          {retoma.ingreso_inventario
            ? <span className="text-green-600 font-medium">✓ Ingresó al inventario</span>
            : <span className="text-gray-400">No ingresó</span>}
        </span>
      </div>

      <div className="flex justify-between items-center border-t border-purple-200 mt-1 pt-1.5">
        <span className="text-xs text-gray-500">Valor retoma</span>
        <span className="text-sm font-semibold text-purple-700">
          - {formatCOP(retoma.valor_retoma)}
        </span>
      </div>
    </div>
  );
}

// ─── Modal detalle ────────────────────────────────────────────────────────────

function ModalDetalle({ facturaId, onClose, onReimprimir, onEditar }) {
  const { data, isLoading } = useQuery({
    queryKey: ['factura-detalle', facturaId],
    queryFn: () => getFacturaById(facturaId).then((r) => r.data.data),
    enabled: !!facturaId,
  });

  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn: () => api.get('/config').then((r) => r.data.data),
  });

  if (isLoading) {
    return (
      <Modal open onClose={onClose} title="Detalle de Factura" size="lg">
        <Spinner className="py-10" />
      </Modal>
    );
  }

  const f           = data;
  const total       = f?.lineas?.reduce((s, l) => s + Number(l.subtotal || 0), 0) || 0;
  const totalPagado = f?.pagos?.reduce((s, p)  => s + Number(p.valor    || 0), 0) || 0;
  const valorRetoma = f?.retoma ? Number(f.retoma.valor_retoma || 0) : 0;

  return (
    <Modal open onClose={onClose} title={`Factura #${String(facturaId).padStart(6, '0')}`} size="lg">
      <div className="flex flex-col gap-4">

        <div className="flex items-center justify-between">
          <Badge variant={
            f?.estado === 'Activa'  ? 'green'  :
            f?.estado === 'Credito' ? 'yellow' : 'red'
          }>
            {f?.estado}
          </Badge>
          <span className="text-xs text-gray-400">{formatFechaHora(f?.fecha)}</span>
        </div>

        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-xs text-gray-400 mb-1">Cliente</p>
          <p className="text-sm font-semibold text-gray-800">{f?.nombre_cliente}</p>
          {f?.cedula !== 'COMPANERO' && (
            <p className="text-xs text-gray-500">CC: {f?.cedula} · Tel: {f?.celular}</p>
          )}
          {f?.usuario_nombre && (
            <p className="text-xs text-gray-400 mt-1">
              Atendido por:{' '}
              <span className="text-gray-600 font-medium">{f.usuario_nombre}</span>
            </p>
          )}
        </div>

        <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-xs text-gray-400 font-medium">Productos</p>
          {f?.lineas?.map((l) => (
            <div key={l.id} className="flex items-start justify-between text-sm gap-2">
              <div className="flex-1">
                <p className="font-medium text-gray-800">{l.nombre_producto}</p>
                {l.imei && <p className="text-xs text-gray-400 font-mono">{l.imei}</p>}
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-xs text-gray-400">{l.cantidad} x {formatCOP(l.precio)}</p>
                <p className="font-semibold text-gray-900">{formatCOP(l.subtotal)}</p>
              </div>
            </div>
          ))}
        </div>

        <SeccionRetoma retoma={f?.retoma} />

        <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-1.5">
          <p className="text-xs text-gray-400 font-medium">Pagos</p>
          {f?.pagos?.map((p) => (
            <div key={p.id} className="flex justify-between text-sm">
              <span className="text-gray-600">{p.metodo}</span>
              <span className="font-medium text-gray-800">{formatCOP(p.valor)}</span>
            </div>
          ))}
          <div className="border-t border-gray-200 mt-1 pt-1.5 flex justify-between">
            <span className="text-sm font-semibold text-gray-700">Total neto</span>
            <span className="text-sm font-bold text-gray-900">{formatCOP(total - valorRetoma)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">Total pagado</span>
            <span className="text-sm font-medium text-gray-700">{formatCOP(totalPagado)}</span>
          </div>
        </div>

        {f?.notas && (
          <p className="text-xs text-gray-400 italic">Notas: {f.notas}</p>
        )}

        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => onReimprimir({ ...f, config: configData })}
          >
            <Printer size={16} /> Reimprimir
          </Button>
          {f?.estado !== 'Cancelada' && (
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => onEditar(facturaId)}
            >
              <Pencil size={16} /> Editar
            </Button>
          )}
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Fila factura ─────────────────────────────────────────────────────────────

function FilaFactura({ factura, onVerDetalle, onInactivar, onEditar }) {
  const total = Number(factura.total || 0) - Number(factura.total_retoma || 0);

  return (
    <div className={`bg-white border rounded-xl p-3 flex items-center justify-between gap-3
      ${factura.estado === 'Cancelada' ? 'opacity-50 border-gray-100' : 'border-gray-100'}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-800">
            #{String(factura.id).padStart(6, '0')}
          </span>
          <Badge variant={
            factura.estado === 'Activa'  ? 'green'  :
            factura.estado === 'Credito' ? 'yellow' : 'red'
          }>
            {factura.estado}
          </Badge>
          {factura.retoma_descripcion && (
            <Badge variant="purple">Retoma</Badge>
          )}
        </div>
        <p className="text-sm text-gray-600 truncate mt-0.5">{factura.nombre_cliente}</p>
        {factura.productos_nombres && (
          <p className="text-xs text-gray-400 truncate">{factura.productos_nombres}</p>
        )}
        <p className="text-xs text-gray-400">
          {formatFechaHora(factura.fecha)}
          {factura.usuario_nombre && (
            <span className="ml-2 text-gray-300">· {factura.usuario_nombre}</span>
          )}
        </p>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-sm font-bold text-gray-900">{formatCOP(total)}</span>
        <button
          onClick={() => onVerDetalle(factura.id)}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-blue-600 transition-colors"
        >
          <Eye size={16} />
        </button>
        {factura.estado !== 'Cancelada' && (
          <button
            onClick={() => onEditar(factura.id)}
            className="p-1.5 rounded-lg hover:bg-yellow-50 text-gray-400 hover:text-yellow-500 transition-colors"
          >
            <Pencil size={16} />
          </button>
        )}
        {factura.estado !== 'Cancelada' && (
          <button
            onClick={() => onInactivar(factura)}
            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
          >
            <XCircle size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Grupo por día ────────────────────────────────────────────────────────────

function GrupoDia({ fecha, facturas, onVerDetalle, onInactivar, onEditar }) {
  const [expandido, setExpandido] = useState(true);
  const totalDia = facturas
    .filter((f) => f.estado !== 'Cancelada')
    .reduce((s, f) => s + Number(f.total || 0) - Number(f.total_retoma || 0), 0);

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => setExpandido(!expandido)}
        className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-3">
          {expandido
            ? <ChevronUp size={16} className="text-gray-400" />
            : <ChevronDown size={16} className="text-gray-400" />}
          <span className="text-sm font-semibold text-gray-700">{fecha}</span>
          <span className="text-xs text-gray-400">{facturas.length} factura(s)</span>
        </div>
        <span className="text-sm font-bold text-green-600">{formatCOP(totalDia)}</span>
      </button>

      {expandido && (
        <div className="flex flex-col gap-2 pl-2">
          {facturas.map((f) => (
            <FilaFactura
              key={f.id}
              factura={f}
              onVerDetalle={onVerDetalle}
              onInactivar={onInactivar}
              onEditar={onEditar}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Buscador ─────────────────────────────────────────────────────────────────

function PanelBusqueda({ filtros, onChange, onLimpiar, totalResultados, totalFacturas }) {
  const hayFiltros = filtros.texto || filtros.desde || filtros.hasta;

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 flex flex-col gap-3 shadow-sm">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Buscar por cliente, producto, IMEI, retoma..."
          value={filtros.texto}
          onChange={(e) => onChange({ ...filtros, texto: e.target.value })}
          className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl
            text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
        />
      </div>

      <div className="flex gap-2 items-center">
        <div className="flex-1">
          <Input
            label="Desde"
            type="date"
            value={filtros.desde}
            onChange={(e) => onChange({ ...filtros, desde: e.target.value })}
          />
        </div>
        <div className="flex-1">
          <Input
            label="Hasta"
            type="date"
            value={filtros.hasta}
            onChange={(e) => onChange({ ...filtros, hasta: e.target.value })}
          />
        </div>
        {hayFiltros && (
          <button
            onClick={onLimpiar}
            className="flex items-center gap-1 px-3 py-2 mt-5 text-xs text-gray-500
              hover:text-red-500 bg-gray-100 hover:bg-red-50 rounded-xl transition-colors"
          >
            <X size={13} /> Limpiar
          </button>
        )}
      </div>

      {hayFiltros && (
        <p className="text-xs text-gray-400">
          {totalResultados} resultado(s) de {totalFacturas} factura(s)
        </p>
      )}
    </div>
  );
}

// ─── Page principal ───────────────────────────────────────────────────────────

const FILTROS_INICIALES = { texto: '', desde: '', hasta: '' };

export default function FacturarPage() {
  const queryClient                              = useQueryClient();
  const [facturaDetalle,   setFacturaDetalle]   = useState(null);
  const [facturaInactivar, setFacturaInactivar] = useState(null);
  const [facturaImprimir,  setFacturaImprimir]  = useState(null);
  const [facturaEditar,    setFacturaEditar]    = useState(null);
  const [filtros,          setFiltros]          = useState(FILTROS_INICIALES);

  const { data: facturasData, isLoading } = useQuery({
    queryKey: ['facturas'],
    queryFn: () => getFacturas().then((r) => r.data.data),
  });

  const { data: garantiasData } = useQuery({
    queryKey: ['garantias'],
    queryFn: () => getGarantias().then((r) => r.data.data),
  });

  const mutInactivar = useMutation({
    mutationFn: (id) => cancelarFactura(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['facturas']);
      queryClient.invalidateQueries(['productos-serial']);
      queryClient.invalidateQueries(['productos-cantidad']);
      setFacturaInactivar(null);
    },
  });

  const facturas = useMemo(() => facturasData || [], [facturasData]);

  const facturasFiltradas = useMemo(() => {
    return facturas.filter((f) =>
      coincideTexto(f, filtros.texto) &&
      dentroDeRango(f.fecha, filtros.desde, filtros.hasta)
    );
  }, [facturas, filtros]);

  const grupos = useMemo(() => agruparPorDia(facturasFiltradas), [facturasFiltradas]);

  const handleEditar = (id) => {
    setFacturaDetalle(null);
    setFacturaEditar(id);
  };

  return (
    <div className="flex flex-col gap-4">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Historial de Facturas</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          {facturas.length} factura(s) registrada(s)
        </p>
      </div>

      {/* Buscador */}
      <PanelBusqueda
        filtros={filtros}
        onChange={setFiltros}
        onLimpiar={() => setFiltros(FILTROS_INICIALES)}
        totalResultados={facturasFiltradas.length}
        totalFacturas={facturas.length}
      />

      {/* Lista */}
      {isLoading ? (
        <Spinner className="py-20" />
      ) : facturasFiltradas.length === 0 ? (
        <EmptyState
          icon={FileText}
          titulo={facturas.length === 0 ? 'Sin facturas' : 'Sin resultados'}
          descripcion={
            facturas.length === 0
              ? 'Las facturas aparecerán aquí una vez realizadas'
              : 'Intenta con otros términos de búsqueda'
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {Object.entries(grupos).map(([fecha, facts]) => (
            <GrupoDia
              key={fecha}
              fecha={fecha}
              facturas={facts}
              onVerDetalle={(id) => setFacturaDetalle(id)}
              onInactivar={(f) => setFacturaInactivar(f)}
              onEditar={handleEditar}
            />
          ))}
        </div>
      )}

      {/* ── Modales ── */}

      {facturaDetalle && (
        <ModalDetalle
          facturaId={facturaDetalle}
          onClose={() => setFacturaDetalle(null)}
          onReimprimir={(f) => { setFacturaDetalle(null); setFacturaImprimir(f); }}
          onEditar={handleEditar}
        />
      )}

      {facturaInactivar && (
        <Modal open onClose={() => setFacturaInactivar(null)} title="Inactivar Factura" size="sm">
          <div className="flex flex-col gap-4">
            <div className="bg-red-50 rounded-xl p-3">
              <p className="text-sm text-gray-700">
                ¿Seguro que quieres inactivar la factura{' '}
                <span className="font-bold">
                  #{String(facturaInactivar.id).padStart(6, '0')}
                </span>{' '}
                de <span className="font-bold">{facturaInactivar.nombre_cliente}</span>?
              </p>
              <p className="text-xs text-red-500 mt-2">
                Los productos volverán al inventario y la factura quedará cancelada.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setFacturaInactivar(null)}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                loading={mutInactivar.isPending}
                onClick={() => mutInactivar.mutate(facturaInactivar.id)}
              >
                Inactivar
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {facturaEditar && (
        <ModalEditarFactura
          facturaId={facturaEditar}
          onClose={() => setFacturaEditar(null)}
          onGuardado={() => setFacturaEditar(null)}
        />
      )}

      {facturaImprimir && (
        <FacturaTermica
          factura={facturaImprimir}
          garantias={garantiasData || []}
          onClose={() => setFacturaImprimir(null)}
        />
      )}
    </div>
  );
}