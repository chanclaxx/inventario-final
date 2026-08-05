import { useQuery } from '@tanstack/react-query';
import { getEstadoCuentaCredito } from '../../api/creditos.api';
import { EstadoCuentaBase } from '../../components/EstadoCuenta/EstadoCuentaBase';
import { FileText, TrendingDown, RotateCcw, Wallet, AlertTriangle, HandCoins } from 'lucide-react';

/**
 * Estado de cuenta de un cliente a crédito.
 *
 * Usa la misma vista que Préstamos (EstadoCuentaBase) y los mismos movimientos
 * que consumen el PDF y el Excel, calculados por creditos.service en el backend.
 *
 * lado: 'derecha' = lo que hace el negocio | 'izquierda' = lo que hace el cliente
 */
const TIPO_CONFIG_CREDITO = {
  credito: {
    badge:      'bg-orange-100 text-orange-700',
    label:      'Factura',
    Icn:        FileText,
    lado:       'derecha',
    bubbleBg:   'bg-amber-50 border border-amber-200',
    montoClass: 'text-amber-700',
  },
  cuota_inicial: {
    badge:      'bg-blue-100 text-blue-700',
    label:      'Cuota inicial',
    Icn:        Wallet,
    lado:       'izquierda',
    bubbleBg:   'bg-white border border-gray-200',
    montoClass: 'text-blue-600',
  },
  abono: {
    badge:      'bg-green-100 text-green-700',
    label:      'Abono',
    Icn:        TrendingDown,
    lado:       'izquierda',
    bubbleBg:   'bg-white border border-gray-200',
    montoClass: 'text-green-600',
  },
  devolucion: {
    badge:      'bg-orange-100 text-orange-600',
    label:      'Devolución',
    Icn:        RotateCcw,
    lado:       'izquierda',
    bubbleBg:   'bg-orange-50 border border-orange-200',
    montoClass: 'text-orange-600',
    sufijo:     'baja la deuda',
  },
  ajuste: {
    badge:      'bg-purple-100 text-purple-700',
    label:      'Ajuste',
    Icn:        HandCoins,
    lado:       'izquierda',
    bubbleBg:   'bg-purple-50 border border-purple-200',
    montoClass: 'text-purple-700',
  },
  mora_cobro: {
    badge:      'bg-red-100 text-red-700',
    label:      'Mora cobrada',
    Icn:        AlertTriangle,
    lado:       'izquierda',
    bubbleBg:   'bg-red-50 border border-red-200',
    montoClass: 'text-red-600',
    sufijo:     'aparte del capital',
  },
  mora_condonacion: {
    badge:      'bg-gray-100 text-gray-600',
    label:      'Mora condonada',
    Icn:        AlertTriangle,
    lado:       'derecha',
    bubbleBg:   'bg-gray-50 border border-gray-200',
    montoClass: 'text-gray-500',
    sufijo:     'aparte del capital',
  },
  interes_cobro: {
    badge:      'bg-teal-100 text-teal-700',
    label:      'Interés cobrado',
    Icn:        AlertTriangle,
    lado:       'izquierda',
    bubbleBg:   'bg-teal-50 border border-teal-200',
    montoClass: 'text-teal-700',
    sufijo:     'aparte del capital',
  },
  interes_condonacion: {
    badge:      'bg-gray-100 text-gray-600',
    label:      'Interés condonado',
    Icn:        AlertTriangle,
    lado:       'derecha',
    bubbleBg:   'bg-gray-50 border border-gray-200',
    montoClass: 'text-gray-500',
    sufijo:     'aparte del capital',
  },
};

export function EstadoCuentaCredito({ clave }) {
  const { data: movimientos = [], isLoading } = useQuery({
    queryKey:  ['estado-cuenta-credito', clave],
    queryFn:   () => getEstadoCuentaCredito(clave).then((r) => r.data.data),
    enabled:   !!clave,
    staleTime: 30_000,
  });

  // Una factura anulada queda como constancia pero no arrastra deuda: el
  // backend le pone `saldo: null` y aquí se marca para que se entienda por qué.
  const getEtiqueta = (mov) => (mov.credito_estado === 'Cancelado' ? 'Anulada' : null);

  return (
    <EstadoCuentaBase
      movimientos={movimientos}
      isLoading={isLoading}
      tipoConfig={TIPO_CONFIG_CREDITO}
      getEtiqueta={getEtiqueta}
      labelIzquierda="← Cliente"
      labelDerecha="Negocio →"
      vacioTexto="Sin movimientos de crédito registrados"
    />
  );
}
