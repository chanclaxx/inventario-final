import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal }              from '../../components/ui/Modal';
import { Button }             from '../../components/ui/Button';
import { Input }              from '../../components/ui/Input';
import { Badge }              from '../../components/ui/Badge';
import { Spinner }            from '../../components/ui/Spinner';
import { formatCOP }          from '../../utils/formatters';
import { getFacturaById, editarFactura } from '../../api/facturas.api';
import { User, Users } from 'lucide-react';

const METODOS_PAGO = [
  { id: 'Efectivo'       },
  { id: 'Nequi'         },
  { id: 'Daviplata'     },
  { id: 'Transferencia' },
  { id: 'Tarjeta'       },
];

// Construye mapa { Efectivo: 50000, Nequi: 0, ... } desde array de pagos
function pagosArrayAMapa(pagosArr) {
  const mapa = {};
  METODOS_PAGO.forEach(({ id }) => { mapa[id] = 0; });
  (pagosArr || []).forEach((p) => { mapa[p.metodo] = Number(p.valor || 0); });
  return mapa;
}

// Construye el estado inicial completo desde los datos de la factura
function buildEstadoInicial(data) {
  if (!data) return null;
  const esCompanero = data.cedula === 'COMPANERO';
  return {
    tipoCliente: esCompanero ? 'companero' : 'cliente',
    form: {
      nombre:  data.nombre_cliente || '',
      cedula:  esCompanero ? '' : (data.cedula  || ''),
      celular: esCompanero ? '' : (data.celular || ''),
      notas:   data.notas || '',
    },
    lineas: (data.lineas || []).map((l) => ({
      id:              l.id,
      nombre_producto: l.nombre_producto,
      imei:            l.imei || null,
      cantidad:        l.cantidad,
      precio:          Number(l.precio || 0),
    })),
    pagos: pagosArrayAMapa(data.pagos),
    retoma: data.retoma ? {
      descripcion:        data.retoma.descripcion        || '',
      valor_retoma:       data.retoma.valor_retoma        || 0,
      ingreso_inventario: data.retoma.ingreso_inventario  || false,
    } : null,
  };
}

export function ModalEditarFactura({ facturaId, onClose, onGuardado }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['factura-detalle', facturaId],
    queryFn:  () => getFacturaById(facturaId).then((r) => r.data.data),
    enabled:  !!facturaId,
  });

  // Estado inicial derivado de data — se calcula una sola vez cuando data llega
  const estadoInicial = useMemo(() => buildEstadoInicial(data), [data]);

  const [tipoCliente, setTipoCliente] = useState(null);
  const [form,        setForm]        = useState(null);
  const [lineas,      setLineas]      = useState(null);
  const [pagos,       setPagos]       = useState(null);
  const [retoma,      setRetoma]      = useState(undefined); // undefined = no inicializado
  const [error,       setError]       = useState('');

  // Valores efectivos: usa estado local si ya fue modificado, si no usa el inicial
  const tipoClienteEfectivo = tipoCliente ?? estadoInicial?.tipoCliente ?? 'cliente';
  const formEfectivo        = form        ?? estadoInicial?.form        ?? {};
  const lineasEfectivas     = lineas      ?? estadoInicial?.lineas      ?? [];
  const pagosEfectivos      = pagos       ?? estadoInicial?.pagos       ?? {};
  const retomaEfectiva      = retoma !== undefined ? retoma : (estadoInicial?.retoma ?? null);

  const mutEditar = useMutation({
    mutationFn: () => editarFactura(facturaId, {
      nombre_cliente: formEfectivo.nombre,
      cedula:         tipoClienteEfectivo === 'companero' ? 'COMPANERO' : formEfectivo.cedula,
      celular:        tipoClienteEfectivo === 'companero' ? '0000000000' : formEfectivo.celular,
      notas:          formEfectivo.notas,
      lineas:         lineasEfectivas,
      pagos: Object.entries(pagosEfectivos)
        .filter(([, v]) => Number(v) > 0)
        .map(([metodo, valor]) => ({ metodo, valor: Number(valor) })),
      retoma: retomaEfectiva,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries(['facturas']);
      queryClient.invalidateQueries(['factura-detalle', facturaId]);
      onGuardado?.();
      onClose();
    },
    onError: (e) => setError(e.response?.data?.error || 'Error al guardar los cambios'),
  });

  const handleSubmit = () => {
    setError('');
    if (!formEfectivo.nombre?.trim()) return setError('El nombre es requerido');
    if (tipoClienteEfectivo === 'cliente' && !formEfectivo.cedula?.trim())  return setError('La cédula es requerida');
    if (tipoClienteEfectivo === 'cliente' && !formEfectivo.celular?.trim()) return setError('El celular es requerido');
    mutEditar.mutate();
  };

  const totalLineas = lineasEfectivas.reduce((s, l) => s + l.precio * l.cantidad, 0);
  const valorRetoma = retomaEfectiva ? Number(retomaEfectiva.valor_retoma || 0) : 0;
  const totalNeto   = totalLineas - valorRetoma;
  const totalPagado = Object.values(pagosEfectivos).reduce((s, v) => s + Number(v || 0), 0);
  const diferencia  = totalPagado - totalNeto;

  if (isLoading || !estadoInicial) {
    return (
      <Modal open onClose={onClose} title="Editar Factura" size="lg">
        <Spinner className="py-10" />
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Editar Factura #${String(facturaId).padStart(6, '0')}`}
      size="lg"
    >
      <div className="flex flex-col gap-5">

        {/* ── Tipo de cliente ── */}
        <div className="flex gap-2">
          {[
            { id: 'companero', label: 'Compañero', Icn: User  },
            { id: 'cliente',   label: 'Cliente',   Icn: Users },
          ].map((item) => {
            const ItemIcon = item.Icn;
            return (
              <button
                key={item.id}
                onClick={() => setTipoCliente(item.id)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl
                  text-sm font-medium border transition-all
                  ${tipoClienteEfectivo === item.id
                    ? 'bg-blue-50 border-blue-300 text-blue-700'
                    : 'bg-gray-50 border-gray-200 text-gray-600'}`}
              >
                <ItemIcon size={16} /> {item.label}
              </button>
            );
          })}
        </div>

        {/* ── Datos del cliente ── */}
        <div className="flex flex-col gap-3">
          {tipoClienteEfectivo === 'cliente' && (
            <Input
              label="Cédula"
              placeholder="123456789"
              value={formEfectivo.cedula}
              onChange={(e) => setForm({ ...formEfectivo, cedula: e.target.value })}
            />
          )}
          <Input
            label="Nombre"
            placeholder="Nombre completo"
            value={formEfectivo.nombre}
            onChange={(e) => setForm({ ...formEfectivo, nombre: e.target.value })}
          />
          {tipoClienteEfectivo === 'cliente' && (
            <Input
              label="Celular"
              placeholder="3001234567"
              value={formEfectivo.celular}
              onChange={(e) => setForm({ ...formEfectivo, celular: e.target.value })}
            />
          )}
          <Input
            label="Notas"
            placeholder="Observaciones..."
            value={formEfectivo.notas}
            onChange={(e) => setForm({ ...formEfectivo, notas: e.target.value })}
          />
        </div>

        {/* ── Productos (solo editar precio) ── */}
        <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-xs font-medium text-gray-500 mb-1">
            Productos{' '}
            <span className="text-gray-400 font-normal">(solo se puede editar el precio)</span>
          </p>
          {lineasEfectivas.map((linea, index) => (
            <div key={linea.id} className="flex items-center justify-between gap-2 text-sm">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-800 truncate">{linea.nombre_producto}</p>
                {linea.imei && (
                  <p className="text-xs text-gray-400 font-mono">{linea.imei}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className="text-xs text-gray-400">{linea.cantidad}x</span>
                <input
                  type="number"
                  value={linea.precio}
                  onChange={(e) => {
                    const next = [...lineasEfectivas];
                    next[index] = { ...next[index], precio: Number(e.target.value) };
                    setLineas(next);
                  }}
                  onWheel={(e) => e.target.blur()}
                  className="w-28 text-right text-sm font-semibold text-gray-900 bg-white
                    border border-gray-200 rounded-lg px-2 py-1 focus:outline-none
                    focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          ))}
          <div className="border-t border-gray-200 mt-1 pt-2 flex justify-between">
            <span className="text-sm font-medium text-gray-700">Subtotal</span>
            <span className="text-sm font-bold text-gray-900">{formatCOP(totalLineas)}</span>
          </div>
        </div>

        {/* ── Retoma (solo si existe) ── */}
        {retomaEfectiva && (
          <div className="bg-purple-50 rounded-xl p-3 flex flex-col gap-2 border border-purple-100">
            <p className="text-xs font-medium text-purple-700">Retoma</p>
            <Input
              label="Descripción"
              placeholder="Descripción de la retoma"
              value={retomaEfectiva.descripcion}
              onChange={(e) => setRetoma({ ...retomaEfectiva, descripcion: e.target.value })}
            />
            <Input
              label="Valor retoma"
              type="number"
              placeholder="0"
              value={retomaEfectiva.valor_retoma}
              onChange={(e) => setRetoma({ ...retomaEfectiva, valor_retoma: e.target.value })}
              onWheel={(e) => e.target.blur()}
            />
          </div>
        )}

        {/* ── Métodos de pago ── */}
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Métodos de pago</p>
          <div className="flex flex-col gap-2">
            {METODOS_PAGO.map(({ id }) => (
              <div key={id} className="flex items-center gap-3">
                <span className="text-sm text-gray-600 w-28">{id}</span>
                <input
                  type="number"
                  placeholder="0"
                  value={pagosEfectivos[id] || ''}
                  onChange={(e) => setPagos({ ...pagosEfectivos, [id]: e.target.value })}
                  onWheel={(e) => e.target.blur()}
                  className="flex-1 px-3 py-2 bg-gray-100 rounded-xl text-sm
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                />
              </div>
            ))}
          </div>
        </div>

        {/* ── Resumen financiero ── */}
        <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-1.5">
          {retomaEfectiva && valorRetoma > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-purple-600">Retoma</span>
              <span className="text-purple-600">- {formatCOP(valorRetoma)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Total a pagar</span>
            <span className="font-bold text-gray-900">{formatCOP(totalNeto)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Total pagado</span>
            <span className="font-medium">{formatCOP(totalPagado)}</span>
          </div>
          {diferencia !== 0 && (
            <div className="flex justify-between text-sm border-t border-gray-200 pt-1.5 mt-1">
              <span className={diferencia > 0 ? 'text-green-600' : 'text-red-500'}>
                {diferencia > 0 ? 'Cambio' : 'Falta'}
              </span>
              <Badge variant={diferencia > 0 ? 'green' : 'red'}>
                {formatCOP(Math.abs(diferencia))}
              </Badge>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button className="flex-1" loading={mutEditar.isPending} onClick={handleSubmit}>
            Guardar cambios
          </Button>
        </div>

      </div>
    </Modal>
  );
}