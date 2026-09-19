import { FileDown, Share2, Loader2 } from 'lucide-react';
import useExportarPdfRedInterna from '../../hooks/useExportarPdfRedInterna';

// ─────────────────────────────────────────────────────────────────────────────
// Botón de PDF de la red interna: descargar y, en el celular, compartir (la
// hoja nativa: WhatsApp, correo…). Los datos, los permisos y qué valores ve
// cada quien los decide el backend — este botón solo pide el archivo.
//
// `pdf` = { ruta, nombreArchivo, titulo, texto }
// ─────────────────────────────────────────────────────────────────────────────
export function BotonPdfRed({ pdf, etiqueta = 'PDF', compacto = false }) {
  const { exportando, error, exportar, puedeCompartir } = useExportarPdfRedInterna();

  const base = compacto
    ? 'inline-flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 transition-colors disabled:opacity-50'
    : 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors disabled:opacity-50';

  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex items-center gap-2">
        <button type="button" className={base} disabled={exportando}
          onClick={(e) => { e.stopPropagation(); exportar(pdf, 'descargar'); }}
          title={`Descargar ${pdf.titulo}`}>
          {exportando ? <Loader2 size={compacto ? 12 : 14} className="animate-spin" /> : <FileDown size={compacto ? 12 : 14} />}
          {etiqueta}
        </button>
        {puedeCompartir && (
          <button type="button" className={base} disabled={exportando}
            onClick={(e) => { e.stopPropagation(); exportar(pdf, 'compartir'); }}
            title={`Compartir ${pdf.titulo}`}>
            <Share2 size={compacto ? 12 : 14} />
            {!compacto && 'Compartir'}
          </button>
        )}
      </span>
      {error && <span className="text-xs text-red-600 mt-1">{error}</span>}
    </span>
  );
}
