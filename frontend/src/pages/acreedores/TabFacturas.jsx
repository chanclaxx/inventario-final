import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getFacturasPorVencer } from '../../api/acreedores.api';
import { formatCOP, formatFecha } from '../../utils/formatters';
import { Spinner }     from '../../components/ui/Spinner';
import { EmptyState }  from '../../components/ui/EmptyState';
import { SearchInput } from '../../components/ui/SearchInput';
import { ChipPago, BarraAvance } from '../proveedores/indicadoresOrden';
import { FileText, ClipboardList, ShoppingCart, Info } from 'lucide-react';

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
  { id: 'todas',      label: 'Todas'     },
];

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

function FilaFactura({ factura, onAbrirAcreedor }) {
  const deOrden = factura.origen === 'orden';
  const Icn     = deOrden ? ClipboardList : ShoppingCart;

  return (
    <button onClick={() => onAbrirAcreedor(factura)}
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
        <ChipPago estado={factura.estado_pago} dias={factura.dias_para_vencer} />
      </div>
    </button>
  );
}

export function TabFacturas({ onAbrirAcreedor }) {
  const [filtro,   setFiltro]   = useState('pendientes');
  const [busqueda, setBusqueda] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['acreedores', 'facturas', filtro],
    // `pagadas=1` solo en "Todas": el resto de vistas son para trabajar, y una
    // lista con las ya pagadas mezcladas deja de servir para decidir a quién
    // pagarle hoy.
    queryFn:  () => getFacturasPorVencer({ pagadas: filtro === 'todas' ? '1' : undefined })
      .then((r) => r.data.data),
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
      {resumen && (resumen.vencidas.cuantas > 0 || resumen.por_vencer.cuantas > 0 || resumen.al_dia.cuantas > 0) && (
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
          titulo={filtro === 'vencidas' ? 'Nada vencido' : 'Sin facturas con plazo'}
          descripcion={filtro === 'vencidas'
            ? 'No le debes nada que ya se haya vencido'
            : 'Aquí aparecen las facturas de proveedor a las que les pusiste plazo de pago, vengan de una orden o de una compra suelta.'} />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {items.map((f) => (
              <FilaFactura key={f.cargo_id} factura={f} onAbrirAcreedor={onAbrirAcreedor} />
            ))}
          </div>
          <div className="bg-gray-50 rounded-xl px-3 py-2 flex items-start gap-2">
            <Info size={13} className="text-gray-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-gray-500">
              Toca una factura para abrir la cuenta del proveedor y abonarle.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
