import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { crearCompra } from '../../api/compras.api';
import { getArbol }    from '../../api/variantesProductoApi';
import { formatCOP }   from '../../utils/formatters';
import { Modal }       from '../../components/ui/Modal';
import { Button }      from '../../components/ui/Button';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { useMetodosPago } from '../../hooks/useMetodosPago';
import { FilaImeiCompra, MultiSelectorCompra } from './capturaMercancia';
import {
  hojasDelArbol, extraerImei, extraerColor, extraerCaracteristicas,
  itemSerialVacio,
} from './capturaMercancia.utils';
import api from '../../api/axios.config';
import {
  Package, Smartphone, Minus, Plus, PackageCheck, AlertTriangle, ShieldCheck, Layers,
  Replace, PackagePlus, Trash2,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// RECIBIR MERCANCÍA CONTRA UNA ORDEN
//
// La pantalla que define si toda la feature se usa o no. Cinco decisiones la
// sostienen:
//
//   1. PRECARGADA, no vacía. Cada línea trae lo que falta. El caso normal
//      (llegó todo) es tocar un botón; recibir parcial es bajar un número.
//   2. UN SOLO NÚMERO por línea. No hay "recibido / aceptado / rechazado": lo
//      que no llegó queda pendiente, y punto.
//   3. El faltante NO PIDE EXPLICACIÓN. Se registra solo.
//   4. La garantía se HEREDA Y SE CALLA. Visible, editable, jamás obligatoria.
//   5. Al confirmar se llama a `POST /compras`. El usuario cree que "recibió";
//      el sistema hace exactamente lo que ya hacía —inventario, costo promedio,
//      deuda con el proveedor— con el mismo código probado.
//
// ── Adaptable a la configuración del negocio ─────────────────────────────────
// La ORDEN pide producto y cantidad. El detalle se resuelve AQUÍ, porque es
// cuando se conoce: el IMEI solo existe al abrir la caja, y el color que llega
// no siempre es el que se pidió.
//
//   · `colores_serial_activo` / `caracteristicas_serial_activo` → cada IMEI
//     lleva su color y sus características, con los MISMOS campos que una
//     compra normal (componente compartido, no una copia).
//   · `variantes_activo` + el producto tiene árbol → se reparte la cantidad
//     entre variantes. Esto NO es cosmético: el stock de un producto con
//     variantes es la SUMA de sus hojas, así que escribirlo en el padre lo
//     borra la siguiente sincronización.
//
// Un negocio sin nada de esto activado ve exactamente lo de antes: una casilla
// de IMEI o un contador de cantidad.
//
// ── Los dos desenlaces raros, cada uno a un clic ────────────────────────────
// Cuando la orden pidio una VARIANTE concreta, esta pantalla ya no compara
// cantidades a ciegas: compara contra lo que se pidio.
//
//   · LLEGO OTRA  → "Llego otra variante" abre las hojas del arbol. La linea
//     sigue respondiendo al mismo pedido (el proveedor respondio) pero entra al
//     nodo que de verdad llego, y queda como novedad del proveedor. Antes esto
//     pasaba EN SILENCIO: el stock entraba bien y el pedido se marcaba cumplido
//     sin que nadie supiera que llego otra cosa.
//
//   · LLEGARON DE MAS → antes era un 400 seco que mandaba a "registrarlas como
//     compra aparte". Ahora se puede recibir el sobrante marcando una casilla, o
//     dejar el numero en lo pendiente y devolverselas al proveedor.
//
//   · LLEGO UNA QUE NO PEDISTE → se pidieron 50 blancos y 50 verdes y ademas
//     llegaron 20 rosados. Ni sustitucion (nadie dejo de mandar lo pedido) ni
//     exceso de una linea (no hay linea de rosado): entra en LA MISMA recepcion
//     como linea suelta, sin orden_linea_id, y queda como novedad del proveedor.
//     El selector excluye los nodos que ya estan en la recepcion, porque dos
//     lineas del mismo nodo se sumarian y nadie sabria por que.
//
// Las dos exigen un si explicito: el backend responde 409 sin el flag, asi que
// no hay forma de que ninguna de las dos ocurra por accidente.
// ─────────────────────────────────────────────────────────────────────────────

function parsearLista(raw) {
  try {
    const lista = JSON.parse(raw || '[]');
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

// El rotulo del nodo que pidio la orden. `getLineas` ya resuelve los valores y
// el nombre del tipo; aqui solo se arman. Devuelve null cuando la linea pidio el
// producto completo, que es lo que hacen hoy los 28 negocios.
const nodoPedido = (linea) => {
  if (linea.variante_id) {
    return {
      key: `v-${linea.variante_id}`, variante_id: linea.variante_id, atributo_id: null,
      label: linea.variante_tipo_nombre
        ? `${linea.variante_tipo_nombre}: ${linea.variante_valor}` : linea.variante_valor,
    };
  }
  if (linea.atributo_id) {
    return {
      key: `a-${linea.atributo_id}`, variante_id: null, atributo_id: linea.atributo_id,
      label: linea.atributo_tipo_nombre
        ? `${linea.atributo_tipo_nombre}: ${linea.atributo_valor}` : linea.atributo_valor,
    };
  }
  return null;
};

function Stepper({ valor, max, onCambiar, disabled, techo }) {
  const n = Number(valor) || 0;
  // `techo` es el tope duro; `max` es solo lo pendiente. Separarlos es lo que
  // permite teclear de mas para despues decidir si se recibe o se devuelve: un
  // input que no deja escribir el numero real obliga a mentir.
  const limite = techo ?? max;
  const set = (v) => onCambiar(String(Math.max(0, Math.min(limite, v))));

  return (
    <div className={`flex items-stretch border border-gray-200 rounded-lg overflow-hidden bg-gray-50
      ${disabled ? 'opacity-40' : ''}`}>
      <button type="button" disabled={disabled || n <= 0} onClick={() => set(n - 1)}
        aria-label="Quitar uno"
        className="w-9 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors
                   disabled:opacity-30 disabled:hover:bg-transparent">
        <Minus size={14} className="mx-auto" />
      </button>
      <input type="number" min="0" max={limite} value={valor} disabled={disabled}
        onChange={(e) => set(Number(e.target.value))}
        className={`flex-1 w-14 text-center text-sm font-semibold tabular-nums bg-white
                   border-x border-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400
                   ${n > max ? 'text-purple-700' : ''}`} />
      <button type="button" disabled={disabled || n >= limite} onClick={() => set(n + 1)}
        aria-label="Agregar uno"
        className="w-9 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors
                   disabled:opacity-30 disabled:hover:bg-transparent">
        <Plus size={14} className="mx-auto" />
      </button>
    </div>
  );
}

// ── Campos comunes al pie de una línea recibida ──────────────────────────────
function PrecioYGarantia({ linea, estado, onCambiar, garantiaActiva, ocultarPrecio }) {
  return (
    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-100">
      {!ocultarPrecio && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-400">Precio real</label>
          <InputMoneda value={estado.precio} onChange={(v) => onCambiar('precio', v)} placeholder="0"
            className="w-full px-2.5 py-1.5 text-sm tabular-nums border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400" />
          {linea.precio_estimado != null && Number(linea.precio_estimado) > 0
            && Number(estado.precio) > 0
            && Math.abs(Number(estado.precio) - Number(linea.precio_estimado)) > 0.5 && (
            <span className="text-xs text-amber-600">
              Cotizaste {formatCOP(linea.precio_estimado)}
            </span>
          )}
        </div>
      )}
      {garantiaActiva && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-400 flex items-center gap-1">
            <ShieldCheck size={11} className="text-gray-300" /> Garantía
          </label>
          <div className="flex items-center gap-1.5">
            <input type="number" min="0" max="3650" value={estado.garantia}
              placeholder="—"
              onChange={(e) => onCambiar('garantia', e.target.value)}
              className="w-16 px-2 py-1.5 text-sm text-right tabular-nums border border-gray-200 rounded-lg
                         focus:outline-none focus:ring-1 focus:ring-blue-400" />
            <span className="text-xs text-gray-400">días</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Línea de producto con IMEI ───────────────────────────────────────────────
//
// La cantidad recibida NO se teclea: sale de cuántos IMEI se capturaron. No hay
// forma de decir "llegaron 5" sin decir cuáles son, que es justamente lo que
// hace que el inventario de seriales cuadre.
function FilaSerial({ linea, estado, onCambiar, garantiaActiva, cfg }) {
  const pendiente = Number(linea.pendiente);
  const items     = estado.imeis || [];
  const validos   = items.filter((i) => extraerImei(i).trim()).length;

  const nuevoItem = () => itemSerialVacio(
    cfg.coloresActivo, cfg.caracteristicasActivo, cfg.caracteristicasLista
  );

  const cambiarItem = (idx, valor) => {
    const copia = [...items];
    copia[idx] = valor;
    onCambiar('imeis', copia);
  };

  const agregar  = () => onCambiar('imeis', [...items, nuevoItem()]);
  const eliminar = (idx) => {
    const copia = items.filter((_, i) => i !== idx);
    onCambiar('imeis', copia.length ? copia : [nuevoItem()]);
  };

  // Duplicados dentro de esta misma recepción. Los que ya están en el
  // inventario los rechaza el backend con su mensaje propio.
  const vistos = new Map();
  for (const it of items) {
    const v = extraerImei(it).trim().toUpperCase();
    if (v) vistos.set(v, (vistos.get(v) || 0) + 1);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        {items.map((item, idx) => {
          const v = extraerImei(item).trim().toUpperCase();
          return (
            <FilaImeiCompra
              key={idx}
              index={idx}
              item={item}
              coloresActivo={cfg.coloresActivo}
              coloresConfig={cfg.coloresLista}
              caracteristicasActivo={cfg.caracteristicasActivo}
              caracteristicasLista={cfg.caracteristicasLista}
              esDuplicado={Boolean(v) && vistos.get(v) > 1}
              onChange={(valor) => cambiarItem(idx, valor)}
              onEliminar={() => eliminar(idx)}
              mostrarEliminar={items.length > 1}
            />
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={agregar} disabled={items.length >= pendiente}
          className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors
                     disabled:text-gray-300 disabled:cursor-not-allowed">
          + Otro equipo
        </button>
        <span className="text-xs text-gray-400 tabular-nums">
          {validos} de {pendiente} capturados
        </span>
      </div>

      {validos > 0 && (
        <PrecioYGarantia linea={linea} estado={estado} onCambiar={onCambiar}
          garantiaActiva={garantiaActiva} />
      )}
    </div>
  );
}

// ── Línea de producto por cantidad ───────────────────────────────────────────
//
// Con variantes activas y árbol, la cantidad se reparte entre las hojas: el
// stock de un producto con variantes es la suma de ellas, y escribirlo en el
// padre se pierde en la siguiente sincronización. Cada hoja lleva su propio
// costo, así que el precio de la línea sobra en ese caso.
function FilaCantidad({
  linea, estado, onCambiar, garantiaActiva, variantesActivo, sucursalId,
  extras, onAgregarExtra, onQuitarExtra, nodosUsados,
}) {
  const pendiente = Number(linea.pendiente);

  const { data: arbolData = [] } = useQuery({
    queryKey: ['arbol-producto', linea.producto_id, sucursalId],
    queryFn:  () => getArbol(linea.producto_id, sucursalId).then((r) => r.data.data),
    enabled:  variantesActivo && Boolean(linea.producto_id) && Boolean(sucursalId),
    staleTime: 0,
  });

  const hojas      = variantesActivo ? hojasDelArbol(arbolData) : [];
  const tieneArbol = hojas.length > 0;
  const pedido     = nodoPedido(linea);

  // ── La orden pidio una VARIANTE concreta ──────────────────────────────────
  //
  // No se reparte nada: ya se sabe QUE se pidio, asi que la pregunta se reduce a
  // "¿llego eso, y cuanto?". Repartir aqui obligaria a volver a elegir la
  // variante que la orden ya dijo — y volveria a abrir la puerta a que llegara
  // otra cosa sin que nadie lo notara.
  if (pedido) {
    const sust      = estado.nodoSust || null;          // la que llego, si es otra
    const recibidas = Number(estado.cantidad || 0);
    const sobra     = Math.max(0, recibidas - pendiente);
    const nodoLabel = sust ? `${sust.labelPadre ? `${sust.labelPadre} · ` : ''}${sust.label}` : pedido.label;

    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 min-w-0">
            <Layers size={12} className="text-purple-400 flex-shrink-0" />
            <span className={`text-xs truncate ${sust ? 'text-purple-700 font-medium' : 'text-gray-500'}`}>
              {nodoLabel}
            </span>
            {sust && <span className="text-xs text-purple-500 flex-shrink-0">en vez de {pedido.label}</span>}
          </div>
          <div className="w-36">
            {/* El techo deja teclear hasta el doble de lo pendiente: escribir el
                numero real es el primer paso para decidir que hacer con el
                sobrante, y un input que no lo permite obliga a mentir. */}
            <Stepper valor={estado.cantidad} max={pendiente} techo={pendiente * 2 + 10}
              onCambiar={(v) => onCambiar('cantidad', v)} />
            <span className="block text-xs text-gray-400 text-center mt-1 tabular-nums">
              {sobra > 0        ? `sobran ${sobra}`
                : recibidas === pendiente ? 'completa'
                  : recibidas === 0       ? 'no llegó'
                    : `faltarán ${pendiente - recibidas}`}
            </span>
          </div>
        </div>

        {/* ── Llego otra variante ─────────────────────────────────────────── */}
        {tieneArbol && (
          <div className="flex flex-col gap-1.5">
            {!estado.eligiendoNodo ? (
              <button type="button" onClick={() => onCambiar('eligiendoNodo', true)}
                className="flex items-center gap-1.5 text-xs font-medium text-purple-600
                           hover:text-purple-700 transition-colors w-fit">
                <Replace size={12} /> {sust ? 'Cambiar la variante que llegó' : 'Llegó otra variante'}
              </button>
            ) : (
              <div className="border border-purple-200 bg-purple-50/40 rounded-lg p-2 flex flex-col gap-1">
                <p className="text-xs text-purple-700">¿Cuál llegó de verdad?</p>
                <div className="max-h-36 overflow-y-auto flex flex-col gap-0.5">
                  {hojas.map((h) => {
                    const esPedida = h.key === pedido.key;
                    return (
                      <button key={h.key} type="button"
                        onClick={() => {
                          onCambiar('nodoSust', esPedida ? null : h);
                          onCambiar('eligiendoNodo', false);
                        }}
                        className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md
                                   text-left text-xs text-gray-700 hover:bg-white transition-colors">
                        <span className="truncate">
                          {h.labelPadre ? `${h.labelPadre} · ` : ''}{h.label}
                        </span>
                        {esPedida && <span className="text-gray-400 flex-shrink-0">la que pediste</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Se explica lo que va a pasar ANTES de confirmar. La linea sigue
                respondiendo al pedido —el proveedor respondio— pero queda
                anotado que respondio con otra cosa. */}
            {sust && (
              <p className="text-xs text-purple-600">
                Se recibe {nodoLabel} contra lo que pediste. Queda anotado como
                novedad del proveedor.
              </p>
            )}
          </div>
        )}

        {/* ── Llego una que NO se pidio ───────────────────────────────────── */}
        {tieneArbol && (
          <div className="flex flex-col gap-1.5">
            {(extras || []).map((ex) => (
              <div key={ex.key}
                className="flex items-center gap-2 border border-amber-200 bg-amber-50/40
                           rounded-lg px-2.5 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-amber-800 truncate">{ex.label}</p>
                  <p className="text-xs text-amber-600">no venía en el pedido</p>
                </div>
                <input type="number" min="1" value={ex.cantidad}
                  onChange={(e) => onAgregarExtra({ ...ex, cantidad: Math.max(1, Number(e.target.value) || 1) })}
                  className="w-16 px-2 py-1 text-sm text-center tabular-nums bg-white
                             border border-amber-200 rounded-lg focus:outline-none
                             focus:ring-1 focus:ring-amber-400" />
                <button type="button" onClick={() => onQuitarExtra(ex.key)}
                  className="p-1 rounded-lg text-amber-400 hover:text-red-500 hover:bg-red-50
                             transition-colors flex-shrink-0">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}

            {!estado.agregandoExtra ? (
              <button type="button" onClick={() => onCambiar('agregandoExtra', true)}
                className="flex items-center gap-1.5 text-xs font-medium text-amber-600
                           hover:text-amber-700 transition-colors w-fit">
                <Plus size={12} /> Llegó otra que no pediste
              </button>
            ) : (
              <div className="border border-amber-200 bg-amber-50/40 rounded-lg p-2 flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-amber-800">¿Cuál llegó de más?</p>
                  <button type="button" onClick={() => onCambiar('agregandoExtra', false)}
                    className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                    cancelar
                  </button>
                </div>
                <div className="max-h-36 overflow-y-auto flex flex-col gap-0.5">
                  {hojas.filter((h) => !nodosUsados.has(h.key)).length === 0 ? (
                    <p className="text-xs text-gray-400 py-1.5">
                      Todas las variantes de este producto ya están en la recepción.
                    </p>
                  ) : hojas.filter((h) => !nodosUsados.has(h.key)).map((h) => (
                    <button key={h.key} type="button"
                      onClick={() => {
                        onAgregarExtra({
                          key: h.key, id: h.id, tipo: h.tipo, cantidad: 1,
                          label: `${h.labelPadre ? `${h.labelPadre} · ` : ''}${h.label}`,
                        });
                        onCambiar('agregandoExtra', false);
                      }}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md
                                 text-left text-xs text-gray-700 hover:bg-white transition-colors">
                      <span className="truncate">
                        {h.labelPadre ? `${h.labelPadre} · ` : ''}{h.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Llegaron de mas ─────────────────────────────────────────────── */}
        {sobra > 0 && (
          <label className="flex items-start gap-2 bg-purple-50 rounded-lg px-2.5 py-2 cursor-pointer">
            <input type="checkbox" checked={Boolean(estado.excedenteOk)}
              onChange={(e) => onCambiar('excedenteOk', e.target.checked)}
              className="w-4 h-4 mt-0.5 rounded accent-purple-600 flex-shrink-0" />
            <span className="text-xs text-purple-800">
              <PackagePlus size={11} className="inline mr-1 -mt-0.5" />
              Me quedo con las {sobra} de más. Entran al inventario y quedan anotadas.
              <span className="block text-purple-600 mt-0.5">
                Si se las vas a devolver, baja el número a {pendiente}.
              </span>
            </span>
          </label>
        )}

        {recibidas > 0 && (
          <PrecioYGarantia linea={linea} estado={estado} onCambiar={onCambiar}
            garantiaActiva={garantiaActiva} />
        )}
      </div>
    );
  }

  if (!tieneArbol) {
    const recibidas = Number(estado.cantidad || 0);
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-end gap-3">
          <div className="w-36">
            <Stepper valor={estado.cantidad} max={pendiente}
              onCambiar={(v) => onCambiar('cantidad', v)} />
            <span className="block text-xs text-gray-400 text-center mt-1 tabular-nums">
              {recibidas === pendiente ? 'completa'
                : recibidas === 0      ? 'no llegó'
                  : `faltarán ${pendiente - recibidas}`}
            </span>
          </div>
        </div>
        {recibidas > 0 && (
          <PrecioYGarantia linea={linea} estado={estado} onCambiar={onCambiar}
            garantiaActiva={garantiaActiva} />
        )}
      </div>
    );
  }

  const nodos = estado.nodosData || {};
  const total = Object.values(nodos).reduce((s, d) => s + Number(d?.cantidad || 0), 0);

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium text-gray-600 flex items-center gap-1">
        <Layers size={11} /> ¿Cuántas llegaron de cada una?
      </label>
      <MultiSelectorCompra
        hojas={hojas}
        nodosData={nodos}
        onActualizar={(key, data) => onCambiar('nodosData', { ...nodos, [key]: data })}
      />
      {total > pendiente && (
        <label className="flex items-start gap-2 bg-purple-50 rounded-lg px-2.5 py-2 cursor-pointer">
          <input type="checkbox" checked={Boolean(estado.excedenteOk)}
            onChange={(e) => onCambiar('excedenteOk', e.target.checked)}
            className="w-4 h-4 mt-0.5 rounded accent-purple-600 flex-shrink-0" />
          <span className="text-xs text-purple-800">
            Estás recibiendo {total} y solo faltan {pendiente}. Me quedo con las
            {' '}{total - pendiente} de más.
          </span>
        </label>
      )}
      {total > 0 && garantiaActiva && (
        <PrecioYGarantia linea={linea} estado={estado} onCambiar={onCambiar}
          garantiaActiva ocultarPrecio />
      )}
    </div>
  );
}

function FilaRecepcion({
  linea, estado, onCambiar, garantiaActiva, cfg, sucursalId,
  extras, onAgregarExtra, onQuitarExtra, nodosUsados,
}) {
  const pendiente = Number(linea.pendiente);
  const agotada   = pendiente <= 0;
  const esSerial  = linea.tipo === 'serial';

  return (
    <div className={`border rounded-xl p-3 flex flex-col gap-2.5 transition-colors
      ${agotada ? 'border-gray-100 bg-gray-50' : 'border-gray-200'}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {esSerial
            ? <Smartphone size={14} className="text-gray-300 flex-shrink-0" />
            : <Package size={14} className="text-gray-300 flex-shrink-0" />}
          <span className={`text-sm font-medium truncate ${agotada ? 'text-gray-400' : 'text-gray-800'}`}>
            {linea.nombre_producto}
          </span>
        </div>
        <p className="text-xs text-gray-400 mt-0.5 tabular-nums">
          {agotada
            ? 'Ya llegó completa'
            : `Pediste ${linea.cantidad_pedida} · ya llegaron ${linea.recibida} · faltan ${pendiente}`}
        </p>
      </div>

      {!agotada && (esSerial
        ? <FilaSerial linea={linea} estado={estado} onCambiar={onCambiar}
            garantiaActiva={garantiaActiva} cfg={cfg} />
        : <FilaCantidad linea={linea} estado={estado} onCambiar={onCambiar}
            garantiaActiva={garantiaActiva} variantesActivo={cfg.variantesActivo}
            sucursalId={sucursalId}
            extras={extras} onAgregarExtra={onAgregarExtra}
            onQuitarExtra={onQuitarExtra} nodosUsados={nodosUsados} />
      )}
    </div>
  );
}

export function ModalRecibir({ open, orden, garantiaActiva, onClose, onRecibida }) {
  const queryClient = useQueryClient();
  const metodosPago = useMetodosPago();

  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
  });

  // Qué se le pide al usuario sale de SU configuración, no de un default. Un
  // negocio que no usa colores ni variantes ve exactamente lo de siempre.
  const cfg = {
    coloresActivo:         configData?.colores_serial_activo === '1',
    coloresLista:          parsearLista(configData?.colores_serial_lista),
    caracteristicasActivo: configData?.caracteristicas_serial_activo === '1',
    caracteristicasLista:  parsearLista(configData?.caracteristicas_serial_lista),
    variantesActivo:       configData?.variantes_activo === '1',
  };

  const lineas = (orden?.lineas || []).filter((l) => Number(l.pendiente) > 0);

  // Precargado con lo que falta: el caso normal es confirmar sin tocar nada.
  // Los seriales no se pueden precargar —hay que decir qué IMEI llegó—, y las
  // variantes tampoco: el reparto por color lo decide quien abre la caja.
  const [estados, setEstados] = useState(() =>
    Object.fromEntries((orden?.lineas || []).map((l) => [l.id, {
      cantidad:  l.tipo === 'serial' ? '0' : String(Math.max(0, Number(l.pendiente))),
      imeis:     [itemSerialVacio(
        configData?.colores_serial_activo === '1',
        configData?.caracteristicas_serial_activo === '1',
        parsearLista(configData?.caracteristicas_serial_lista),
      )],
      nodosData: {},
      // La variante que de verdad llego, cuando no es la pedida. Empieza en null
      // porque el caso normal —llego lo que se pidio— no tiene que tocar nada.
      nodoSust:     null,
      eligiendoNodo: false,
      agregandoExtra: false,
      excedenteOk:  false,
      // Lo que llego SIN estar en el pedido, colgado de la linea del producto
      // desde la que se agrego. Cuelga de ahi y no de una lista global porque
      // asi el selector sabe que arbol ofrecer y que nodos excluir.
      extras:       [],
      precio:    l.precio_estimado ?? '',
      garantia:  l.garantia_dias ?? '',
    }]))
  );
  const [numeroFactura, setNumeroFactura] = useState(orden?.numero_factura || '');
  const [pagoAhora,     setPagoAhora]     = useState(false);
  const [metodo,        setMetodo]        = useState(() => metodosPago[0]?.id ?? 'Efectivo');
  const [valorPago,     setValorPago]     = useState('');
  const [error,         setError]         = useState('');

  const cambiar = (lineaId, campo, valor) =>
    setEstados((prev) => ({ ...prev, [lineaId]: { ...prev[lineaId], [campo]: valor } }));

  // Un extra se reemplaza por clave (asi el input de cantidad edita el existente
  // en vez de agregar uno nuevo cada tecla).
  const agregarExtra = (lineaId, ex) =>
    setEstados((prev) => {
      const actuales = prev[lineaId]?.extras || [];
      const i = actuales.findIndex((x) => x.key === ex.key);
      const nuevos = i < 0 ? [...actuales, ex]
        : actuales.map((x, j) => (j === i ? ex : x));
      return { ...prev, [lineaId]: { ...prev[lineaId], extras: nuevos } };
    });

  const quitarExtra = (lineaId, key) =>
    setEstados((prev) => ({
      ...prev,
      [lineaId]: {
        ...prev[lineaId],
        extras: (prev[lineaId]?.extras || []).filter((x) => x.key !== key),
      },
    }));

  // Los nodos que YA estan en esta recepcion para un producto: los de las lineas
  // del pedido (o la variante que las sustituyo) mas los extras ya agregados.
  // Sin esto se podria agregar dos veces el mismo nodo y el inventario subiria
  // el doble sin que la pantalla dijera por que.
  const nodosUsadosDe = (productoId) => {
    const usados = new Set();
    for (const l of (orden?.lineas || [])) {
      if (l.producto_id !== productoId) continue;
      const e = estados[l.id] || {};
      const sust = e.nodoSust;
      if (sust) usados.add(sust.key);
      else if (l.variante_id) usados.add(`v-${l.variante_id}`);
      else if (l.atributo_id) usados.add(`a-${l.atributo_id}`);
      for (const ex of (e.extras || [])) usados.add(ex.key);
    }
    return usados;
  };

  const recibirTodo = () => setEstados((prev) => {
    const copia = { ...prev };
    for (const l of lineas) {
      // Ni los seriales ni las variantes se autocompletan: en los dos casos hay
      // que decir QUÉ llegó, no solo cuánto.
      if (l.tipo === 'serial') continue;
      if (Object.keys(copia[l.id]?.nodosData || {}).length > 0) continue;
      copia[l.id] = { ...copia[l.id], cantidad: String(l.pendiente) };
    }
    return copia;
  });

  // Lo que de verdad se va a enviar. Una línea de seriales se expande en una
  // fila por IMEI y una de variantes en una fila por hoja — igual que hace el
  // registro de compra normal, porque es el mismo endpoint.
  const construirLineas = () => {
    const out = [];
    for (const l of lineas) {
      const e = estados[l.id] || {};
      const garantia = e.garantia !== '' && e.garantia != null ? Number(e.garantia) : null;

      if (l.tipo === 'serial') {
        for (const item of (e.imeis || [])) {
          const imei = extraerImei(item).trim();
          if (!imei) continue;
          const caracteristicas = extraerCaracteristicas(item);
          const tieneAlguna = Object.values(caracteristicas).some((v) => v?.trim?.());
          out.push({
            nombre_producto: l.nombre_producto,
            producto_id:     l.producto_id,
            imei,
            cantidad:        1,
            precio_unitario: Number(e.precio || 0),
            color:           extraerColor(item),
            caracteristicas: tieneAlguna ? caracteristicas : null,
            orden_linea_id:  l.id,
            garantia_dias:   garantia,
          });
        }
        continue;
      }

      // ── La orden pidio un NODO: una sola linea, en el nodo que llego ─────
      //
      // `sustituye` viaja SOLO cuando de verdad hay sustitucion. Mandarlo
      // siempre en true convertiria la confirmacion en decorado y el backend
      // dejaria pasar en silencio justo lo que este trabajo vino a destapar.
      const pedido = nodoPedido(l);
      if (pedido) {
        const cant = Number(e.cantidad || 0);
        if (cant > 0) {
          const sust = e.nodoSust || null;
          out.push({
            nombre_producto: l.nombre_producto,
            producto_id:     l.producto_id,
            cantidad:        cant,
            precio_unitario: Number(e.precio || 0),
            variante_id: sust ? (sust.tipo === 'variante' ? sust.id : null) : pedido.variante_id,
            atributo_id: sust ? (sust.tipo === 'atributo' ? sust.id : null) : pedido.atributo_id,
            orden_linea_id:  l.id,
            garantia_dias:   garantia,
            ...(sust                        ? { sustituye: true }    : {}),
            ...(e.excedenteOk               ? { excedente_ok: true } : {}),
          });
        }
        // Lo que llego sin estar en el pedido va SIN `orden_linea_id`: no
        // responde a ninguna linea y por eso no puede consumir su pendiente ni
        // sustituir nada. El backend lo registra como novedad del proveedor.
        for (const ex of (e.extras || [])) {
          if (!(Number(ex.cantidad) > 0)) continue;
          out.push({
            nombre_producto: l.nombre_producto,
            producto_id:     l.producto_id,
            cantidad:        Number(ex.cantidad),
            precio_unitario: Number(e.precio || 0),
            variante_id:     ex.tipo === 'variante' ? ex.id : null,
            atributo_id:     ex.tipo === 'atributo' ? ex.id : null,
            garantia_dias:   garantia,
          });
        }
        continue;
      }

      const nodos = Object.values(e.nodosData || {}).filter((d) => Number(d?.cantidad) > 0);
      if (nodos.length > 0) {
        for (const d of nodos) {
          out.push({
            nombre_producto: l.nombre_producto,
            producto_id:     l.producto_id,
            cantidad:        Number(d.cantidad),
            precio_unitario: Number(d.costo || 0),
            variante_id:     d.tipo === 'variante' ? d.id : null,
            atributo_id:     d.tipo === 'atributo' ? d.id : null,
            orden_linea_id:  l.id,
            garantia_dias:   garantia,
            ...(e.excedenteOk ? { excedente_ok: true } : {}),
          });
        }
        continue;
      }

      const cantidad = Number(e.cantidad || 0);
      if (cantidad > 0) {
        out.push({
          nombre_producto: l.nombre_producto,
          producto_id:     l.producto_id,
          cantidad,
          precio_unitario: Number(e.precio || 0),
          orden_linea_id:  l.id,
          garantia_dias:   garantia,
          ...(e.excedenteOk ? { excedente_ok: true } : {}),
        });
      }
    }
    return out;
  };

  const lineasEnvio = construirLineas();
  const unidades = lineasEnvio.reduce((s, l) => s + Number(l.cantidad), 0);
  const total    = lineasEnvio.reduce((s, l) => s + Number(l.cantidad) * Number(l.precio_unitario || 0), 0);

  const recibidasDe = (l) => lineasEnvio
    .filter((x) => x.orden_linea_id === l.id)
    .reduce((s, x) => s + Number(x.cantidad), 0);

  const quedanPendientes = lineas.some((l) => recibidasDe(l) < Number(l.pendiente));
  // Solo importa el exceso SIN confirmar. El confirmado ya es una decision
  // tomada, y seguir bloqueandolo seria volver al muro de antes con una casilla
  // decorativa al lado.
  const excesoSinConfirmar = lineas.some(
    (l) => recibidasDe(l) > Number(l.pendiente) && !estados[l.id]?.excedenteOk
  );

  const mut = useMutation({
    mutationFn: () => crearCompra({
      proveedor_id:    orden.proveedor_id,
      orden_compra_id: orden.id,
      numero_factura:  numeroFactura.trim() || null,
      total,
      lineas:          lineasEnvio,
      pagos: pagoAhora && Number(valorPago) > 0
        ? [{ metodo, valor: Number(valorPago) }]
        : [],
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ordenes-compra'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['compras'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-serial'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['arbol-producto'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['acreedores'], exact: false });
      onRecibida?.();
      onClose();
    },
    onError: (e) => setError(e.response?.data?.error || 'No se pudo registrar la recepción'),
  });

  const confirmar = () => {
    setError('');
    if (lineasEnvio.length === 0) {
      setError('No marcaste nada como recibido');
      return;
    }
    if (excesoSinConfirmar) {
      setError('Hay líneas donde llegaron de más. Marca que te quedas con ellas, '
        + 'o baja el número a lo que falta y devuélveselas al proveedor.');
      return;
    }
    if (lineasEnvio.some((l) => !(Number(l.precio_unitario) > 0))) {
      setError('Cada producto que llegó necesita su precio');
      return;
    }
    // Duplicados dentro de la misma recepción: el backend los rechazaría de
    // todos modos, pero después de haber escrito la mitad de la transacción.
    const imeis = lineasEnvio.filter((l) => l.imei).map((l) => l.imei.toUpperCase());
    if (new Set(imeis).size !== imeis.length) {
      setError('Hay IMEI repetidos en esta recepción');
      return;
    }
    mut.mutate();
  };

  if (!orden) return null;

  return (
    <Modal open={open} onClose={onClose} size="xl"
      title={`Recibir — Orden #${orden.numero ?? orden.id}`}>
      <div className="flex flex-col gap-4">

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-gray-500">{orden.proveedor_nombre}</p>
          {lineas.some((l) => l.tipo !== 'serial') && (
            <button type="button" onClick={recibirTodo}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors">
              Llegó todo
            </button>
          )}
        </div>

        {lineas.length === 0 ? (
          <div className="bg-green-50 rounded-xl px-4 py-6 text-center">
            <PackageCheck size={24} className="text-green-500 mx-auto mb-2" />
            <p className="text-sm text-green-800 font-medium">Esta orden ya llegó completa</p>
            <p className="text-xs text-green-600 mt-0.5">No queda nada por recibir</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {(orden.lineas || []).map((l) => (
              <FilaRecepcion key={l.id} linea={l} estado={estados[l.id] || {}}
                garantiaActiva={garantiaActiva} cfg={cfg} sucursalId={orden.sucursal_id}
                onCambiar={(campo, valor) => cambiar(l.id, campo, valor)}
                extras={estados[l.id]?.extras || []}
                onAgregarExtra={(ex) => agregarExtra(l.id, ex)}
                onQuitarExtra={(key) => quitarExtra(l.id, key)}
                nodosUsados={nodosUsadosDe(l.producto_id)} />
            ))}
          </div>
        )}

        {lineasEnvio.length > 0 && (
          <>
            <div className="border-t border-gray-100 pt-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400">N° de factura de esta entrega</label>
                <input value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)}
                  placeholder="Opcional"
                  className="px-3 py-2 text-sm border border-gray-200 rounded-xl
                             focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={pagoAhora}
                  onChange={(e) => setPagoAhora(e.target.checked)}
                  className="w-4 h-4 rounded accent-blue-600" />
                <span className="text-sm text-gray-700">Le pagué algo al recibir</span>
              </label>

              {pagoAhora && (
                <div className="grid grid-cols-2 gap-2 pl-6">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400">Cuánto</label>
                    <InputMoneda value={valorPago} onChange={setValorPago} placeholder="0"
                      className="w-full px-2.5 py-1.5 text-sm tabular-nums border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400">Cómo</label>
                    <select value={metodo} onChange={(e) => setMetodo(e.target.value)}
                      className="px-3 py-2 text-sm border border-gray-200 rounded-xl bg-white
                                 focus:outline-none focus:ring-1 focus:ring-blue-400">
                      {metodosPago.map((m) => (
                        <option key={m.id} value={m.id}>{m.label ?? m.id}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {quedanPendientes && !excesoSinConfirmar && (
              <div className="bg-amber-50 rounded-xl px-3 py-2.5 flex items-start gap-2">
                <AlertTriangle size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800">
                  Lo que no llegó queda pendiente en la orden. No tienes que hacer nada más:
                  cuando llegue, vuelves a entrar aquí.
                </p>
              </div>
            )}

            <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
              <span className="text-xs text-gray-500 tabular-nums">
                {unidades} {unidades === 1 ? 'unidad' : 'unidades'}
              </span>
              <div className="text-right">
                <p className="text-xs text-gray-400">Se le carga al proveedor</p>
                <p className="text-base font-bold text-gray-900 tabular-nums">{formatCOP(total)}</p>
              </div>
            </div>
          </>
        )}

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={mut.isPending} disabled={lineasEnvio.length === 0} onClick={confirmar}>
            <PackageCheck size={15} /> Confirmar recepción
          </Button>
        </div>
      </div>
    </Modal>
  );
}
