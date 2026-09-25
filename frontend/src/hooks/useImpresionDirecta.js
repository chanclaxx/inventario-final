import { useCallback, useState } from 'react';
import {
  conectarQz, listarImpresoras, imprimirPdfQz, imprimirComandosQz, mensajeQz, papelesDe,
} from '../utils/qzTray';

// ── Impresión directa en la impresora de etiquetas ───────────────────────────
//
// Tres métodos, porque cada impresora y cada driver fallan distinto y quien
// está frente a la impresora necesita un plan B sin llamar a nadie:
//
//   · 'tspl' → comandos TSPL por QZ Tray: la impresora dibuja la etiqueta. Sin
//              driver de por medio (TSC, DIG, Xprinter y la mayoría de térmicas).
//              Es el POR DEFECTO: en la simulación contra QZ Tray 2.3 real los
//              bytes llegaron idénticos al puerto, y 300 etiquetas fueron 165 KB
//              en 2,6 s.
//   · 'pdf'  → el mismo PDF de la vista previa, por QZ Tray, con el papel y la
//              orientación pedidos por la aplicación. Conserva el diseño exacto,
//              pero DEPENDE del driver: si no acepta tamaños libres, imprime en
//              su papel por defecto (`papelesDe` avisa antes). Y pesa: 300
//              etiquetas rasterizadas fueron 10,9 MB y 15 s.
//   · 'zpl'  → comandos ZPL (Zebra, o impresoras en emulación ZPL).
//
// Y sin QZ Tray, el archivo .prn con los comandos, que se manda a la impresora
// compartida arrastrándolo sobre un .bat (ver `descargarBat`).
//
// Todo se recuerda en ESTE navegador: la impresora es de este computador.

const CLAVE = 'etiquetas_impresion_directa';
const DEFECTO = { impresora: '', metodo: 'tspl', orientacion: 'auto', compartida: 'ETIQUETAS' };

export const METODOS = ['tspl', 'pdf', 'zpl'];
export const ORIENTACIONES = ['auto', 'portrait', 'landscape', 'reverse-landscape'];

export const leerDirecta = () => {
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE) || '{}');
    return {
      ...DEFECTO, ...g,
      metodo:      METODOS.includes(g.metodo) ? g.metodo : DEFECTO.metodo,
      orientacion: ORIENTACIONES.includes(g.orientacion) ? g.orientacion : DEFECTO.orientacion,
    };
  } catch { return { ...DEFECTO }; }
};

const _guardar = (p) => { try { localStorage.setItem(CLAVE, JSON.stringify(p)); } catch { /* sin memoria */ } };

const _mensajeDeBlob = async (blob) => {
  try { const j = JSON.parse(await blob.text()); return j.error || j.message || null; } catch { return null; }
};

/** Un blob que resultó ser un error JSON del backend → excepción con su mensaje. */
const _exigirBinario = async (data, tipo) => {
  if (data?.type === 'application/json') throw new Error(await _mensajeDeBlob(data) || 'No se pudo generar');
  return new Blob([data], { type: tipo });
};

const _bajar = (blob, nombre) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};

/**
 * El .bat del plan de emergencia: se arrastra el .prn encima y lo copia en
 * crudo a la impresora compartida. `copy /b` no pasa por ningún programa que
 * dibuje, así que no hay papel ni giro que decidir.
 */
const _textoBat = (compartida) => [
  '@echo off',
  'REM Imprime etiquetas: arrastra el archivo .prn ENCIMA de este archivo.',
  `REM La impresora tiene que estar compartida en Windows con el nombre ${compartida}`,
  'REM (Impresoras > la impresora > Propiedades de impresora > Compartir).',
  `set IMPRESORA=${compartida}`,
  'if "%~1"=="" (',
  '  echo Arrastra el archivo .prn de las etiquetas encima de este archivo.',
  '  pause',
  '  exit /b',
  ')',
  'copy /b "%~1" "\\\\%COMPUTERNAME%\\%IMPRESORA%"',
  'if errorlevel 1 (',
  '  echo.',
  '  echo No se pudo enviar. Revisa que la impresora este compartida como %IMPRESORA%.',
  ') else (',
  '  echo Listo: etiquetas enviadas a %IMPRESORA%.',
  ')',
  'pause',
  '',
].join('\r\n');

/**
 * @param {object} p
 * @param {(body) => Promise} p.pedirPdf       el mismo de `useEtiquetas`
 * @param {(body) => Promise} p.pedirComandos  `comandosEtiquetas` o el de la compra
 */
export const useImpresionDirecta = ({ pedirPdf, pedirComandos }) => {
  const [prefs, setPrefs] = useState(leerDirecta);
  const [estado, setEstado] = useState('inicial');   // inicial | conectando | conectado | sin_qz
  const [firmado, setFirmado] = useState(false);
  const [impresoras, setImpresoras] = useState([]);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  // Papeles del driver de la impresora elegida: null = no se sabe (aún, o QZ no respondió).
  const [papeles, setPapeles] = useState(null);

  const _cargarPapeles = useCallback(async (nombre) => {
    setPapeles(null);
    if (!nombre) return;
    try { setPapeles(await papelesDe(nombre)); } catch { setPapeles(null); }
  }, []);

  const cambiar = useCallback((parcial) => {
    setPrefs((p) => {
      const n = { ...p, ...parcial };
      _guardar(n);
      return n;
    });
    if (parcial.impresora !== undefined) _cargarPapeles(parcial.impresora);
  }, [_cargarPapeles]);

  const conectar = useCallback(async () => {
    setEstado('conectando');
    setError('');
    try {
      const { firmado: f } = await conectarQz();
      const { impresoras: lista, defecto } = await listarImpresoras();
      setFirmado(f);
      setImpresoras(lista);
      setEstado('conectado');
      // Si la guardada ya no existe, se propone una que diga «etiqueta» o la
      // térmica típica antes que la predeterminada, que suele ser la de oficina.
      const guardada = leerDirecta().impresora;
      const elegida = guardada && lista.includes(guardada) ? guardada
        : (lista.find((n) => /t451|dig|label|etiquet|tsc|xprinter|zebra|zdesigner|4barcode/i.test(n)) || defecto || lista[0] || '');
      setPrefs((p) => {
        const n = { ...p, impresora: elegida };
        _guardar(n);
        return n;
      });
      _cargarPapeles(elegida);
    } catch (e) {
      setEstado('sin_qz');
      setError(mensajeQz(e));
    }
  }, [_cargarPapeles]);

  const _correr = useCallback(async (accion, exito) => {
    setTrabajando(true);
    setError('');
    setAviso('');
    try {
      await accion();
      if (exito) setAviso(exito);
    } catch (e) {
      const blob = e?.response?.data;
      const msgBack = blob instanceof Blob ? await _mensajeDeBlob(blob) : e?.response?.data?.error;
      setError(msgBack || mensajeQz(e));
    } finally { setTrabajando(false); }
  }, []);

  /**
   * Imprime por QZ Tray con el método elegido.
   * @param {object} body     el mismo cuerpo del PDF (o el de la prueba)
   * @param {{ancho:number, alto:number}} papelMm la página del formato
   * @param {number|null} dpi
   */
  const imprimir = useCallback((body, papelMm, dpi, nombre) => _correr(async () => {
    if (!prefs.impresora) throw new Error('Elige la impresora');
    if (prefs.metodo === 'pdf') {
      const { data } = await pedirPdf(body);
      const pdf = await _exigirBinario(data, 'application/pdf');
      await imprimirPdfQz({ impresora: prefs.impresora, pdf, papelMm, orientacion: prefs.orientacion, dpi, nombre });
    } else {
      const { data } = await pedirComandos({ ...body, lenguaje: prefs.metodo });
      const comandos = await _exigirBinario(data, 'application/octet-stream');
      await imprimirComandosQz({ impresora: prefs.impresora, comandos, nombre });
    }
  }, `Enviado a ${prefs.impresora}.`), [_correr, prefs, pedirPdf, pedirComandos]);

  /** El .prn para mandarlo sin QZ Tray. */
  const descargarPrn = useCallback((body, lenguaje, nombre) => _correr(async () => {
    const { data } = await pedirComandos({ ...body, lenguaje });
    _bajar(await _exigirBinario(data, 'application/octet-stream'), nombre || `etiquetas-${lenguaje}.prn`);
  }), [_correr, pedirComandos]);

  const descargarBat = useCallback(() => {
    const nombre = String(prefs.compartida || 'ETIQUETAS').replace(/[^\w.-]/g, '') || 'ETIQUETAS';
    _bajar(new Blob([_textoBat(nombre)], { type: 'application/octet-stream' }), 'imprimir-etiquetas.bat');
  }, [prefs.compartida]);

  return {
    prefs, cambiar, estado, firmado, impresoras, papeles, trabajando, error, aviso,
    conectar, imprimir, descargarPrn, descargarBat,
  };
};

export default useImpresionDirecta;
