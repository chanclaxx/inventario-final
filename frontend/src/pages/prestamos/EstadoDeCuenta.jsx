import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getEstadoCuenta,
  anularAbono as anularAbonoApi,
  anularRetomaDirecta as anularRetomaDirectaApi,
} from '../../api/prestamos.api';
import { formatCOP } from '../../utils/formatters';
import { EstadoCuentaBase } from '../../components/EstadoCuenta/EstadoCuentaBase';
import { ModalEditarValorPrestamo } from './ModalEditarValorPrestamo';
import {
  TrendingDown, TrendingUp, ArrowLeftRight, Wallet, Layers, Pencil, AlertTriangle,
} from 'lucide-react';

// lado: 'derecha' = acción del negocio | 'izquierda' = acción del deudor
const TIPO_CONFIG = {
  prestamo: {
    badge:      'bg-orange-100 text-orange-700',
    label:      'Préstamo',
    Icn:        TrendingUp,
    lado:       'derecha',
    bubbleBg:   'bg-amber-50 border border-amber-200',
    montoClass: 'text-amber-700',
  },
  abono: {
    badge:      'bg-green-100 text-green-700',
    label:      'Abono',
    Icn:        TrendingDown,
    lado:       'izquierda',
    bubbleBg:   'bg-white border border-gray-200',
    montoClass: 'text-green-600',
  },
  pago_producto: {
    badge:      'bg-blue-100 text-blue-700',
    label:      'Pago en producto',
    Icn:        ArrowLeftRight,
    lado:       'izquierda',
    bubbleBg:   'bg-white border border-gray-200',
    montoClass: 'text-blue-600',
  },
  saldo_aplicado: {
    badge:      'bg-teal-100 text-teal-700',
    label:      'Saldo aplicado',
    Icn:        Wallet,
    lado:       'izquierda',
    bubbleBg:   'bg-white border border-gray-200',
    montoClass: 'text-teal-600',
  },
  compra_directa: {
    badge:      'bg-purple-100 text-purple-700',
    label:      'Compra de artículo',
    Icn:        ArrowLeftRight,
    lado:       'derecha',
    bubbleBg:   'bg-purple-50 border border-purple-200',
    montoClass: 'text-purple-700',
    sufijo:     '→ saldo a favor',
  },
  abono_total: {
    badge:      'bg-indigo-100 text-indigo-700',
    label:      'Pago total',
    Icn:        Layers,
    lado:       'izquierda',
    bubbleBg:   'bg-indigo-50 border border-indigo-200',
    montoClass: 'text-indigo-700',
  },
  // Mora: mismos colores y textos que en el estado de cuenta de créditos. Son
  // informativos (no mueven el saldo de capital) pero tienen que aparecer: es
  // plata que el cliente pagó o que el negocio dejó de cobrar.
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

// ─── EstadoDeCuenta ───────────────────────────────────────────────────────────

export function EstadoDeCuenta({ tipo, personaId, onEditarAbonoTotal }) {
  const queryClient = useQueryClient();
  const [confirmando, setConfirmando] = useState(null);
  const [editando,    setEditando]    = useState(null);

  const tipoApi = tipo === 'companero' ? 'prestatario' : tipo;

  const { data: movimientos = [], isLoading } = useQuery({
    queryKey:  ['estado-cuenta', tipoApi, personaId],
    queryFn:   () => getEstadoCuenta(tipoApi, personaId).then((r) => r.data.data),
    staleTime: 30_000,
  });

  const mutAnularAbono = useMutation({
    mutationFn: ({ referencia_id, prestamo_id }) =>
      anularAbonoApi(prestamo_id, referencia_id, null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estado-cuenta', tipoApi, personaId] });
      queryClient.invalidateQueries({ queryKey: ['prestamos'], exact: false });
      setConfirmando(null);
    },
    onError: (err) => {
      alert(err.response?.data?.error || 'Error al anular el movimiento');
      setConfirmando(null);
    },
  });

  const mutAnularCompra = useMutation({
    mutationFn: ({ referencia_id }) => anularRetomaDirectaApi(referencia_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estado-cuenta',    tipoApi, personaId] });
      queryClient.invalidateQueries({ queryKey: ['retomas-directas', tipoApi, personaId] });
      queryClient.invalidateQueries({ queryKey: ['prestamos'], exact: false });
      setConfirmando(null);
    },
    onError: (err) => {
      alert(err.response?.data?.error || 'Error al anular la compra');
      setConfirmando(null);
    },
  });

  const confirmarAnulacion = () => {
    if (!confirmando) return;
    if (confirmando.tipo === 'compra_directa') {
      mutAnularCompra.mutate({ referencia_id: confirmando.referencia_id });
    } else {
      mutAnularAbono.mutate({
        referencia_id: confirmando.referencia_id,
        prestamo_id:   confirmando.prestamo_id,
      });
    }
  };

  // La etiqueta explica por qué el movimiento no mueve el saldo, o por qué lo
  // mueve MENOS de lo que dice su monto.
  //
  // El caso que obliga a distinguir es el PAGO TOTAL: la persona pagó una suma
  // y el programa la repartió entre varios préstamos. Si uno de ellos se
  // devolvió, solo esa PARTE deja de contar — la fila sigue mostrando el pago
  // completo (es lo que pagó) pero el saldo baja menos. Sin decirlo, quedan dos
  // números que no cuadran y nada que los explique.
  const getEtiqueta = (mov) => {
    const anuladoParcial = Number(mov.valor_anulado || 0);
    if (mov.anulado_total) return mov.motivo_anulacion || 'Anulado';
    if (anuladoParcial > 0) {
      return `${formatCOP(anuladoParcial)} de este pago no cuenta — ${mov.motivo_anulacion || 'anulado'}`;
    }
    if (mov.prestamo_estado === 'Devuelto') return 'Devuelto';
    return null;
  };

  const getAcciones = (mov) => {
    const acciones = [];
    if (mov.tipo === 'prestamo' && mov.prestamo_estado === 'Activo') {
      acciones.push({
        id: 'editar', Icn: Pencil, title: 'Editar valor',
        onClick: setEditando, hoverClass: 'hover:text-blue-400',
      });
    }
    if (mov.tipo === 'abono_total' && onEditarAbonoTotal) {
      acciones.push({
        id: 'editar-total', Icn: Pencil, title: 'Modificar pago total',
        onClick: onEditarAbonoTotal, hoverClass: 'hover:text-indigo-500',
      });
    }
    return acciones;
  };

  return (
    <EstadoCuentaBase
      movimientos={movimientos}
      isLoading={isLoading}
      tipoConfig={TIPO_CONFIG}
      onAnular={setConfirmando}
      getEtiqueta={getEtiqueta}
      getAcciones={getAcciones}
      labelIzquierda="← Deudor"
      labelDerecha="Negocio →">

      {/* Modal editar valor del préstamo */}
      {editando && (
        <ModalEditarValorPrestamo
          key={editando.referencia_id}
          open
          onClose={() => setEditando(null)}
          mov={editando}
          tipoApi={tipoApi}
          personaId={personaId}
        />
      )}

      {/* Modal confirmación anulación */}
      {confirmando && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 flex flex-col gap-4 shadow-xl">
            <p className="text-sm font-semibold text-gray-800">¿Anular este movimiento?</p>
            <div className="bg-gray-50 rounded-xl px-3 py-2">
              <p className="text-xs text-gray-500">{confirmando.concepto}</p>
              <p className="text-sm font-bold text-gray-800 mt-0.5">
                {formatCOP(confirmando.cargo || confirmando.abono)}
              </p>
            </div>
            {confirmando.tipo === 'compra_directa' && (
              <p className="text-xs text-red-500">
                Se reducirá el saldo a favor en {formatCOP(confirmando.abono)}.
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmando(null)}
                className="flex-1 py-2 rounded-xl text-sm border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
              <button
                onClick={confirmarAnulacion}
                disabled={mutAnularAbono.isPending || mutAnularCompra.isPending}
                className="flex-1 py-2 rounded-xl text-sm bg-red-500 hover:bg-red-600 text-white font-medium transition-colors disabled:opacity-50">
                {(mutAnularAbono.isPending || mutAnularCompra.isPending) ? 'Anulando…' : 'Sí, anular'}
              </button>
            </div>
          </div>
        </div>
      )}
    </EstadoCuentaBase>
  );
}
