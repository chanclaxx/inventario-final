import { useMemo } from 'react';
import { EstadoCuentaBase } from '../../components/EstadoCuenta/EstadoCuentaBase';
import {
  Truck, Wallet, Undo2, TrendingDown, SlidersHorizontal, Receipt, Filter,
} from 'lucide-react';

/**
 * Estado de cuenta del local con la bodega.
 *
 * Usa la MISMA vista que Créditos y Préstamos (`EstadoCuentaBase`): filtros por
 * fecha y por tipo, cuadrícula o conversación, paginación y saldo corrido. Antes
 * esta pantalla tenía su propia lista, que era la tercera forma distinta de
 * mostrar lo mismo en la aplicación.
 *
 * lado: 'derecha' = lo que hace la BODEGA | 'izquierda' = lo que hace el LOCAL
 */
const TIPO_CONFIG_BODEGA = {
  envio: {
    badge:      'bg-amber-100 text-amber-700',
    label:      'Envío',
    Icn:        Truck,
    lado:       'derecha',
    bubbleBg:   'bg-amber-50 border border-amber-200',
    montoClass: 'text-amber-700',
  },
  pago: {
    badge:      'bg-green-100 text-green-700',
    label:      'Pago',
    Icn:        Wallet,
    lado:       'izquierda',
    bubbleBg:   'bg-white border border-gray-200',
    montoClass: 'text-green-600',
  },
  devolucion: {
    badge:      'bg-blue-100 text-blue-700',
    label:      'Devolución',
    Icn:        Undo2,
    lado:       'izquierda',
    bubbleBg:   'bg-blue-50 border border-blue-200',
    montoClass: 'text-blue-600',
    sufijo:     'baja la deuda',
  },
  gasto: {
    badge:      'bg-teal-100 text-teal-700',
    label:      'Gasto',
    Icn:        TrendingDown,
    lado:       'izquierda',
    bubbleBg:   'bg-white border border-gray-200',
    montoClass: 'text-teal-700',
    sufijo:     'por cuenta de bodega',
  },
  ajuste: {
    badge:      'bg-purple-100 text-purple-700',
    label:      'Ajuste',
    Icn:        SlidersHorizontal,
    lado:       'derecha',
    bubbleBg:   'bg-purple-50 border border-purple-200',
    montoClass: 'text-purple-700',
  },
  venta: {
    badge:      'bg-gray-100 text-gray-600',
    label:      'Venta',
    Icn:        Receipt,
    lado:       'izquierda',
    bubbleBg:   'bg-white border border-gray-200',
    montoClass: 'text-gray-400',
    sufijo:     'no mueve la cuenta',
  },
  correccion: {
    badge:      'bg-gray-100 text-gray-600',
    label:      'Corrección',
    Icn:        Filter,
    lado:       'derecha',
    bubbleBg:   'bg-gray-50 border border-gray-200',
    montoClass: 'text-gray-500',
  },
};

// El extracto del backend habla de `clase` (cargo/abono/info) y `origen`.
// Aquí se traduce al vocabulario de EstadoCuentaBase (tipo + cargo/abono).
const TIPO_POR_ORIGEN = {
  remision:   'envio',
  devolucion: 'devolucion',
  remesa:     'pago',
  gasto:      'gasto',
  ajuste:     'ajuste',
  venta:      'venta',
  correccion: 'correccion',
};

export function EstadoCuentaBodega({ extracto = [], isLoading = false }) {
  const movimientos = useMemo(() => {
    // El backend devuelve del más reciente al más viejo; EstadoCuentaBase
    // espera ASCENDENTE (toma el saldo del último para el saldo final y él
    // mismo invierte cuando el usuario pide "más reciente primero").
    const asc = [...extracto].reverse();

    return asc.map((e, i) => {
      const esInfo  = e.clase === 'info';
      const esCargo = e.clase === 'cargo';
      const valor   = Math.abs(Number(e.valor || 0));

      return {
        fecha: e.fecha,
        tipo:  TIPO_POR_ORIGEN[e.origen] || 'ajuste',
        concepto: [
          e.concepto,
          e.documento  ? `#${e.documento}` : null,
          e.tercero    ? `· ${e.tercero}`  : null,
        ].filter(Boolean).join(' '),
        descripcion: [e.referencia, e.detalle].filter(Boolean).join(' · ') || null,
        cargo: !esInfo && esCargo ? valor : null,
        abono: !esInfo && !esCargo ? valor : null,
        // Los informativos (una venta, una corrección) NO entran al acumulado:
        // así el saldo final sale del último movimiento que sí es plata.
        saldo: esInfo ? null : Number(e.saldo),
        referencia_id: `${e.origen}-${i}`,
        anulable: false,
      };
    });
  }, [extracto]);

  return (
    <EstadoCuentaBase
      movimientos={movimientos}
      isLoading={isLoading}
      tipoConfig={TIPO_CONFIG_BODEGA}
      labelIzquierda="← Local"
      labelDerecha="Bodega →"
      vacioTexto="Sin movimientos con la bodega todavía"
    />
  );
}
