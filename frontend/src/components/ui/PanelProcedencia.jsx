import { useQuery } from '@tanstack/react-query';
import { getProcedenciaProducto, getProcedenciaImei } from '../../api/ordenesCompra.api';
import { formatCOP, formatFecha } from '../../utils/formatters';
import { Spinner }    from './Spinner';
import { EmptyState } from './EmptyState';
import { ChipGarantia } from '../../pages/proveedores/indicadoresOrden';
import { Truck, PackageSearch, Info } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// PROCEDENCIA — "salió un lote malo, ¿de quién vino?"
//
// La respuesta depende del tipo de producto:
//
//   · CON IMEI → trazabilidad exacta. La unidad identifica a su proveedor.
//   · POR CANTIDAD → las unidades son fungibles. El stock es un entero y el
//     costo un promedio: el modelo NO puede saber de qué compra salió la unidad
//     47, y rastrear lotes obligaría a romper el modelo de stock y de costo con
//     riesgo sobre el punto de venta.
//
// Por eso este panel NUNCA adivina. El proveedor marca físicamente la mercancía,
// así que quien tiene el producto dañado en la mano ya sabe de quién es; lo que
// no sabe es cuándo lo compró, a qué precio y si la garantía sigue viva. El
// panel lista los candidatos ordenados por fecha y deja que la persona elija.
// Adivinar produciría un reclamo dirigido al proveedor equivocado.
//
// No está detrás de ningún flag: lee historia de compras que todos los negocios
// ya tienen registrada.
// ─────────────────────────────────────────────────────────────────────────────

function FilaEntrada({ entrada, mostrarGarantia }) {
  // Una entrada devuelta por completo se atenúa pero NO se oculta: sigue
  // sirviendo para rastrear de dónde vino algo que ya no está.
  const anulada = Number(entrada.cantidad_neta) === 0 && Number(entrada.cantidad_devuelta) > 0;

  return (
    <div className={`flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0
      ${anulada ? 'opacity-60' : ''}`}>
      <Truck size={14} className="text-gray-300 flex-shrink-0 mt-0.5" />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{entrada.proveedor_nombre}</p>
        <p className="text-xs text-gray-400 tabular-nums">
          {formatFecha(entrada.fecha)}
          {entrada.numero_factura && ` · ${entrada.numero_factura}`}
          {entrada.cantidad != null && ` · ${entrada.cantidad} uds a ${formatCOP(entrada.precio_unitario)}`}
          {Number(entrada.cantidad_devuelta) > 0 && ` · ${entrada.cantidad_devuelta} devueltas`}
        </p>
        {entrada.orden_numero && (
          <p className="text-xs text-gray-300 tabular-nums">
            OC-{String(entrada.orden_numero).padStart(4, '0')}
          </p>
        )}
      </div>

      {mostrarGarantia && (
        <div className="flex-shrink-0">
          <ChipGarantia estado={entrada.estado} dias={entrada.dias_restantes} />
        </div>
      )}
    </div>
  );
}

function Resumen({ proveedores }) {
  if (!proveedores?.length) return null;

  return (
    <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-2">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        Por proveedor
      </p>
      {proveedores.map((p) => (
        <div key={p.proveedor_id} className="flex items-center justify-between gap-3">
          <span className="text-sm text-gray-700 truncate">{p.proveedor_nombre}</span>
          <span className="text-xs text-gray-400 tabular-nums flex-shrink-0">
            {p.unidades} uds
            {Number(p.devueltas) > 0 && ` · ${p.devueltas} devueltas`}
            {` · ${formatFecha(p.ultima_compra)}`}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Procedencia de un producto por cantidad.
 * `productoId` es el id de `productos_cantidad`.
 */
export function PanelProcedencia({ productoId, mostrarGarantia = false }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['procedencia', 'producto', productoId],
    queryFn:  () => getProcedenciaProducto(productoId).then((r) => r.data.data),
    enabled:  Boolean(productoId),
  });

  if (isLoading) return <Spinner className="py-10" />;
  if (error) {
    return (
      <p className="text-xs text-gray-400 text-center py-6">
        No se pudo cargar la procedencia
      </p>
    );
  }

  const entradas = data?.entradas || [];

  if (entradas.length === 0) {
    return (
      <EmptyState icon={PackageSearch} titulo="Sin compras registradas"
        descripcion="Este producto no tiene entradas de proveedor. Puede haber entrado por ajuste de stock, traslado o retoma." />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-blue-50 rounded-xl px-3 py-2 flex items-start gap-2">
        <Info size={13} className="text-blue-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-blue-700">
          Estas son las compras de este producto, de la más reciente a la más vieja.
          Compara con el sello del proveedor en la unidad dañada para saber cuál es.
        </p>
      </div>

      <Resumen proveedores={data.proveedores} />

      <div className="flex flex-col">
        {entradas.map((e) => (
          <FilaEntrada key={e.linea_id} entrada={e} mostrarGarantia={mostrarGarantia} />
        ))}
      </div>
    </div>
  );
}

/**
 * Procedencia de una unidad con IMEI. Aquí no hay que adivinar nada: el equipo
 * identifica a su proveedor sin ambigüedad.
 *
 * `entrada_vigente` la resuelve el backend: un mismo IMEI puede haber entrado
 * varias veces (retoma, re-import correctivo) y la garantía que cuenta es la de
 * la ÚLTIMA entrada. Las anteriores son historia.
 */
export function PanelProcedenciaImei({ imei, mostrarGarantia = false }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['procedencia', 'imei', imei],
    queryFn:  () => getProcedenciaImei(imei).then((r) => r.data.data),
    enabled:  Boolean(imei),
  });

  if (isLoading) return <Spinner className="py-10" />;
  if (error) {
    return (
      <p className="text-xs text-gray-400 text-center py-6">
        No se pudo cargar la procedencia de este equipo
      </p>
    );
  }

  const entradas = data?.entradas || [];
  const vigente  = data?.entrada_vigente;

  return (
    <div className="flex flex-col gap-3">
      {vigente ? (
        <div className="bg-white border border-gray-100 rounded-xl p-3 flex flex-col gap-1">
          <p className="text-xs text-gray-400">Se lo compraste a</p>
          <p className="text-sm font-semibold text-gray-900">{vigente.proveedor_nombre}</p>
          <p className="text-xs text-gray-400 tabular-nums">
            {formatFecha(vigente.fecha)}
            {vigente.numero_factura && ` · ${vigente.numero_factura}`}
            {` · ${formatCOP(vigente.precio_unitario)}`}
          </p>
          {mostrarGarantia && (
            <div className="pt-1">
              <ChipGarantia estado={vigente.estado} dias={vigente.dias_restantes} />
            </div>
          )}
        </div>
      ) : (
        <div className="bg-gray-50 rounded-xl px-3 py-2.5 flex items-start gap-2">
          <Info size={13} className="text-gray-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-gray-500">
            Este equipo no entró por una compra a proveedor. Pudo llegar como retoma de
            un cliente o por traslado, y en ese caso no hay a quién reclamarle.
          </p>
        </div>
      )}

      {entradas.length > 1 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Entradas anteriores
          </p>
          <div className="flex flex-col">
            {entradas.slice(1).map((e) => (
              <FilaEntrada key={e.linea_id} entrada={e} mostrarGarantia={mostrarGarantia} />
            ))}
          </div>
          <p className="text-xs text-gray-300">
            El mismo equipo puede haber entrado varias veces (una retoma, una corrección).
            La garantía que cuenta es la de la entrada más reciente.
          </p>
        </div>
      )}
    </div>
  );
}
