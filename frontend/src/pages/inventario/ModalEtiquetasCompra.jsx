import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Printer, Download, AlertTriangle, CheckCircle2, ExternalLink, Truck, Tag, Info,
} from 'lucide-react';
import { Modal }   from '../../components/ui/Modal';
import { Button }  from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import {
  getEtiquetasCompra, planEtiquetasCompra, pdfEtiquetasCompra,
} from '../../api/etiquetas.api';
import useEtiquetas, { leerPreferencias, calibracionDe } from '../../hooks/useEtiquetas';
import { resolverElegido, TEXTO_AVISO, AVISOS_GRAVES } from './etiquetas/etiquetasUi';

// ─────────────────────────────────────────────────────────────────────────────
// ETIQUETAS DE UNA COMPRA — al recibir, y para reimprimir
//
// Se abre sola al registrar una compra, una recepción de orden o una Entrada de
// bodega (con `proveedor_codigo_activo`), y desde el detalle de cualquiera de
// ellas para reimprimir. Es la misma pantalla en los dos casos: si alguien la
// cerró sin querer, la compra sigue ahí y lo que se reimprime es lo que entró.
//
// NO trae editor de papel, diseño ni calibración: usa lo que ese navegador ya
// tiene guardado en Inventario → Etiquetas (`leerPreferencias`). Quien recibe
// mercancía no está para medir rollos — y un segundo editor acabaría con dos
// configuraciones distintas para la misma impresora.
//
// Lo único que se decide aquí es CUÁNTAS: por defecto una por unidad recibida
// (menos lo ya devuelto), y se puede bajar a una sola para reponer la etiqueta
// que se rompió.
// ─────────────────────────────────────────────────────────────────────────────

const TEXTO_PROBLEMA = {
  sin_codigo: 'no tiene código — genéralo en Inventario → Etiquetas',
  sin_nodo:   'el producto ahora se vende por variantes: etiqueta cada talla desde Inventario',
  sin_unidad: 'el equipo ya no está en esta sucursal',
};

const CAMPOS_DISENO = { nombre: 'nombre', variante: 'variante', precio: 'precio', encabezado: 'encabezado', pie: 'pie' };

export function ModalEtiquetasCompra({ compraId, onClose, recienRegistrada = false, titulo }) {
  // Se lee UNA vez: esta pantalla no las cambia.
  const [prefs] = useState(leerPreferencias);
  const [cantidades, setCantidades] = useState({});   // linea_id → n (solo lo cambiado)
  const [conProveedor, setConProveedor] = useState(true);

  const pedirPdf = useCallback((body) => pdfEtiquetasCompra(compraId, body), [compraId]);
  const { generando, error, imprimir, descargar, previsualizar, abrir } = useEtiquetas(pedirPdf);

  const { data, isLoading, isError, error: errorCarga } = useQuery({
    queryKey: ['etiquetas-compra', compraId],
    queryFn:  () => getEtiquetasCompra(compraId).then((r) => r.data.data),
    retry: false,
  });
  const compra = data?.compra;
  const lineas = useMemo(() => data?.lineas || [], [data]);

  // El mismo cuerpo que arma Inventario, con la configuración guardada.
  const cuerpo = useMemo(() => {
    const el = resolverElegido(prefs, []);
    const c  = calibracionDe(prefs, el.clave);
    return {
      formato:         el.formato,
      personalizado:   el.personalizado,
      simbologia:      prefs.simbologia,
      mostrar:         { ...prefs.mostrar, proveedor: conProveedor },
      encabezadoTexto: prefs.encabezadoTexto,
      pieTexto:        prefs.pieTexto,
      diseno:          prefs.diseno,
      marco:           prefs.marco,
      ajuste:          c.ajuste,
      impresora:       { rotacion: c.rotacion, escala: c.escala, dpi: c.dpi },
      desde:           1,
      cantidades,
    };
  }, [prefs, cantidades, conProveedor]);

  // ── Plan ───────────────────────────────────────────────────────────────────
  const [plan, setPlan] = useState(null);
  const [errorPlan, setErrorPlan] = useState('');
  const listo = !!data;
  useEffect(() => {
    if (!listo) return undefined;
    let vivo = true;
    const t = setTimeout(() => {
      planEtiquetasCompra(compraId, cuerpo)
        .then((r) => { if (vivo) { setPlan(r.data.data); setErrorPlan(''); } })
        .catch((e) => {
          if (!vivo) return;
          setPlan(null);
          setErrorPlan(e?.response?.data?.error || 'No se pudo calcular las etiquetas');
        });
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [cuerpo, compraId, listo]);

  // ── Vista previa: el PDF real, una página ─────────────────────────────────
  const [previa, setPrevia] = useState(null);
  const previaAnterior = useRef(null);
  const porPagina = plan?.porPagina;
  const total = plan?.total || 0;
  useEffect(() => {
    let vivo = true;
    const t = setTimeout(async () => {
      if (!total || errorPlan) { setPrevia(null); return; }
      const url = await previsualizar({ ...cuerpo, limite: porPagina || 12 });
      if (!vivo) { if (url) URL.revokeObjectURL(url); return; }
      if (previaAnterior.current) URL.revokeObjectURL(previaAnterior.current);
      previaAnterior.current = url;
      setPrevia(url);
    }, 600);
    return () => { vivo = false; clearTimeout(t); };
  }, [cuerpo, total, porPagina, previsualizar, errorPlan]);

  useEffect(() => () => {
    if (previaAnterior.current) URL.revokeObjectURL(previaAnterior.current);
  }, []);

  const cantidadDe = (l) => (cantidades[l.linea_id] ?? l.cantidad);
  const cambiarCantidad = (l, v) => setCantidades((c) => ({
    ...c, [l.linea_id]: v === '' ? '' : Math.max(0, Math.floor(Number(v) || 0)),
  }));
  const todasEn = (n) => setCantidades(Object.fromEntries(
    lineas.filter((l) => !l.problema).map((l) => [l.linea_id, n === null ? l.cantidad : n]),
  ));

  const avisosReales = (plan?.avisos || []).filter((a) => TEXTO_AVISO[a]);
  const numero = compra ? String(compra.numero).padStart(5, '0') : '';
  const resumenDiseno = [
    prefs.simbologia === 'qr' ? 'QR' : 'Código de barras',
    ...Object.keys(CAMPOS_DISENO).filter((k) => prefs.mostrar[k]),
  ].join(' · ');

  return (
    <Modal open onClose={onClose} size="xl" title={titulo || (compra ? `Etiquetas · compra #${numero}` : 'Etiquetas')}>
      {isLoading ? <Spinner className="py-12" /> : isError ? (
        <div className="flex flex-col gap-3 py-4">
          <p className="text-sm text-red-600">
            {errorCarga?.response?.data?.error || 'No se pudieron cargar las etiquetas de esta compra.'}
          </p>
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {recienRegistrada && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
              <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-emerald-800">
                Mercancía registrada. Imprime las etiquetas ahora que tienes la caja abierta.
              </p>
            </div>
          )}

          {/* ── De quién vino ─────────────────────────────────────────────── */}
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-100">
            <Truck size={16} className="text-gray-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              {compra?.proveedor_nombre ? (
                <>
                  <p className="text-sm text-gray-800 truncate">{compra.proveedor_nombre}</p>
                  {compra.codigo_proveedor
                    ? <p className="text-xs font-mono text-gray-600">{compra.codigo_proveedor}</p>
                    : <p className="text-xs text-amber-700">
                        Este proveedor todavía no tiene código: complétale el NIT y la ciudad en Proveedores
                        y reimprime desde la compra.
                      </p>}
                </>
              ) : (
                <p className="text-xs text-amber-700">
                  Esta entrada llegó sin proveedor: las etiquetas saldrán sin su código. Cuando
                  administración la confirme, puedes reimprimirlas desde el detalle de la entrada.
                </p>
              )}
            </div>
            {compra?.codigo_proveedor && (
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer flex-shrink-0">
                <input type="checkbox" checked={conProveedor} onChange={(e) => setConProveedor(e.target.checked)}
                  className="rounded border-gray-300" />
                En la etiqueta
              </label>
            )}
          </div>

          {/* ── Cuántas de cada línea ─────────────────────────────────────── */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Qué imprimir</p>
              <div className="flex gap-3 text-xs">
                <button type="button" onClick={() => todasEn(null)} className="text-blue-600 hover:underline">
                  Una por unidad
                </button>
                <button type="button" onClick={() => todasEn(1)} className="text-blue-600 hover:underline">
                  Una de cada
                </button>
                <button type="button" onClick={() => todasEn(0)} className="text-gray-400 hover:underline">
                  Ninguna
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-1 max-h-[16rem] overflow-y-auto pr-1">
              {lineas.map((l) => (
                <div key={l.linea_id}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border
                    ${l.problema ? 'border-gray-100 bg-gray-50' : 'border-gray-100 bg-white'}`}>
                  <Tag size={14} className={l.problema ? 'text-gray-300' : 'text-gray-400'} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${l.problema ? 'text-gray-400' : 'text-gray-800'}`}>{l.nombre}</p>
                    <p className="text-xs text-gray-400 truncate">
                      {l.variante_label && <span className="text-gray-500">{l.variante_label} · </span>}
                      {l.problema
                        ? <span className="text-amber-600">{TEXTO_PROBLEMA[l.problema] || 'no se puede etiquetar'}</span>
                        : <span className="font-mono">{l.codigo}</span>}
                      {!l.problema && l.tipo === 'cantidad' && <span> · entraron {l.cantidad}</span>}
                      {l.vendido && <span> · ya vendido</span>}
                    </p>
                  </div>
                  {!l.problema && (
                    <input
                      type="number" min="0" max="999" value={cantidadDe(l)}
                      onChange={(e) => cambiarCantidad(l, e.target.value)}
                      aria-label={`Etiquetas de ${l.nombre}`}
                      className="w-16 px-1.5 py-1 text-sm text-center border border-gray-200 rounded-lg
                        focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ── Configuración usada ───────────────────────────────────────── */}
          <p className="flex items-start gap-1.5 text-xs text-gray-500">
            <Info size={13} className="flex-shrink-0 mt-0.5" />
            <span>
              {plan?.formato?.nombre || 'Formato guardado'} · {resumenDiseno}. Es la configuración
              guardada en Inventario → Etiquetas en este equipo; cámbiala allá si necesitas otro papel.
            </span>
          </p>

          {/* ── Vista previa ──────────────────────────────────────────────── */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Vista previa</p>
              {previa && (
                <button type="button" onClick={() => abrir({ ...cuerpo, limite: porPagina || 12 })}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                  <ExternalLink size={12} /> Abrir aparte
                </button>
              )}
            </div>
            <div className="relative rounded-xl border border-gray-200 bg-gray-100 overflow-hidden" style={{ height: '13rem' }}>
              {previa
                ? <iframe title="Vista previa de etiquetas" src={`${previa}#toolbar=0&navpanes=0&view=Fit`}
                    className="w-full h-full bg-white" />
                : (
                  <div className="w-full h-full flex items-center justify-center text-center px-6">
                    {generando ? <Spinner /> : (
                      <p className="text-xs text-gray-400">
                        {errorPlan || (total ? 'Preparando la previa...' : 'No hay etiquetas para imprimir.')}
                      </p>
                    )}
                  </div>
                )}
            </div>

            {total > 0 && (
              <p className="text-xs text-gray-500">
                <strong className="text-gray-800">{total}</strong> etiquetas en{' '}
                <strong className="text-gray-800">{plan.paginas}</strong>{' '}
                {plan.geometria?.medio === 'rollo'
                  ? (plan.paginas === 1 ? 'fila del rollo' : 'filas del rollo')
                  : (plan.paginas === 1 ? 'hoja' : 'hojas')}
              </p>
            )}
            {plan?.recortado && (
              <p className="flex items-start gap-1.5 text-xs text-amber-700">
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                Se cortó en {plan.maximo} etiquetas: imprime por partes bajando las cantidades.
              </p>
            )}
            {avisosReales.map((a) => (
              <p key={a} className={`flex items-start gap-1.5 text-xs ${AVISOS_GRAVES.has(a) ? 'text-red-600' : 'text-gray-500'}`}>
                <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                {TEXTO_AVISO[a]}
              </p>
            ))}
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          {recienRegistrada && (
            <p className="text-[11px] text-gray-400">
              Si cierras esta ventana, las etiquetas se pueden reimprimir desde el detalle de la compra.
            </p>
          )}

          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={generando}>
              {recienRegistrada ? 'Ahora no' : 'Cerrar'}
            </Button>
            <Button variant="secondary" className="flex-1" disabled={!total || generando || !!errorPlan}
              onClick={() => descargar(cuerpo, `etiquetas-compra-${compra?.numero ?? compraId}.pdf`)}>
              <Download size={15} /> Descargar
            </Button>
            <Button className="flex-1" loading={generando} disabled={!total || !!errorPlan}
              onClick={() => imprimir(cuerpo)}>
              <Printer size={15} /> Imprimir
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default ModalEtiquetasCompra;
