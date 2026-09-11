import { Barcode, QrCode } from 'lucide-react';
import { Opcion, Casilla, CampoMm, Segmentado } from './ui';
import { TAMANOS_LETRA } from './etiquetasUi';

// ─────────────────────────────────────────────────────────────────────────────
// DISEÑO: qué lleva la etiqueta y cómo se ve
//
// Todo es un DESEO, no una orden: el reparto real lo hace el backend
// (`etiquetas.layout.js`) y la regla que manda es que el símbolo tiene que
// escanear. Si no cabe todo se suelta el texto —pie, encabezado, precio,
// variante, nombre, en ese orden— y la vista previa lo avisa. El código
// legible no es opcional: es la salida de emergencia cuando el símbolo se raya.
// ─────────────────────────────────────────────────────────────────────────────

export function PanelDiseno({ prefs, cambiar, negocioNombre }) {
  const d = prefs.diseno;
  const setD = (parcial) => cambiar({ diseno: { ...d, ...parcial } });
  const alternar = (k) => cambiar({ mostrar: { ...prefs.mostrar, [k]: !prefs.mostrar[k] } });

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Opcion
          activo={prefs.simbologia === 'barras'} onClick={() => cambiar({ simbologia: 'barras' })}
          icon={Barcode} titulo="Código de barras"
          desc="Para el lector láser de siempre. Es el más rápido de escanear."
        />
        <Opcion
          activo={prefs.simbologia === 'qr'} onClick={() => cambiar({ simbologia: 'qr' })}
          icon={QrCode} titulo="QR"
          desc="Se lee con la cámara del celular y aguanta códigos largos en etiquetas pequeñas."
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-gray-600">Qué lleva</p>
        <div className="flex flex-wrap gap-1.5">
          {[
            ['nombre',     'Nombre'],
            ['variante',   'Variante'],
            ['precio',     'Precio'],
            ['encabezado', 'Encabezado'],
            ['pie',        'Texto al pie'],
          ].map(([k, texto]) => (
            <Casilla key={k} activo={!!prefs.mostrar[k]} onClick={() => alternar(k)}>{texto}</Casilla>
          ))}
        </div>
        {prefs.mostrar.encabezado && (
          <input
            value={prefs.encabezadoTexto} maxLength={60}
            onChange={(e) => cambiar({ encabezadoTexto: e.target.value })}
            placeholder={negocioNombre ? `Vacío = «${negocioNombre}»` : 'Vacío = el nombre del negocio'}
            className="w-full px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm placeholder-gray-400
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
          />
        )}
        {prefs.mostrar.pie && (
          <input
            value={prefs.pieTexto} maxLength={60}
            onChange={(e) => cambiar({ pieTexto: e.target.value })}
            placeholder="Ej: Garantía 3 meses · www.mitienda.co"
            className="w-full px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm placeholder-gray-400
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
          />
        )}
        <p className="text-[11px] text-gray-400">
          El código escrito va siempre: si el símbolo se raya o el lector falla, alguien tiene que poder teclearlo.
        </p>
      </div>

      <Segmentado etiqueta="Tamaño de la letra" opciones={TAMANOS_LETRA}
        valor={d.escalaTexto ?? 1} onCambiar={(v) => setD({ escalaTexto: v })} />

      <div className="grid grid-cols-2 gap-2">
        <Segmentado etiqueta="Renglones del nombre"
          opciones={[{ valor: 1, texto: '1' }, { valor: 2, texto: '2' }, { valor: 3, texto: '3' }]}
          valor={d.lineasNombre ?? 2} onCambiar={(v) => setD({ lineasNombre: v })} />
        <Segmentado etiqueta="Alineación"
          opciones={[{ valor: 'centro', texto: 'Centro' }, { valor: 'izquierda', texto: 'Izquierda' }]}
          valor={d.alinear || 'centro'} onCambiar={(v) => setD({ alinear: v })} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <CampoMm label="Margen interior" value={d.margenInterior} min="0" max="8" placeholder="automático"
          onChange={(v) => setD({ margenInterior: v })}
          ayuda="Súbelo si la impresora corta el borde." />
        <CampoMm label="Alto del código de barras" value={d.altoSimbolo} min="4" max="80" placeholder="todo el espacio"
          onChange={(v) => setD({ altoSimbolo: v })}
          ayuda="Vacío = todo lo que deja el texto." />
      </div>

      <Casilla activo={prefs.marco} onClick={() => cambiar({ marco: !prefs.marco })}>
        Dibujar el borde de cada etiqueta
      </Casilla>
      <p className="text-[11px] text-gray-400 -mt-1.5">
        Útil para recortar cuando se imprime en papel sin troquel (hojas normales o papel de recibo).
      </p>
    </div>
  );
}

export default PanelDiseno;
