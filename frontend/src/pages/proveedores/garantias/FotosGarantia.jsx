import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, FileText, Loader2, Ban, X } from 'lucide-react';
import { bajarFotoGarantia, adjuntarFotoGarantia, anularFotoGarantia } from '../../../api/garantiasProveedor.api';
import { descargarBlob } from '../../../utils/descargarArchivo';
import { formatFechaHora } from '../../../utils/formatters';
import { mensajeError } from './garantiasUi';

// ─────────────────────────────────────────────────────────────────────────────
// Las fotos de una garantía: la prueba que pide el proveedor. El almacenamiento
// es PRIVADO, así que cada miniatura se baja con la sesión (blob) y nunca hay un
// enlace público. Nada se borra: una foto equivocada se anula con su motivo.
// ─────────────────────────────────────────────────────────────────────────────

function Miniatura({ foto, onAbrir }) {
  const esPdf = foto.mime === 'application/pdf';
  const { data: blob, isLoading, isError } = useQuery({
    queryKey: ['garantia-foto', foto.id],
    queryFn:  () => bajarFotoGarantia(foto.id).then((r) => r.data),
    enabled:  !esPdf && !foto.anulado,
    staleTime: Infinity,
    retry: false,
  });
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  // Liberar el enlace temporal al desmontar (o al cambiar de foto).
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  return (
    <button type="button" onClick={() => onAbrir(foto, url)} title={foto.nota || foto.nombre_original}
      className={`relative w-20 h-20 rounded-xl border overflow-hidden flex items-center justify-center bg-gray-50
        ${foto.anulado ? 'opacity-40 border-gray-200' : 'border-gray-200 hover:border-rose-300'}`}>
      {esPdf ? <FileText size={22} className="text-gray-400" />
        : isLoading ? <Loader2 size={18} className="text-gray-300 animate-spin" />
          : isError || !url ? <Camera size={18} className="text-gray-300" />
            : <img src={url} alt={foto.nombre_original} className="w-full h-full object-cover" />}
      {foto.anulado && <span className="absolute bottom-0 inset-x-0 text-[9px] bg-gray-700 text-white">Anulada</span>}
    </button>
  );
}

export function FotosGarantia({ reclamoId, archivos = [], puedeAdjuntar, puedeAnular, activas }) {
  const queryClient = useQueryClient();
  const input = useRef(null);
  const [subiendo, setSubiendo] = useState(0);
  const [error, setError] = useState('');
  const [vista, setVista] = useState(null);       // { foto, url }
  const [motivo, setMotivo] = useState('');

  const refrescar = () => queryClient.invalidateQueries({ queryKey: ['garantia-proveedor', reclamoId] });

  const subir = async (archivosElegidos) => {
    setError('');
    const lista = [...archivosElegidos];
    for (let i = 0; i < lista.length; i++) {
      setSubiendo(lista.length - i);
      try {
        await adjuntarFotoGarantia(reclamoId, lista[i]);
      } catch (err) {
        setError(`${lista[i].name}: ${mensajeError(err, 'no se pudo guardar')}`);
      }
    }
    setSubiendo(0);
    refrescar();
  };

  const mutAnular = useMutation({
    mutationFn: () => anularFotoGarantia(vista.foto.id, motivo),
    onSuccess: () => { setVista(null); setMotivo(''); refrescar(); },
    onError: (err) => setError(mensajeError(err, 'No se pudo anular la foto')),
  });

  const abrir = async (foto, url) => {
    if (foto.mime === 'application/pdf') {
      try {
        const r = await bajarFotoGarantia(foto.id);
        descargarBlob(r.data, foto.nombre_original);
      } catch (err) { setError(mensajeError(err, 'No se pudo abrir el archivo')); }
      return;
    }
    setVista({ foto, url });
  };

  const vivas = archivos.filter((a) => !a.anulado);
  if (!activas && archivos.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Camera size={14} className="text-gray-400" />
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex-1">
          Fotos {vivas.length ? `(${vivas.length})` : ''}
        </p>
        {activas && puedeAdjuntar && (
          <>
            <input ref={input} type="file" accept="image/*,application/pdf" multiple className="hidden"
              onChange={(e) => { if (e.target.files?.length) subir(e.target.files); e.target.value = ''; }} />
            <button type="button" onClick={() => input.current?.click()} disabled={subiendo > 0}
              className="text-xs font-medium text-rose-700 hover:underline disabled:opacity-50 flex items-center gap-1">
              {subiendo > 0 ? <><Loader2 size={12} className="animate-spin" /> Subiendo ({subiendo})…</> : '+ Agregar fotos'}
            </button>
          </>
        )}
      </div>
      {archivos.length === 0 ? (
        <p className="text-xs text-gray-400">Sin fotos. Una foto del daño es la prueba que pide el proveedor.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {archivos.map((a) => <Miniatura key={a.id} foto={a} onAbrir={abrir} />)}
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}

      {vista && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex flex-col items-center justify-center p-4" onClick={() => setVista(null)}>
          <div className="w-full max-w-3xl flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between text-white">
              <p className="text-sm truncate">{vista.foto.nombre_original} · {formatFechaHora(vista.foto.fecha)}{vista.foto.usuario_nombre ? ` · ${vista.foto.usuario_nombre}` : ''}</p>
              <button type="button" onClick={() => setVista(null)} className="p-2 rounded-lg hover:bg-white/10"><X size={18} /></button>
            </div>
            {vista.url
              ? <img src={vista.url} alt={vista.foto.nombre_original} className="max-h-[70vh] w-auto mx-auto rounded-xl" />
              : <p className="text-white text-sm text-center py-10">{vista.foto.anulado ? 'Foto anulada' : 'Cargando…'}</p>}
            {vista.foto.nota && <p className="text-sm text-gray-200">{vista.foto.nota}</p>}
            {vista.foto.anulado && <p className="text-sm text-red-300">Anulada: {vista.foto.anulado_motivo}</p>}
            {!vista.foto.anulado && puedeAnular && (
              <div className="flex gap-2">
                <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo para anular esta foto"
                  className="flex-1 px-3 py-2 rounded-xl text-sm" />
                <button type="button" disabled={motivo.trim().length < 3 || mutAnular.isPending} onClick={() => mutAnular.mutate()}
                  className="px-3 py-2 rounded-xl bg-red-600 text-white text-sm disabled:opacity-50 flex items-center gap-1">
                  <Ban size={14} /> Anular
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
