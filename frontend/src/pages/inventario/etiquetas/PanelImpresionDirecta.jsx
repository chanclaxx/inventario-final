import { useState } from 'react';
import { Plug, RefreshCw, Printer, Download, FileCode, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Opcion, Segmentado } from './ui';
import { mm } from './etiquetasUi';
import useImpresionDirecta from '../../../hooks/useImpresionDirecta';

// ─────────────────────────────────────────────────────────────────────────────
// IMPRESIÓN DIRECTA — para impresoras de etiquetas (térmicas)
//
// El botón «Imprimir» de siempre pasa por el diálogo de Chrome, que usa el papel
// del driver y GIRA la página cuando no calza: con una DIG T451B una tira de 3
// columnas salía como 3 filas, y en «hoja» dejaba filas en blanco. Nada de la
// aplicación lo arreglaba, porque la decisión la toma el navegador.
//
// Aquí la aplicación le habla a la impresora sin el navegador de por medio, con
// tres métodos por QZ Tray (A, B, C) y un plan D sin instalar nada. Están en
// orden de lo que conviene probar: si uno falla, el siguiente.
// ─────────────────────────────────────────────────────────────────────────────

const ORIENTACIONES = [
  { valor: 'auto',              texto: 'Automática' },
  { valor: 'portrait',          texto: 'Vertical' },
  { valor: 'landscape',         texto: 'Horizontal' },
  { valor: 'reverse-landscape', texto: 'Horiz. invertida' },
];

export function PanelImpresionDirecta({ pedirPdf, pedirComandos, cuerpo, cuerpoPrueba = null, plan, total, bloqueado }) {
  const d = useImpresionDirecta({ pedirPdf, pedirComandos });
  const [verArchivo, setVerArchivo] = useState(false);

  const papel = plan?.geometria?.pagina;       // mm: lo que mide cada página (una fila en rollo)
  const dpi   = cuerpo?.impresora?.dpi || null;
  const conectado = d.estado === 'conectado';
  const listoParaImprimir = conectado && !!d.prefs.impresora && !!papel && !d.trabajando;
  const tam = papel ? `${mm(papel.ancho)} × ${mm(papel.alto)} mm` : '';

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-gray-500 leading-snug">
        Para impresoras de etiquetas. Imprime <strong>sin el diálogo de Chrome</strong>: la aplicación le dice a la
        impresora el tamaño exacto{tam ? ` (${tam})` : ''} y la orientación, como hacían los programas de
        etiquetas. Necesita <strong>QZ Tray</strong> abierto en este computador.
      </p>

      {/* 1. Conexión */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant={conectado ? 'secondary' : 'primary'} onClick={d.conectar}
          loading={d.estado === 'conectando'}>
          {conectado ? <RefreshCw size={13} /> : <Plug size={13} />}
          {conectado ? 'Recargar impresoras' : 'Conectar con QZ Tray'}
        </Button>
        {conectado && (
          <span className="inline-flex items-center gap-1 text-xs text-green-700">
            <CheckCircle2 size={13} /> Conectado
          </span>
        )}
      </div>
      {d.estado === 'sin_qz' && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 leading-snug">
          {d.error} Mientras tanto puedes usar el plan D (abajo), que no necesita QZ Tray.
          {' '}<a href="https://qz.io/download/" target="_blank" rel="noreferrer" className="underline font-medium">Descargar QZ Tray</a>
        </p>
      )}
      {conectado && !d.firmado && (
        <p className="text-[11px] text-gray-500 leading-snug">
          QZ Tray va a preguntar si permite imprimir a este sitio: elige <strong>Allow</strong>. Para que deje de
          preguntar, instala el certificado de la aplicación en este computador.
        </p>
      )}

      {conectado && (
        <>
          {/* 2. Impresora */}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">Impresora</span>
            <select value={d.prefs.impresora} onChange={(e) => d.cambiar({ impresora: e.target.value })}
              className="w-full px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white">
              {!d.impresoras.includes(d.prefs.impresora) && <option value="">Elige la impresora…</option>}
              {d.impresoras.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>

          {/* 3. Método */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-gray-600">Cómo mandarlo (si uno falla, prueba el siguiente)</span>
            <div className="grid gap-2">
              <Opcion activo={d.prefs.metodo === 'pdf'} onClick={() => d.cambiar({ metodo: 'pdf' })}
                titulo="A · PDF a tamaño exacto (recomendado)"
                desc={`El mismo diseño de la vista previa. QZ fija el papel en ${tam || 'la medida del formato'}; no hay que crear papeles en Windows.`} />
              <Opcion activo={d.prefs.metodo === 'tspl'} onClick={() => d.cambiar({ metodo: 'tspl' })}
                titulo="B · Comandos TSPL"
                desc="La impresora dibuja la etiqueta sin driver de por medio. Para DIG, TSC, Xprinter y casi todas las térmicas." />
              <Opcion activo={d.prefs.metodo === 'zpl'} onClick={() => d.cambiar({ metodo: 'zpl' })}
                titulo="C · Comandos ZPL"
                desc="Para Zebra o impresoras en modo ZPL. Úsalo si con B la impresora saca letras sueltas o nada." />
            </div>
          </div>

          {d.prefs.metodo === 'pdf' ? (
            <div className="flex flex-col gap-1">
              <Segmentado etiqueta="Orientación" opciones={ORIENTACIONES} valor={d.prefs.orientacion}
                onCambiar={(v) => d.cambiar({ orientacion: v })} />
              <span className="text-[11px] text-gray-400 leading-snug">
                Si la prueba sale de lado, cambia aquí y vuelve a imprimirla: con QZ Tray sí funciona.
                Si sale de cabeza, usa 180° en «Impresora».
              </span>
            </div>
          ) : (
            <span className="text-[11px] text-gray-400 leading-snug">
              Resolución: {dpi || 203} dpi{dpi ? '' : ' (por defecto)'}. Si la regla de la prueba no mide lo que
              dice, la impresora es de otra resolución: cámbiala en «Impresora». Si sale de cabeza, 180° en «Impresora».
              El desvío también se aplica; la escala no (aquí un punto es un punto).
            </span>
          )}

          <div className="flex gap-2">
            {cuerpoPrueba && (
              <Button size="sm" variant="secondary" className="flex-1" disabled={!listoParaImprimir}
                loading={d.trabajando} onClick={() => d.imprimir(cuerpoPrueba, papel, dpi, 'Prueba de etiquetas')}>
                <Printer size={13} /> Prueba directa
              </Button>
            )}
            <Button size="sm" className="flex-1" disabled={!listoParaImprimir || !total || bloqueado}
              loading={d.trabajando} onClick={() => d.imprimir(cuerpo, papel, dpi, 'Etiquetas')}>
              <Printer size={13} /> Imprimir {total || ''} directo
            </Button>
          </div>
        </>
      )}

      {d.error && d.estado !== 'sin_qz' && (
        <p className="flex items-start gap-1.5 text-xs text-red-600"><AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />{d.error}</p>
      )}
      {d.aviso && <p className="text-xs text-green-700">{d.aviso}</p>}

      {/* Plan D: sin QZ Tray */}
      <div className="rounded-lg border border-gray-200">
        <button type="button" onClick={() => setVerArchivo((v) => !v)}
          className="w-full flex items-center gap-1.5 px-2.5 py-2 text-left text-xs font-medium text-gray-600">
          {verArchivo ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <FileCode size={13} /> D · Sin QZ Tray: archivo para la impresora
        </button>
        {verArchivo && (
          <div className="px-2.5 pb-2.5 flex flex-col gap-2">
            <ol className="list-decimal pl-4 text-[11px] text-gray-600 leading-snug flex flex-col gap-0.5">
              <li>Windows → Impresoras → la impresora → Propiedades de impresora → <strong>Compartir</strong>, con el
                nombre <strong>{d.prefs.compartida || 'ETIQUETAS'}</strong> (una sola vez).</li>
              <li>Descarga <strong>imprimir-etiquetas.bat</strong> y déjalo en el Escritorio (una sola vez).</li>
              <li>Descarga el archivo .prn y <strong>arrástralo encima del .bat</strong>.</li>
            </ol>
            <label className="flex items-center gap-2 text-[11px] text-gray-600">
              Nombre compartido
              <input value={d.prefs.compartida} onChange={(e) => d.cambiar({ compartida: e.target.value })}
                className="flex-1 px-2 py-1 bg-gray-100 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="secondary" onClick={d.descargarBat}>
                <Download size={13} /> imprimir-etiquetas.bat
              </Button>
              {cuerpoPrueba && (
                <Button size="sm" variant="secondary" disabled={d.trabajando}
                  onClick={() => d.descargarPrn(cuerpoPrueba, 'tspl', 'prueba-tspl.prn')}>
                  <Download size={13} /> Prueba .prn (TSPL)
                </Button>
              )}
              <Button size="sm" variant="secondary" disabled={d.trabajando || !total || bloqueado}
                onClick={() => d.descargarPrn(cuerpo, 'tspl', 'etiquetas-tspl.prn')}>
                <Download size={13} /> Etiquetas .prn (TSPL)
              </Button>
              <Button size="sm" variant="secondary" disabled={d.trabajando || !total || bloqueado}
                onClick={() => d.descargarPrn(cuerpo, 'zpl', 'etiquetas-zpl.prn')}>
                <Download size={13} /> Etiquetas .prn (ZPL)
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default PanelImpresionDirecta;
