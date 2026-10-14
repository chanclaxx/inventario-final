import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tag, ChevronDown, ChevronRight, Info } from 'lucide-react';
import { getPreciosParaCompra } from '../../api/listasPrecios.api';
import { formatCOP } from '../../utils/formatters';
import { InputMoneda } from './InputMoneda';
import { Spinner } from './Spinner';
import {
  productosDeLineas, armarGrupos, valorEnLista, heredadoEnLista, casillaCambiada,
} from '../../utils/preciosCompra';

// ─────────────────────────────────────────────────────────────────────────────
// «Precios de venta» dentro de una compra, un pedido o una recepción.
//
// Sale SOLO con las listas de precios encendidas; si no, no pinta nada y la
// pantalla es la de siempre. Muestra, por cada producto que se está comprando,
// su precio en cada lista —y debajo el de cada talla o color que entra—, y deja
// escribirlo a quien tiene permiso de editar las listas. Sin permiso los ve,
// pero no los cambia (el backend lo exige igual).
//
// No guarda nada por sí sola: lo escrito queda en `ctl` (usePreciosCompra) y la
// pantalla lo guarda al registrar. Las reglas viven en `utils/preciosCompra`.
//
// `lineas` = [{ tipo: 'cantidad'|'serial', producto_id, atributo_id?, variante_id? }]
// ─────────────────────────────────────────────────────────────────────────────
export function PreciosVentaCompra({ ctl, lineas }) {
  const [abierto, setAbierto] = useState(true);
  const productos = productosDeLineas(lineas);
  const hayAlgo = productos.cantidad.length + productos.serial.length > 0;

  const { data = [], isLoading, isError } = useQuery({
    queryKey: ['precios-compra', productos.cantidad.join(','), productos.serial.join(',')],
    queryFn:  () => getPreciosParaCompra(productos).then((r) => r.data.data),
    enabled:  ctl.activo && hayAlgo,
  });

  if (!ctl.activo || !hayAlgo) return null;

  const { listas, cambios, puedeEditar } = ctl;
  const grupos = armarGrupos(lineas, data);
  const editados = ctl.pendientes(lineas).length;
  const Flecha = abierto ? ChevronDown : ChevronRight;

  return (
    <div className="border border-gray-200 rounded-xl p-3 flex flex-col gap-2">
      <button type="button" onClick={() => setAbierto(!abierto)}
        className="flex items-center justify-between gap-2 text-left">
        <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <Tag size={14} className="text-gray-400" /> Precios de venta
          {editados > 0 && (
            <span className="text-xs font-normal text-amber-700 bg-amber-50 border border-amber-200
              rounded-full px-2 py-0.5">
              {editados === 1 ? '1 cambio' : `${editados} cambios`}
            </span>
          )}
        </span>
        <Flecha size={15} className="text-gray-400 flex-shrink-0" />
      </button>

      {abierto && (
        <>
          <p className="flex items-start gap-1.5 text-xs text-gray-500">
            <Info size={12} className="flex-shrink-0 mt-0.5 text-gray-400" />
            {puedeEditar
              ? 'Revisa o escribe el precio de cada lista. Una casilla vacía hereda del producto. Se guardan al registrar.'
              : 'Así se venden hoy. Solo un administrador (o quien tenga el permiso) puede cambiarlos.'}
          </p>

          {isLoading ? <Spinner className="py-4" /> : isError ? (
            <p className="text-xs text-red-500">
              No se pudieron cargar los precios de venta. La compra se puede registrar igual.
            </p>
          ) : grupos.length === 0 ? null : (
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-sm border-separate border-spacing-y-1">
                <thead>
                  <tr>
                    <th className="text-left text-xs font-medium text-gray-400 pb-1 pr-3">Producto</th>
                    {listas.map((l) => (
                      <th key={l.id} className="text-left text-xs font-medium text-gray-500 pb-1 px-1 whitespace-nowrap">
                        {l.nombre}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grupos.flatMap((g) => g.filas).map((fila) => (
                    <tr key={fila.clave}>
                      <td className="pr-3 align-middle">
                        <span
                          className={`block truncate max-w-[200px] ${fila.sangria === 0
                            ? 'text-gray-800 font-medium' : 'text-gray-600'}`}
                          style={{ paddingLeft: `${fila.sangria * 14}px` }}
                          title={fila.etiqueta}>
                          {fila.sangria > 0 && <span className="text-gray-300 mr-1">└</span>}
                          {fila.etiqueta}
                        </span>
                        {Number(fila.precio) > 0 && (
                          <span className="block text-xs text-gray-400 tabular-nums"
                            style={{ paddingLeft: `${fila.sangria * 14}px` }}>
                            normal {formatCOP(Number(fila.precio))}
                          </span>
                        )}
                      </td>
                      {listas.map((l) => {
                        const heredado = heredadoEnLista(fila.cadena, l.id, cambios);
                        const valor    = valorEnLista(fila, l.id, cambios);
                        if (!puedeEditar) {
                          return (
                            <td key={l.id} className="px-1 align-middle text-sm tabular-nums whitespace-nowrap">
                              {Number(valor) > 0
                                ? <span className="text-gray-800">{formatCOP(Number(valor))}</span>
                                : heredado != null
                                  ? <span className="text-gray-400">{formatCOP(heredado)}</span>
                                  : <span className="text-gray-300">—</span>}
                            </td>
                          );
                        }
                        const cambiada = casillaCambiada(fila, l.id, cambios);
                        return (
                          <td key={l.id} className="px-1 align-middle">
                            <InputMoneda
                              value={valor}
                              onChange={(v) => ctl.cambiar(fila, l.id, v)}
                              placeholder={heredado != null ? formatCOP(heredado) : 'Sin precio'}
                              className={`w-28 text-right text-sm text-gray-800 rounded-lg px-2 py-1.5 border
                                focus:outline-none focus:ring-2 focus:ring-blue-500
                                ${cambiada ? 'bg-amber-50 border-amber-300' : 'bg-white border-gray-200'}`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default PreciosVentaCompra;
