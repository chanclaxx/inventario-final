import { useState } from 'react';
import { Printer, Download, RotateCw, Ruler } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { CampoMm, Segmentado } from './ui';
import { DPI_OPCIONES, instruccionesImpresion, mm } from './etiquetasUi';

// ─────────────────────────────────────────────────────────────────────────────
// IMPRESORA: que las etiquetas caigan sobre el troquel en CUALQUIER impresora
//
// El PDF mide exactamente el papel. Lo que falla en la práctica es lo que hace
// cada impresora con él, y son tres cosas —las tres se corrigen aquí y se
// comprueban con la hoja de prueba, que usa esta misma calibración—:
//
//   · entra CORRIDA → desvío en milímetros;
//   · ACHICA la página aunque se le pida tamaño real → escala, calculada con la
//     regla de la hoja de prueba («midió 48,5 en vez de 50»);
//   · la saca DE LADO o AL REVÉS (el driver de la térmica tiene el papel de
//     pie, o el rollo sale al revés de como se lee) → girar la página.
//
// Y una cuarta que no se ve pero hace fallar al lector: en una térmica el
// código de barras sale limpio solo si cada barra mide un número entero de
// puntos del cabezal. Con la resolución puesta, el backend lo ajusta.
//
// Todo se guarda POR FORMATO y en este navegador: es de esta impresora.
// ─────────────────────────────────────────────────────────────────────────────

const ROTACIONES = [
  { valor: 0,   texto: '0°' },
  { valor: 90,  texto: '90°' },
  { valor: 180, texto: '180°' },
  { valor: 270, texto: '270°' },
];

export function PanelImpresora({ cal, cambiarCal, plan, desde, setDesde, porPagina, onImprimirPrueba, onDescargarPrueba, generando }) {
  const [medido, setMedido] = useState('');
  const regla = plan?.reglaMm;
  const pasos = instruccionesImpresion(plan?.geometria);

  const aplicarMedida = () => {
    const m = Number(String(medido).replace(',', '.'));
    if (!regla || !Number.isFinite(m) || m <= 0) return;
    // Si con la escala actual la regla de L mm midió M, la impresora multiplica
    // por M / (L · escala): la escala que lo compensa es escala · L / M.
    const nueva = Math.round(Math.min(150, Math.max(50, (Number(cal.escala) || 100) * regla / m)) * 100) / 100;
    cambiarCal({ escala: nueva });
    setMedido('');
  };

  return (
    <div className="flex flex-col gap-3">
      {pasos.length > 0 && (
        <ol className="flex flex-col gap-1 list-decimal pl-4 text-xs text-gray-600 bg-blue-50/60 border border-blue-100 rounded-xl py-2 pr-3">
          {pasos.map((p) => <li key={p} className="leading-snug">{p}</li>)}
        </ol>
      )}

      <div className="flex gap-2">
        <Button size="sm" variant="secondary" className="flex-1" onClick={onImprimirPrueba} loading={generando}>
          <Printer size={14} /> Imprimir hoja de prueba
        </Button>
        <Button size="sm" variant="ghost" onClick={onDescargarPrueba} disabled={generando} title="Descargar la hoja de prueba">
          <Download size={14} />
        </Button>
      </div>
      <p className="text-[11px] text-gray-500 -mt-1.5">
        Dibuja el borde de cada etiqueta, una cruz en el centro y una regla. No necesita productos marcados.
      </p>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-600">Resolución de la impresora</span>
        <select
          value={cal.dpi ?? ''} onChange={(e) => cambiarCal({ dpi: e.target.value ? Number(e.target.value) : null })}
          className="w-full px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
        >
          {DPI_OPCIONES.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
        </select>
        <span className="text-[11px] text-gray-400 leading-snug">
          Viene en la etiqueta de abajo de la impresora o en su caja. Con ella, cada barra mide un número exacto de
          puntos y el lector no falla.
        </span>
      </label>

      <div className="flex flex-col gap-1">
        <Segmentado etiqueta={<span className="inline-flex items-center gap-1"><RotateCw size={12} /> Girar la página</span>}
          opciones={ROTACIONES} valor={cal.rotacion ?? 0} onCambiar={(v) => cambiarCal({ rotacion: v })} />
        <span className="text-[11px] text-gray-400 leading-snug">
          Si en la prueba la etiqueta sale de lado, prueba 90° o 270°; si sale al revés, 180°.
        </span>
      </div>

      {/* Se guarda el texto tal cual: convertir el vacío a 0 hace que el campo
          controlado borre el «-» mientras se escribe y no deja poner negativos.
          El backend sanea (vacío o inválido = 0). */}
      <div className="grid grid-cols-2 gap-2">
        <CampoMm label="Mover a la derecha" value={cal.ajuste?.x ?? ''} step="0.5" min="-30" max="30" placeholder="0"
          onChange={(v) => cambiarCal({ ajuste: { ...cal.ajuste, x: v } })} />
        <CampoMm label="Mover hacia abajo" value={cal.ajuste?.y ?? ''} step="0.5" min="-30" max="30" placeholder="0"
          onChange={(v) => cambiarCal({ ajuste: { ...cal.ajuste, y: v } })} />
      </div>
      <p className="text-[11px] text-gray-400 -mt-1.5 leading-snug">
        Si en la prueba el recuadro quedó 2 mm a la izquierda del troquel, escribe 2 en «Mover a la derecha». Los
        negativos mueven al revés.
      </p>

      <div className="flex flex-col gap-1.5">
        <div className="grid grid-cols-2 gap-2 items-end">
          <CampoMm label="Escala" value={cal.escala ?? ''} step="0.1" min="50" max="150" sufijo="%" placeholder="100"
            onChange={(v) => cambiarCal({ escala: v })} />
          {regla ? (
            <div className="flex items-end gap-1.5">
              <CampoMm label={`La regla de ${regla} mm midió`} value={medido} step="0.1" min="1"
                onChange={setMedido} />
              <Button size="sm" variant="secondary" className="mb-0.5 flex-shrink-0" onClick={aplicarMedida} disabled={!medido}
                title="Calcular la escala con esa medida">
                <Ruler size={13} /> Aplicar
              </Button>
            </div>
          ) : <span />}
        </div>
        <span className="text-[11px] text-gray-400 leading-snug">
          Déjala en 100. Úsala solo si la regla de la prueba no mide lo que dice aunque imprimas en «Tamaño real».
        </span>
      </div>

      {porPagina > 1 && (
        <div className="flex items-end gap-2">
          <div className="w-32 flex-shrink-0">
            <CampoMm label="Empezar en la etiqueta" value={desde} step="1" min="1" max={porPagina} sufijo=""
              onChange={(v) => setDesde(Math.max(1, Math.min(porPagina, Math.round(Number(v) || 1))))} />
          </div>
          <p className="text-[11px] text-gray-500 pb-2 flex-1 leading-snug">
            Para aprovechar una {plan?.geometria?.medio === 'rollo' ? 'fila empezada' : 'plancha a medio gastar'}:
            se salta las casillas ya usadas ({mm(desde - 1)} de {porPagina}).
          </p>
        </div>
      )}
    </div>
  );
}

export default PanelImpresora;
