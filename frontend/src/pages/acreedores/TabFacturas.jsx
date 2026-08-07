import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getFacturasPorVencer, ponerPlazoACargo } from '../../api/acreedores.api';
import { formatCOP, formatFecha } from '../../utils/formatters';
import { Spinner }     from '../../components/ui/Spinner';
import { EmptyState }  from '../../components/ui/EmptyState';
import { SearchInput } from '../../components/ui/SearchInput';
import { Modal }       from '../../components/ui/Modal';
import { Button }      from '../../components/ui/Button';
import { ChipPago, BarraAvance } from '../proveedores/indicadoresOrden';
import {
  FileText, ClipboardList, ShoppingCart, Info, CalendarClock,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// FACTURAS DE PROVEEDOR POR VENCER
//
// La pregunta que antes no tenía dónde responderse: «¿qué le tengo que pagar a
// mis proveedores y cuándo?». Es el espejo de la cartera de clientes — aquí el
// que debe es el negocio.
//
// Incluye las facturas de ÓRDENES y las de COMPRAS SUELTAS. Que a alguien se le
// haya olvidado crear la orden no hace que la factura deje de vencer, y una
// pantalla que escondiera la mitad de lo que se debe no serviría para nada.
//
// Las que vienen de una orden muestran además cuánta mercancía llegó: es la
// otra mitad de la pregunta. «Le debo $2.000.000 de un pedido que solo me
// entregó la mitad» es una conversación muy distinta a «le debo $2.000.000».
// ─────────────────────────────────────────────────────────────────────────────

const FILTROS = [
  { id: 'pendientes', label: 'Por pagar' },
  { id: 'vencidas',   label: 'Vencidas'  },
  // Las deudas a las que nadie les puso fecha. Sin esta vista, olvidar el plazo
  // al registrar la compra dejaba la factura invisible para siempre.
  { id: 'sin_plazo',  label: 'Sin plazo' },
  { id: 'todas',      label: 'Todas'     },
];

// ── Poner el plazo a una deuda que se registró sin él ────────────────────────
function ModalPonerPlazo({ factura, onClose }) {
  const queryClient = useQueryClient();
  const [fecha, setFecha] = useState(factura.fecha ? String(factura.fecha).slice(0, 10) : '');
  const [plazo, setPlazo] = useState('');
  const [error, setError] = useState('');

  const mut = useMutation({
    mutationFn: () => ponerPlazoACargo(factura.cargo_id, {
      fecha_factura: fecha || null,
      dias_plazo:    plazo !== '' ? Number(plazo) : null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['acreedores'], exact: false });
      onClose();
    },
    onError: (e) => setError(e.response?.data?.error || 'No se pudo guardar el plazo'),
  });

  const vencimiento = (() => {
    if (!fecha || plazo === '') return null;
    const d = new Date(`${fecha}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    d.setUTCDate(d.getUTCDate() + Number(plazo));
    return d.toISOString().slice(0, 10);
  })();

  return (
    <Modal open onClose={onClose} title="¿Cuándo hay que pagarle?">
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-sm font-semibold text-gray-900">{factura.proveedor_nombre}</p>
          <p className="text-xs text-gray-400 tabular-nums">
            {factura.numero_factura || 'Sin N° de factura'} · debes {formatCOP(factura.saldo)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Fecha de la factura</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
              className="px-3 py-2.5 text-sm bg-gray-100 border-0 rounded-xl text-gray-700
                         focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Plazo (días)</label>
            <input type="number" min="0" max="365" value={plazo} placeholder="30"
              onChange={(e) => setPlazo(e.target.value)}
              className="px-3 py-2.5 text-sm tabular-nums bg-gray-100 border-0 rounded-xl
                         focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white" />
          </div>
        </div>

        {vencimiento && (
          <p className="text-xs text-gray-600">
            Le tienes que pagar antes del <strong>{formatFecha(vencimiento)}</strong>.
          </p>
        )}

        <div className="bg-gray-50 rounded-xl px-3 py-2">
          <p className="text-xs text-gray-500">
            Solo cambia la fecha en la que hay que pagar. El valor de la deuda y el
            inventario no se tocan.
          </p>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={mut.isPending} disabled={!vencimiento} onClick={() => mut.mutate()}>
            Guardar plazo
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function TarjetaResumen({ titulo, cuantas, valor, tono }) {
  const tonos = {
    rojo:  'bg-red-50 text-red-700',
    ambar: 'bg-amber-50 text-amber-700',
    gris:  'bg-gray-50 text-gray-600',
  };
  return (
    <div className={`rounded-xl px-3 py-2.5 flex-1 min-w-0 ${tonos[tono]}`}>
      <p className="text-xs opacity-70 truncate">{titulo}</p>
      <p className="text-base font-bold tabular-nums truncate">{formatCOP(valor)}</p>
      <p className="text-xs opacity-70 tabular-nums">
        {cuantas} {cuantas === 1 ? 'factura' : 'facturas'}
      </p>
    </div>
  );
}

function FilaFactura({ factura, onAbrir }) {
  const deOrden = factura.origen === 'orden';
  const Icn     = deOrden ? ClipboardList : ShoppingCart;
  const sinPlazo = !factura.fecha_vencimiento;

  return (
    <button onClick={() => onAbrir(factura)}
      className="w-full bg-white border border-gray-100 rounded-xl p-3.5 flex items-center gap-3
                 hover:border-gray-200 hover:shadow-sm transition-all text-left">
      <Icn size={15} className="text-gray-300 flex-shrink-0" />

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <p className="text-sm font-semibold text-gray-900 truncate">
          {factura.proveedor_nombre}
        </p>
        <p className="text-xs text-gray-400 tabular-nums truncate">
          {factura.numero_factura || 'Sin N° de factura'}
          {deOrden && factura.orden_numero
            ? ` · OC-${String(factura.orden_numero).padStart(4, '0')}`
            : factura.compra_numero ? ` · compra #${factura.compra_numero}` : ''}
          {factura.fecha_vencimiento ? ` · vence ${formatFecha(factura.fecha_vencimiento)}` : ''}
        </p>
        {/* Solo las de orden pueden estar a medio entregar. Una compra suelta se
            registra cuando la mercancía ya llegó, así que no hay avance que ver. */}
        {deOrden && factura.unidades_pedidas > 0 && (
          <div className="max-w-[180px]">
            <BarraAvance recibidas={factura.unidades_recibidas}
              pedidas={factura.unidades_pedidas} />
          </div>
        )}
      </div>

      <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
        <span className="text-sm font-bold text-gray-900 tabular-nums">
          {formatCOP(factura.saldo)}
        </span>
        {Number(factura.abonado) > 0 && (
          <span className="text-xs text-gray-400 tabular-nums">
            de {formatCOP(factura.valor)}
          </span>
        )}
        {sinPlazo ? (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs
                           font-medium bg-blue-50 text-blue-600 whitespace-nowrap">
            <CalendarClock size={11} /> Poner plazo
          </span>
        ) : (
          <ChipPago estado={factura.estado_pago} dias={factura.dias_para_vencer} />
        )}
      </div>
    </button>
  );
}

export function TabFacturas({ onAbrirAcreedor }) {
  const [filtro,   setFiltro]   = useState('pendientes');
  const [busqueda, setBusqueda] = useState('');
  const [ponerPlazo, setPonerPlazo] = useState(null);

  const sinPlazo = filtro === 'sin_plazo';

  const { data, isLoading } = useQuery({
    queryKey: ['acreedores', 'facturas', filtro],
    // `pagadas=1` solo en "Todas": el resto de vistas son para trabajar, y una
    // lista con las ya pagadas mezcladas deja de servir para decidir a quién
    // pagarle hoy.
    queryFn:  () => getFacturasPorVencer({
      pagadas:   filtro === 'todas' ? '1' : undefined,
      sin_plazo: sinPlazo ? '1' : undefined,
    }).then((r) => r.data.data),
  });

  const todas = data?.items || [];
  const texto = busqueda.trim().toLowerCase();

  const items = todas
    .filter((f) => filtro !== 'vencidas' || f.estado_pago === 'vencida')
    .filter((f) => !texto
      || (f.proveedor_nombre || '').toLowerCase().includes(texto)
      || (f.numero_factura   || '').toLowerCase().includes(texto));

  const resumen = data?.resumen;

  return (
    <div className="flex flex-col gap-3">
      {!sinPlazo && resumen && (resumen.vencidas.cuantas > 0 || resumen.por_vencer.cuantas > 0 || resumen.al_dia.cuantas > 0) && (
        <div className="flex gap-2">
          {resumen.vencidas.cuantas > 0 && (
            <TarjetaResumen titulo="Vencidas" tono="rojo"
              cuantas={resumen.vencidas.cuantas} valor={resumen.vencidas.valor} />
          )}
          {resumen.por_vencer.cuantas > 0 && (
            <TarjetaResumen titulo={`Vencen en ${data.dias_aviso} días o menos`} tono="ambar"
              cuantas={resumen.por_vencer.cuantas} valor={resumen.por_vencer.valor} />
          )}
          {resumen.al_dia.cuantas > 0 && (
            <TarjetaResumen titulo="Más adelante" tono="gris"
              cuantas={resumen.al_dia.cuantas} valor={resumen.al_dia.valor} />
          )}
        </div>
      )}

      <SearchInput value={busqueda} onChange={setBusqueda}
        placeholder="Buscar por proveedor o N° de factura…" />

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        {FILTROS.map((f) => (
          <button key={f.id} onClick={() => setFiltro(f.id)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all
              ${filtro === f.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? <Spinner className="py-20" /> : items.length === 0 ? (
        <EmptyState icon={FileText}
          titulo={filtro === 'vencidas' ? 'Nada vencido'
            : sinPlazo ? 'Todas tienen plazo'
              : 'Sin facturas con plazo'}
          descripcion={filtro === 'vencidas'
            ? 'No le debes nada que ya se haya vencido'
            : sinPlazo
              ? 'Todas las deudas con proveedores tienen su fecha de pago registrada.'
              : 'Aquí aparecen las facturas de proveedor a las que les pusiste plazo de pago, vengan de una orden o de una compra suelta.'} />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {items.map((f) => (
              <FilaFactura key={f.cargo_id} factura={f}
                onAbrir={sinPlazo ? setPonerPlazo : onAbrirAcreedor} />
            ))}
          </div>
          <div className="bg-gray-50 rounded-xl px-3 py-2 flex items-start gap-2">
            <Info size={13} className="text-gray-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-gray-500">
              {sinPlazo
                ? 'Estas deudas no tienen fecha de pago, así que no salen en el semáforo ni en los avisos. Toca una para ponerle el plazo.'
                : 'Toca una factura para abrir la cuenta del proveedor y abonarle.'}
            </p>
          </div>
        </>
      )}

      {ponerPlazo && (
        <ModalPonerPlazo factura={ponerPlazo} onClose={() => setPonerPlazo(null)} />
      )}
    </div>
  );
}
