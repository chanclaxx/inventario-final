import { useState } from 'react';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { Trash2, ChevronDown, X } from 'lucide-react';
import {
  extraerImei, extraerColor, extraerCaracteristicas, usaItemObjeto,
} from './capturaMercancia.utils';

// ─────────────────────────────────────────────────────────────────────────────
// CAPTURA DE MERCANCÍA QUE ENTRA — componentes compartidos
//
// Los usan `ModalCompra` (compra suelta) y `ModalRecibir` (recepción contra una
// orden). Los helpers puros viven en `capturaMercancia.utils.js`, separados solo
// porque fast-refresh exige que un archivo exporte únicamente componentes.
// ─────────────────────────────────────────────────────────────────────────────

const noWheel = (e) => e.target.blur();

// ── Una fila de IMEI, con su color y sus características ─────────────────────
export function FilaImeiCompra({
  index, item, coloresActivo, coloresConfig,
  caracteristicasActivo, caracteristicasLista,
  esDuplicado, inputRef, onChange, onKeyDown, onEliminar, mostrarEliminar,
}) {
  const [expandido, setExpandido] = useState(false);

  const imeiValor       = extraerImei(item);
  const colorValor      = extraerColor(item) || '';
  const caracteristicas = extraerCaracteristicas(item);

  const usaObjeto = usaItemObjeto(coloresActivo, caracteristicasActivo, caracteristicasLista);

  const handleImeiChange = (valor) => {
    if (!usaObjeto) { onChange(valor); return; }
    onChange({ imei: valor, color: colorValor, caracteristicas });
  };

  const handleColorChange = (valor) => {
    onChange({ imei: imeiValor, color: valor, caracteristicas });
  };

  const handleCaracteristicaChange = (nombre, valor) => {
    onChange({ imei: imeiValor, color: colorValor, caracteristicas: { ...caracteristicas, [nombre]: valor } });
  };

  const tieneCaracteristicas = caracteristicasActivo && caracteristicasLista?.length > 0;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1.5 items-center">
        <input
          ref={inputRef}
          type="text"
          value={imeiValor}
          onChange={(e) => handleImeiChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`IMEI ${index + 1}`}
          className={`flex-1 px-2 py-1.5 border rounded-lg text-sm font-mono
            focus:outline-none focus:ring-2
            ${esDuplicado
              ? 'bg-red-50 border-red-400 text-red-700 focus:ring-red-400'
              : 'bg-white border-gray-200 focus:ring-blue-500'}`}
        />
        {coloresActivo && coloresConfig.length > 0 && (
          <select value={colorValor} onChange={(e) => handleColorChange(e.target.value)}
            className="w-24 px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-xs
              text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400 flex-shrink-0">
            <option value="">Color...</option>
            {coloresConfig.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {tieneCaracteristicas && (
          <button type="button" onClick={() => setExpandido((v) => !v)}
            className={`p-2 rounded-lg border transition-colors flex-shrink-0
              ${expandido ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-gray-200 text-gray-400 hover:text-gray-600'}`}>
            <ChevronDown size={13} className={`transition-transform ${expandido ? 'rotate-180' : ''}`} />
          </button>
        )}
        {mostrarEliminar && (
          <button onClick={onEliminar}
            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400 flex-shrink-0">
            <Trash2 size={12} />
          </button>
        )}
      </div>
      {expandido && tieneCaracteristicas && (
        <div className="flex flex-col gap-1.5 pl-3 border-l-2 border-blue-100 ml-1">
          {caracteristicasLista.map((nombre) => (
            <div key={nombre} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-24 flex-shrink-0 truncate">{nombre}</span>
              <input type="text" value={caracteristicas[nombre] || ''}
                onChange={(e) => handleCaracteristicaChange(nombre, e.target.value)}
                placeholder={`${nombre}...`}
                className="flex-1 px-2 py-1.5 bg-white border border-gray-200 rounded-lg
                  text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Selección de variantes/atributos con cantidad y costo ────────────────────
//
// `hojas` son los nodos finales del árbol del producto (una variante concreta, o
// un atributo sin variantes debajo). El stock SIEMPRE se mueve sobre la hoja,
// nunca sobre el producto padre: el padre se recalcula como la suma de sus
// hojas, así que escribirle directo se pierde en la siguiente sincronización.
export function MultiSelectorCompra({ hojas, nodosData, onActualizar }) {
  const [seleccionadas, setSeleccionadas] = useState(
    () => new Set(hojas.filter((h) => Number(nodosData[h.key]?.cantidad) > 0).map((h) => h.key))
  );

  const base = (h) => ({
    label: h.label, labelPadre: h.labelPadre, tipo: h.tipo, id: h.id,
    cantidad: '', costo: '',
    ...(nodosData[h.key] || {}),
  });

  const toggle = (h) => {
    setSeleccionadas((prev) => {
      const next = new Set(prev);
      if (next.has(h.key)) {
        next.delete(h.key);
        onActualizar(h.key, { ...base(h), cantidad: '', costo: '' });
      } else {
        next.add(h.key);
      }
      return next;
    });
  };

  const hojasSel     = hojas.filter((h) => seleccionadas.has(h.key));
  const nodosActivos = hojasSel.filter((h) => Number(nodosData[h.key]?.cantidad) > 0);
  const totalUds     = nodosActivos.reduce((s, h) => s + Number(nodosData[h.key]?.cantidad || 0), 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {hojas.map((h) => {
          const activa = seleccionadas.has(h.key);
          const chipLabel = h.labelPadre ? `${h.labelPadre} / ${h.label}` : h.label;
          return (
            <button key={h.key} type="button" onClick={() => toggle(h)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-medium border transition-all
                ${activa
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-blue-200 hover:bg-blue-50/50'}`}>
              {chipLabel}
              {activa && <X size={9} />}
            </button>
          );
        })}
      </div>

      {hojasSel.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 px-1">
            <p className="flex-1 text-[11px] font-medium text-gray-400 uppercase tracking-wide">Variante</p>
            <p className="w-14 text-[11px] font-medium text-gray-400 text-center">Cant.</p>
            <p className="w-24 text-[11px] font-medium text-gray-400 text-center">Precio unit.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            {hojasSel.map((h) => {
              const data = base(h);
              return (
                <div key={h.key}
                  className="flex items-center gap-2 p-2 rounded-xl border border-blue-200 bg-blue-50/50">
                  <div className="flex-1 min-w-0">
                    {h.labelPadre && <p className="text-[10px] text-gray-400 leading-none mb-0.5">{h.labelPadre}</p>}
                    <p className="text-xs font-medium text-gray-800 leading-tight">{h.label}</p>
                    <p className="text-[10px] text-gray-400">{h.stock} en stock</p>
                  </div>
                  <input type="number" min="0" value={data.cantidad}
                    onChange={(e) => onActualizar(h.key, { ...base(h), cantidad: e.target.value })}
                    onWheel={noWheel} placeholder="0"
                    className="w-14 px-2 py-1.5 text-xs text-center bg-white border border-gray-200
                      rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400" />
                  <InputMoneda value={data.costo}
                    onChange={(val) => onActualizar(h.key, { ...base(h), costo: val })}
                    placeholder="$0"
                    className="w-24 px-2 py-1.5 text-xs bg-white border border-gray-200 rounded-lg
                      focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {nodosActivos.length > 0 && (
        <p className="text-xs text-blue-600 font-medium px-1">
          {nodosActivos.length} variante(s) — {totalUds} unidades totales
        </p>
      )}
    </div>
  );
}
