import { Opcion, CampoMm } from './ui';
import { mm } from './etiquetasUi';

// ─────────────────────────────────────────────────────────────────────────────
// EDITOR DE FORMATO A MEDIDA
//
// Pide lo que se MIDE con una regla sobre el rollo o la plancha que se compró,
// en el orden en que se mide: la etiqueta, cuántas van por fila, el hueco entre
// ellas y el ancho total. Lo que se deja vacío se centra —así vienen
// troquelados casi todos los rollos—, y la validación (¿caben?) la hace el
// backend y vuelve con las medidas en el mensaje.
//
// Este editor es la respuesta al caso que se reportó: el formato a medida
// anterior no dejaba decir el ancho del rollo, los márgenes ni la separación, y
// una tira de 3 columnas no había forma de cuadrarla.
// ─────────────────────────────────────────────────────────────────────────────

const _num = (v) => (v === '' || v === null || v === undefined ? '' : Number(v));

export function EditorFormato({ valor, onCambiar, papeles = [] }) {
  const v = valor;
  const set = (parcial) => onCambiar({ ...v, ...parcial });
  const setSep = (eje, val) => set({ separacion: { ...v.separacion, [eje]: _num(val) } });
  const setMargen = (lado, val) => set({ margen: { ...v.margen, [lado]: val === '' ? '' : Number(val) } });

  const esRollo = v.medio !== 'hoja';
  const columnas = Number(v.columnas) || 1;
  const reticula = columnas * (Number(v.ancho) || 0) + (columnas - 1) * (Number(v.separacion?.x) || 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Opcion activo={esRollo} titulo="Rollo o tira"
          desc="Impresora de etiquetas o de recibos. Una o varias columnas."
          onClick={() => set({ medio: 'rollo' })} />
        <Opcion activo={!esRollo} titulo="Hoja adhesiva"
          desc="Plancha A4, Carta u Oficio en impresora normal."
          onClick={() => set({ medio: 'hoja' })} />
      </div>

      <p className="text-xs font-semibold text-gray-500">Cada etiqueta</p>
      <div className="grid grid-cols-2 gap-2">
        <CampoMm label="Ancho" value={v.ancho} min="10" onChange={(x) => set({ ancho: _num(x) })} />
        <CampoMm label="Alto"  value={v.alto}  min="10" onChange={(x) => set({ alto: _num(x) })} />
      </div>

      {esRollo ? (
        <>
          <p className="text-xs font-semibold text-gray-500">El rollo</p>
          <div className="grid grid-cols-2 gap-2">
            <CampoMm label="Columnas (etiquetas por fila)" value={v.columnas} min="1" max="12" step="1" sufijo=""
              onChange={(x) => set({ columnas: x === '' ? '' : Math.max(1, Math.round(Number(x))) })} />
            {columnas > 1 ? (
              <CampoMm label="Hueco entre columnas" value={v.separacion?.x} min="0"
                onChange={(x) => setSep('x', x)} />
            ) : <span />}
            <CampoMm label="Ancho total del rollo" value={v.anchoRollo ?? ''} min="10"
              placeholder={reticula ? mm(reticula) : ''}
              onChange={(x) => set({ anchoRollo: _num(x) })}
              ayuda="Mídelo de borde a borde del papel de soporte." />
            <CampoMm label="Margen izquierdo" value={v.margen?.izquierda ?? ''} min="0"
              placeholder="centrado" onChange={(x) => setMargen('izquierda', x)}
              ayuda="Vacío = las etiquetas van centradas." />
            <CampoMm label="Hueco entre filas" value={v.separacion?.y} min="0"
              onChange={(x) => setSep('y', x)} ayuda="El espacio entre una fila y la siguiente." />
            <CampoMm label="Filas por página" value={v.filasPorPagina ?? 1} min="1" max="60" step="1" sufijo=""
              onChange={(x) => set({ filasPorPagina: x === '' ? '' : Math.max(1, Math.round(Number(x))) })}
              ayuda="Déjalo en 1 con impresoras de etiquetas: si el rollo trae hueco entre filas, la impresora cuenta cada fila como una etiqueta y con más de 1 avanza filas en blanco." />
          </div>
          <label className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox" className="mt-0.5 accent-blue-600"
              checked={!v.incluirSeparacion}
              onChange={(e) => set({ incluirSeparacion: !e.target.checked })}
            />
            <span>
              <strong>Mi impresora detecta el hueco entre etiquetas</strong> (sensor de «gap»). Casi todas las de
              etiquetas lo hacen. Desmárcalo para papel continuo o impresoras de recibos: entonces cada página
              incluye el hueco.
            </span>
          </label>
        </>
      ) : (
        <>
          <p className="text-xs font-semibold text-gray-500">La hoja</p>
          <div className="flex flex-wrap gap-1.5">
            {[...papeles, { id: 'personalizado', nombre: 'Otra medida' }].map((p) => (
              <button
                key={p.id} type="button"
                onClick={() => set({ papel: p.id })}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors
                  ${(v.papel || 'a4') === p.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}
              >
                {p.nombre}{p.ancho ? ` (${mm(p.ancho)} × ${mm(p.alto)})` : ''}
              </button>
            ))}
          </div>
          {(v.papel === 'personalizado' || !papeles.length) && (
            <div className="grid grid-cols-2 gap-2">
              <CampoMm label="Ancho de la hoja" value={v.pagina?.ancho} min="10"
                onChange={(x) => set({ papel: 'personalizado', pagina: { ...v.pagina, ancho: _num(x) } })} />
              <CampoMm label="Alto de la hoja" value={v.pagina?.alto} min="10"
                onChange={(x) => set({ papel: 'personalizado', pagina: { ...v.pagina, alto: _num(x) } })} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <CampoMm label="Columnas" value={v.columnas} min="1" max="12" step="1" sufijo=""
              onChange={(x) => set({ columnas: x === '' ? '' : Math.max(1, Math.round(Number(x))) })} />
            <CampoMm label="Filas" value={v.filas} min="1" max="60" step="1" sufijo=""
              onChange={(x) => set({ filas: x === '' ? '' : Math.max(1, Math.round(Number(x))) })} />
            <CampoMm label="Margen superior" value={v.margen?.arriba ?? ''} min="0" placeholder="centrado"
              onChange={(x) => setMargen('arriba', x)} />
            <CampoMm label="Margen izquierdo" value={v.margen?.izquierda ?? ''} min="0" placeholder="centrado"
              onChange={(x) => setMargen('izquierda', x)} />
            <CampoMm label="Hueco horizontal" value={v.separacion?.x} min="0" onChange={(x) => setSep('x', x)} />
            <CampoMm label="Hueco vertical"   value={v.separacion?.y} min="0" onChange={(x) => setSep('y', x)} />
          </div>
          <p className="text-[11px] text-gray-400">
            Los márgenes se miden desde el borde de la hoja hasta la primera etiqueta. Vacíos, la retícula se centra.
          </p>
        </>
      )}
    </div>
  );
}

export default EditorFormato;
