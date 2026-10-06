import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Paperclip, FileText, Image as ImageIcon, FileSpreadsheet, File as FileIcon,
  Download, Eye, Ban, Plus, AlertTriangle, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  getArchivosCompra, subirArchivoCompra, descargarArchivoCompra, anularArchivoCompra,
} from '../../api/compras.api';
import { useAuth } from '../../context/useAuth';
import { formatFechaHora } from '../../utils/formatters';
import {
  TIPOS_DOCUMENTO, TIPO_POR_DEFECTO, ACEPTA, etiquetaTipo, formatBytes,
  seAbreEnNavegador, claseDeArchivo, puedeAdjuntarArchivosCompra, mensajeDeError,
} from '../../utils/archivosCompra';

// ─────────────────────────────────────────────────────────────────────────────
// ARCHIVOS DE UNA COMPRA — el manifiesto de importación y sus papeles.
//
// Una sola pieza para los dos sitios donde aparece: el detalle de la compra y
// el paso que sigue a registrarla. Quien la monta ya comprobó que la feature
// está encendida y que el usuario puede ver compras (`puedeVerArchivosCompra`).
//
// NO HAY BORRAR, y no es un olvido: un archivo que no corresponde se ANULA con
// su motivo (solo el admin) y sigue guardado. Por eso el botón dice «Anular» y
// los anulados se pueden desplegar y volver a bajar.
//
// El archivo no tiene URL: se pide como blob con la sesión y se abre desde la
// memoria del navegador.
// ─────────────────────────────────────────────────────────────────────────────

const ICONOS = { pdf: FileText, imagen: ImageIcon, hoja: FileSpreadsheet, otro: FileIcon };

const FORM_VACIO = { tipo: TIPO_POR_DEFECTO, numero_documento: '', fecha_documento: '', nota: '' };

const CAMPO = 'w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-800 '
  + 'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';

// Entrega el blob al usuario. `ventana` es una pestaña abierta ANTES de pedir
// el archivo: si se abriera después de la espera, el navegador la bloquearía
// como ventana emergente.
function entregarBlob(blob, nombre, ventana) {
  const url = URL.createObjectURL(blob);
  if (ventana && !ventana.closed) {
    ventana.location.href = url;
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  // La pestaña necesita la URL viva mientras carga; un minuto sobra.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function FilaArchivo({ archivo, esAdmin, ocupado, onAbrir, onAnular }) {
  const Icono = ICONOS[claseDeArchivo(archivo.mime)] ?? FileIcon;
  const visible = seAbreEnNavegador(archivo.mime);
  return (
    <div className={`rounded-xl p-3 flex flex-col gap-1.5 ${archivo.anulado ? 'bg-gray-50 opacity-70' : 'bg-gray-50'}`}>
      <div className="flex items-start gap-2.5">
        <Icono size={18} className="text-gray-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium text-gray-800 ${archivo.anulado ? 'line-through' : ''}`}>
            {etiquetaTipo(archivo.tipo)}
            {archivo.numero_documento && (
              <span className="font-mono text-gray-600"> · N.º {archivo.numero_documento}</span>
            )}
          </p>
          <p className="text-xs text-gray-500 break-all">{archivo.nombre_original}</p>
          <p className="text-xs text-gray-400">
            {formatBytes(archivo.bytes)}
            {archivo.fecha_documento && <> · del {archivo.fecha_documento}</>}
            {' · '}subido el {formatFechaHora(archivo.creado_en)}
            {archivo.subido_por_nombre && <> por {archivo.subido_por_nombre}</>}
          </p>
          {archivo.nota && <p className="text-xs text-gray-600 mt-0.5">{archivo.nota}</p>}
          {archivo.anulado && (
            <p className="text-xs text-red-600 mt-0.5">
              Anulado el {formatFechaHora(archivo.anulado_en)}
              {archivo.anulado_por_nombre && <> por {archivo.anulado_por_nombre}</>}
              {archivo.motivo_anulacion && <>: {archivo.motivo_anulacion}</>}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {visible && (
            <button type="button" disabled={ocupado} onClick={() => onAbrir(archivo, true)}
              title="Ver" aria-label={`Ver ${archivo.nombre_original}`}
              className="p-2 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-40">
              <Eye size={16} />
            </button>
          )}
          <button type="button" disabled={ocupado} onClick={() => onAbrir(archivo, false)}
            title="Descargar" aria-label={`Descargar ${archivo.nombre_original}`}
            className="p-2 rounded-lg text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-40">
            <Download size={16} />
          </button>
          {esAdmin && !archivo.anulado && (
            <button type="button" disabled={ocupado} onClick={() => onAnular(archivo)}
              title="Anular" aria-label={`Anular ${archivo.nombre_original}`}
              className="p-2 rounded-lg text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40">
              <Ban size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ArchivosCompra({ compraId }) {
  const queryClient = useQueryClient();
  const { usuario } = useAuth();
  const esAdmin       = usuario?.rol === 'admin_negocio';
  const puedeAdjuntar = puedeAdjuntarArchivosCompra(usuario);

  const inputArchivo = useRef(null);
  const [abierto,   setAbierto]   = useState(false);
  const [archivo,   setArchivo]   = useState(null);
  const [form,      setForm]      = useState(FORM_VACIO);
  const [error,     setError]     = useState('');
  const [bajando,   setBajando]   = useState(null);     // id del archivo que se está pidiendo
  const [porAnular, setPorAnular] = useState(null);     // la ficha que se va a anular
  const [motivo,    setMotivo]    = useState('');
  const [verAnulados, setVerAnulados] = useState(false);

  const queryKey = ['compra-archivos', compraId];
  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn:  () => getArchivosCompra(compraId).then((r) => r.data.data),
    enabled:  !!compraId,
  });

  const archivos  = data?.archivos ?? [];
  const vigentes  = archivos.filter((a) => !a.anulado);
  const anulados  = archivos.filter((a) => a.anulado);
  const limites   = data?.limites;
  const lleno     = limites ? vigentes.length >= limites.max_por_compra : false;
  const sinDonde  = data ? data.almacenamiento === false : false;

  const cerrarForm = () => {
    setAbierto(false);
    setArchivo(null);
    setForm(FORM_VACIO);
    if (inputArchivo.current) inputArchivo.current.value = '';
  };

  const mutSubir = useMutation({
    mutationFn: () => subirArchivoCompra(compraId, archivo, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      cerrarForm();
      setError('');
    },
    onError: async (err) => {
      setError(await mensajeDeError(err, 'No se pudo adjuntar el archivo'));
      // Un corte a media subida no dice si llegó: la lista sí.
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const mutAnular = useMutation({
    mutationFn: () => anularArchivoCompra(porAnular.id, motivo.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setPorAnular(null);
      setMotivo('');
      setError('');
    },
    onError: async (err) => setError(await mensajeDeError(err, 'No se pudo anular el archivo')),
  });

  const elegirArchivo = (e) => {
    const f = e.target.files?.[0] || null;
    setError('');
    if (f && limites && f.size > limites.max_bytes) {
      setArchivo(null);
      e.target.value = '';
      setError(`Ese archivo pesa ${formatBytes(f.size)} y el máximo es ${formatBytes(limites.max_bytes)}`);
      return;
    }
    setArchivo(f);
  };

  const abrir = async (a, enPestana) => {
    setError('');
    // La pestaña se abre YA, dentro del clic; después de la espera el navegador
    // la trataría como ventana emergente.
    const ventana = enPestana ? window.open('', '_blank') : null;
    setBajando(a.id);
    try {
      const res = await descargarArchivoCompra(a.id);
      entregarBlob(res.data, a.nombre_original, ventana);
    } catch (err) {
      if (ventana && !ventana.closed) ventana.close();
      setError(await mensajeDeError(err, 'No se pudo abrir el archivo'));
    } finally {
      setBajando(null);
    }
  };

  const setCampo = (k, v) => setForm((prev) => ({ ...prev, [k]: v }));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
          <Paperclip size={14} className="text-gray-400" />
          Documentos de la compra
          {vigentes.length > 0 && <span className="text-xs font-normal text-gray-400">({vigentes.length})</span>}
        </p>
        {puedeAdjuntar && !abierto && !sinDonde && !lleno && !isError && (
          <button type="button" onClick={() => { setAbierto(true); setError(''); }}
            className="px-3 py-1.5 rounded-xl text-xs border border-blue-200 text-blue-700 bg-blue-50
              hover:bg-blue-100 transition-colors font-medium flex items-center gap-1">
            <Plus size={13} /> Adjuntar
          </button>
        )}
      </div>

      {isLoading && <p className="text-xs text-gray-400">Cargando documentos…</p>}
      {isError && (
        <p className="text-xs text-red-600">
          No se pudieron cargar los documentos. Siguen guardados: cierra y vuelve a abrir la compra.
        </p>
      )}

      {sinDonde && (
        <div className="bg-amber-50 rounded-xl px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">
            Por ahora no se pueden adjuntar archivos: el almacenamiento de documentos no está
            configurado en el servidor. Lo que ya estaba adjunto sigue guardado.
          </p>
        </div>
      )}

      {!isLoading && !isError && vigentes.length === 0 && !abierto && (
        <p className="text-xs text-gray-400 italic">
          Sin documentos. Adjunta el manifiesto de importación, la declaración o la factura
          para que queden guardados con esta compra.
        </p>
      )}

      {vigentes.map((a) => (
        <FilaArchivo key={a.id} archivo={a} esAdmin={esAdmin} ocupado={bajando === a.id}
          onAbrir={abrir} onAnular={(x) => { setPorAnular(x); setMotivo(''); setError(''); }} />
      ))}

      {lleno && (
        <p className="text-xs text-gray-400">
          Esta compra ya tiene el máximo de {limites.max_por_compra} documentos.
        </p>
      )}

      {/* ── Anular: con motivo, y el archivo se queda guardado ─────────────── */}
      {porAnular && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-sm font-semibold text-red-700">
            ¿Anular «{porAnular.nombre_original}»?
          </p>
          <p className="text-xs text-red-600 leading-relaxed">
            Deja de aparecer en la compra, pero <strong>no se borra</strong>: queda guardado con
            el motivo y lo puedes seguir consultando en «Anulados».
          </p>
          <input type="text" value={motivo} maxLength={300} autoFocus
            placeholder="Motivo (obligatorio). Ej: era el manifiesto de otra compra"
            onChange={(e) => setMotivo(e.target.value)} className={CAMPO} />
          <div className="flex gap-2">
            <button type="button" onClick={() => { setPorAnular(null); setMotivo(''); }}
              className="flex-1 py-2 rounded-xl text-sm border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 transition-colors">
              No, dejarlo
            </button>
            <button type="button" onClick={() => mutAnular.mutate()}
              disabled={mutAnular.isPending || !motivo.trim()}
              className="flex-1 py-2 rounded-xl text-sm bg-red-500 hover:bg-red-600 text-white font-medium transition-colors disabled:opacity-50">
              {mutAnular.isPending ? 'Anulando…' : 'Anular archivo'}
            </button>
          </div>
        </div>
      )}

      {/* ── Adjuntar ───────────────────────────────────────────────────────── */}
      {abierto && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex flex-col gap-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-600">Qué documento es</span>
              <select value={form.tipo} onChange={(e) => setCampo('tipo', e.target.value)} className={CAMPO}>
                {Object.entries(TIPOS_DOCUMENTO).map(([id, nombre]) => (
                  <option key={id} value={id}>{nombre}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-600">Número del documento (opcional)</span>
              <input type="text" value={form.numero_documento} maxLength={60}
                placeholder="El que trae impreso"
                onChange={(e) => setCampo('numero_documento', e.target.value)} className={CAMPO} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-600">Fecha del documento (opcional)</span>
              <input type="date" value={form.fecha_documento}
                onChange={(e) => setCampo('fecha_documento', e.target.value)} className={CAMPO} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-600">Nota (opcional)</span>
              <input type="text" value={form.nota} maxLength={300}
                placeholder="Ej: contenedor 2 de 3"
                onChange={(e) => setCampo('nota', e.target.value)} className={CAMPO} />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">Archivo</span>
            <input ref={inputArchivo} type="file" accept={ACEPTA} onChange={elegirArchivo}
              className="text-sm text-gray-700 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0
                file:bg-white file:text-blue-700 file:text-sm file:font-medium file:cursor-pointer" />
            <span className="text-xs text-gray-500">
              {limites
                ? `${limites.tipos_archivo}. Hasta ${formatBytes(limites.max_bytes)}.`
                : 'PDF, imagen, Excel o Word.'}
            </span>
          </label>

          <div className="flex gap-2">
            <button type="button" onClick={() => { cerrarForm(); setError(''); }} disabled={mutSubir.isPending}
              className="flex-1 py-2 rounded-xl text-sm border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 transition-colors disabled:opacity-50">
              Cancelar
            </button>
            <button type="button" onClick={() => { setError(''); mutSubir.mutate(); }}
              disabled={mutSubir.isPending || !archivo}
              className="flex-1 py-2 rounded-xl text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-50">
              {mutSubir.isPending ? 'Subiendo…' : 'Adjuntar a la compra'}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600 font-medium">{error}</p>}

      {/* ── Anulados: siguen guardados y el admin los puede revisar ────────── */}
      {anulados.length > 0 && (
        <div className="flex flex-col gap-2">
          <button type="button" onClick={() => setVerAnulados((v) => !v)}
            className="self-start text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
            {verAnulados ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {anulados.length === 1 ? '1 anulado' : `${anulados.length} anulados`}
          </button>
          {verAnulados && anulados.map((a) => (
            <FilaArchivo key={a.id} archivo={a} esAdmin={esAdmin} ocupado={bajando === a.id}
              onAbrir={abrir} onAnular={() => {}} />
          ))}
        </div>
      )}
    </div>
  );
}

export default ArchivosCompra;
