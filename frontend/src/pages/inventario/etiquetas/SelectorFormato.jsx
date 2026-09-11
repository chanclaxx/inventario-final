import { useState } from 'react';
import { Save, Trash2, SlidersHorizontal, AlertTriangle } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { EditorFormato } from './EditorFormato';
import { DiagramaFormato, LeyendaFormato } from './DiagramaFormato';
import {
  agruparFormatos, formatoAPersonalizado, resolverElegido, PREFIJO_GUARDADO, mm,
} from './etiquetasUi';

// ─────────────────────────────────────────────────────────────────────────────
// PAPEL: qué rollo o qué plancha hay en la impresora
//
// Tres caminos, del más rápido al más exacto:
//   · un formato del catálogo (lo que se consigue en el país);
//   · «Ajustar este formato»: parte del del catálogo que más se parece y se
//     corrige solo lo que difiere (el ancho del rollo, el hueco…);
//   · el editor a medida, que se puede GUARDAR con nombre en «Mis formatos».
//     Quien imprime todas las semanas en el mismo rollo lo configura una vez.
// ─────────────────────────────────────────────────────────────────────────────

export function SelectorFormato({ prefs, cambiar, formatos, papeles, plan, errorFormato }) {
  const [nombreNuevo, setNombreNuevo] = useState('');
  const elegido = resolverElegido(prefs, formatos);
  const editable = prefs.formato === 'personalizado' || !!elegido.guardado;
  const geometria = plan?.geometria;

  const elegir = (id) => cambiar({ formato: id });

  // El editor escribe en el borrador «A medida» o, si hay un formato guardado
  // elegido, directamente en ese formato: calibrar su geometría es mejorarlo.
  const cambiarGeometria = (nuevo) => {
    if (elegido.guardado) {
      cambiar({
        guardados: prefs.guardados.map((g) => (g.id === elegido.guardado.id ? { ...g, personalizado: nuevo } : g)),
      });
    } else {
      cambiar({ personalizado: nuevo });
    }
  };

  const ajustarPreset = () => {
    const base = formatoAPersonalizado(elegido.preset);
    if (!base) return;
    // La calibración viaja con el formato: si ya se había medido la impresora
    // con este rollo, sigue valiendo al ajustarlo.
    const calPreset = prefs.calibracion?.[prefs.formato];
    cambiar({
      formato: 'personalizado',
      personalizado: { ...prefs.personalizado, ...base },
      ...(calPreset ? { calibracion: { ...prefs.calibracion, personalizado: calPreset } } : {}),
    });
  };

  const guardar = () => {
    const nombre = nombreNuevo.trim();
    if (!nombre) return;
    const id = `${Date.now().toString(36)}`;
    const cal = prefs.calibracion?.[elegido.clave];
    cambiar({
      guardados: [...prefs.guardados, { id, nombre: nombre.slice(0, 40), personalizado: elegido.personalizado }],
      formato: `${PREFIJO_GUARDADO}${id}`,
      ...(cal ? { calibracion: { ...prefs.calibracion, [`${PREFIJO_GUARDADO}${id}`]: cal } } : {}),
    });
    setNombreNuevo('');
  };

  const borrar = () => {
    if (!elegido.guardado) return;
    const clave = `${PREFIJO_GUARDADO}${elegido.guardado.id}`;
    const { [clave]: _fuera, ...calibracion } = prefs.calibracion || {};
    cambiar({
      guardados: prefs.guardados.filter((g) => g.id !== elegido.guardado.id),
      formato: 'personalizado',
      personalizado: elegido.guardado.personalizado,
      calibracion,
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <select
        value={prefs.formato} onChange={(e) => elegir(e.target.value)}
        className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm
          focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
      >
        {prefs.guardados.length > 0 && (
          <optgroup label="Mis formatos">
            {prefs.guardados.map((g) => (
              <option key={g.id} value={`${PREFIJO_GUARDADO}${g.id}`}>{g.nombre}</option>
            ))}
          </optgroup>
        )}
        {agruparFormatos(formatos).map((g) => (
          <optgroup key={g.titulo} label={g.titulo}>
            {g.lista.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
          </optgroup>
        ))}
        <option value="personalizado">A medida (mide tu rollo o tu plancha)…</option>
      </select>

      {!editable && elegido.preset && (
        <button
          type="button" onClick={ajustarPreset}
          className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-gray-300
            text-left text-xs text-gray-600 hover:border-blue-300 hover:text-blue-700 transition-colors"
        >
          <SlidersHorizontal size={14} className="flex-shrink-0" />
          <span className="flex-1">
            ¿Tu rollo o tu plancha no mide exactamente esto? <strong>Ajustar este formato</strong>
          </span>
        </button>
      )}

      {editable && (
        <EditorFormato valor={elegido.personalizado} onCambiar={cambiarGeometria} papeles={papeles} />
      )}

      {errorFormato && (
        <p className="flex items-start gap-1.5 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
          {errorFormato}
        </p>
      )}

      {geometria && !errorFormato && (
        <div className="flex flex-col gap-1.5 rounded-xl bg-gray-50 border border-gray-200 p-2">
          <DiagramaFormato geometria={geometria} />
          <p className="text-[11px] text-gray-500 text-center leading-snug">
            <LeyendaFormato geometria={geometria} />
          </p>
          <p className="text-[11px] text-gray-500 text-center leading-snug">
            {geometria.medio === 'rollo' && 'La franja punteada es una página. '}
            Papel en la impresora: <strong className="text-gray-700">{mm(geometria.papel.ancho)} × {mm(geometria.papel.alto)} mm</strong>
            {geometria.papel.rotacion ? ` (página girada ${geometria.papel.rotacion}°)` : ''}
          </p>
        </div>
      )}

      {editable && (
        <div className="flex items-end gap-2">
          {elegido.guardado ? (
            <>
              <p className="text-xs text-gray-500 flex-1">
                Los cambios se guardan en «{elegido.guardado.nombre}».
              </p>
              <Button size="sm" variant="ghost" onClick={borrar}>
                <Trash2 size={14} /> Quitar de mis formatos
              </Button>
            </>
          ) : (
            <>
              <input
                value={nombreNuevo} maxLength={40}
                onChange={(e) => setNombreNuevo(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') guardar(); }}
                placeholder="Nombre, ej: Rollo 3 columnas bodega"
                className="flex-1 min-w-0 px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm
                  placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              />
              <Button size="sm" variant="secondary" onClick={guardar} disabled={!nombreNuevo.trim() || !!errorFormato}>
                <Save size={14} /> Guardar
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default SelectorFormato;
