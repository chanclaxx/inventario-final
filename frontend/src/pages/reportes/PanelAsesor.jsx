import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, Eye, Info, FileSpreadsheet, ArrowUp, ArrowDown, ArrowUpDown,
  Search, X, Lightbulb, Table2,
} from 'lucide-react';
import { getAnalisisAsesor } from '../../api/reportes.api';
import { Spinner } from '../../components/ui/Spinner';
import useSucursalStore from '../../store/sucursalStore';
import {
  GRUPOS, TABLAS, INDICADORES, SENALES, tablaPorId, columnasDePantalla, formatearCelda,
  esNumerica, ordenarFilas, buscarFilas, contarSenales,
} from './asesor/tablasAsesor';

// ─────────────────────────────────────────────────────────────────────────────
// TABLAS PARA ASESORÍA — Reportes → Análisis
//
// Lo que un asesor comercial necesita para sentarse con el dueño y decir «este
// proveedor te sale caro», «esta mercancía no se mueve», «esto se te acaba»:
// proveedores, precios de compra, productos, líneas, compras contra ventas,
// clientes, cartera y equipos quietos. Arriba, los HALLAZGOS: lo que el
// programa ya ve en esos datos, con el número y la tabla de donde sale.
//
// Esta pantalla solo PINTA. Las cifras, las señales y los hallazgos los calcula
// el backend (`reportes/asesor.service.js`); qué tablas y columnas hay está en
// `asesor/tablasAsesor.js`, que es también de donde sale el Excel.
//
// No hay `useEffect`: cada tabla se remonta por `key` cuando cambian los datos,
// así un filtro escrito para un período no se arrastra al siguiente.
// ─────────────────────────────────────────────────────────────────────────────

const FILAS_INICIALES = 25;

const TONO = {
  rojo:  'bg-red-50 text-red-700 border-red-200',
  ambar: 'bg-amber-50 text-amber-800 border-amber-200',
  verde: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  gris:  'bg-gray-100 text-gray-600 border-gray-200',
};

const NIVEL = {
  alerta:   { titulo: 'Alerta',       caja: 'border-red-200 bg-red-50/60',     icono: 'text-red-500',   chip: TONO.rojo },
  atencion: { titulo: 'Para revisar', caja: 'border-amber-200 bg-amber-50/60', icono: 'text-amber-500', chip: TONO.ambar },
  dato:     { titulo: 'Dato',         caja: 'border-gray-200 bg-white',        icono: 'text-gray-400',  chip: TONO.gris },
};
const ICONO_NIVEL = { alerta: AlertTriangle, atencion: Eye, dato: Info };

function ChipSenal({ clave, umbrales }) {
  const s = SENALES[clave];
  if (!s) return null;
  return (
    <span title={s.ayuda(umbrales)}
      className={`inline-block text-[11px] leading-tight px-1.5 py-0.5 rounded-md border whitespace-nowrap ${TONO[s.tono] ?? TONO.gris}`}>
      {s.texto}
    </span>
  );
}

// ── Una tabla: buscar, filtrar por señal, ordenar y «ver todas» ─────────────
export function TablaAsesor({ tabla, datos }) {
  const [orden,    setOrden]    = useState(tabla.orden);
  const [busqueda, setBusqueda] = useState('');
  const [senal,    setSenal]    = useState(null);
  const [todas,    setTodas]    = useState(false);

  const columnas = columnasDePantalla(tabla);
  const base     = tabla.filas(datos);
  const senales  = contarSenales(base);

  const filtradas = senal ? base.filter((f) => (f.senales || []).includes(senal)) : base;
  const halladas  = buscarFilas(filtradas, busqueda, columnas);
  const ordenadas = ordenarFilas(halladas, orden, columnas);
  const visibles  = todas ? ordenadas : ordenadas.slice(0, FILAS_INICIALES);

  const ordenarPor = (clave) => setOrden((o) => (
    o?.clave === clave ? { clave, desc: !o.desc } : { clave, desc: esNumerica(columnas.find((x) => x.clave === clave)?.tipo) }
  ));

  return (
    <section id={`tabla-${tabla.id}`} className="bg-white border border-gray-100 rounded-2xl shadow-sm flex flex-col scroll-mt-4">
      <div className="p-4 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-800">{tabla.titulo}</h3>
            <p className="text-xs text-blue-700">{tabla.pregunta}</p>
          </div>
          {base.length > 10 && (
            <div className="relative w-full sm:w-56">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input type="text" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar en la tabla…" aria-label={`Buscar en ${tabla.titulo}`}
                className="w-full pl-8 pr-7 py-1.5 bg-gray-100 rounded-lg text-xs text-gray-800 placeholder-gray-400
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white" />
              {busqueda && (
                <button type="button" onClick={() => setBusqueda('')} aria-label="Borrar la búsqueda"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X size={12} />
                </button>
              )}
            </div>
          )}
        </div>
        {tabla.nota && (
          <p className="text-xs text-gray-400 flex items-start gap-1.5">
            <Info size={12} className="flex-shrink-0 mt-0.5" /> {tabla.nota}
          </p>
        )}
        {senales.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-gray-400">Filtrar:</span>
            {senales.map(({ clave, cuantas }) => {
              const s = SENALES[clave];
              const activa = senal === clave;
              return (
                <button key={clave} type="button" title={s?.ayuda(datos.umbrales)}
                  onClick={() => { setSenal(activa ? null : clave); setTodas(false); }}
                  className={`text-[11px] px-2 py-0.5 rounded-md border transition-colors
                    ${activa ? 'bg-gray-900 text-white border-gray-900' : `${TONO[s?.tono] ?? TONO.gris} hover:opacity-80`}`}>
                  {s?.texto ?? clave} · {cuantas}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="overflow-x-auto border-t border-gray-100">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 text-gray-500">
              {columnas.map((col) => {
                const numerica = esNumerica(col.tipo);
                const activa = orden?.clave === col.clave;
                const Flecha = !activa ? ArrowUpDown : orden.desc ? ArrowDown : ArrowUp;
                return (
                  <th key={col.clave} scope="col" title={col.ayuda}
                    aria-sort={activa ? (orden.desc ? 'descending' : 'ascending') : 'none'}
                    className={`px-3 py-2 font-medium whitespace-nowrap ${numerica ? 'text-right' : 'text-left'}`}>
                    <button type="button" onClick={() => ordenarPor(col.clave)}
                      className={`inline-flex items-center gap-1 hover:text-gray-800 ${activa ? 'text-gray-900' : ''}`}>
                      {col.titulo}
                      <Flecha size={11} className={activa ? '' : 'opacity-40'} />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibles.map((fila, i) => (
              <tr key={i} className="border-t border-gray-100 hover:bg-blue-50/30">
                {columnas.map((col, j) => {
                  const valor = fila[col.clave];
                  if (col.tipo === 'senales') {
                    return (
                      <td key={col.clave} className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {(valor || []).map((s) => <ChipSenal key={s} clave={s} umbrales={datos.umbrales} />)}
                        </div>
                      </td>
                    );
                  }
                  const numerica = esNumerica(col.tipo);
                  const negativo = numerica && Number(valor) < 0;
                  return (
                    <td key={col.clave}
                      className={`px-3 py-2 ${numerica ? 'text-right tabular-nums whitespace-nowrap' : 'text-left'}
                        ${j === 0 ? 'font-medium text-gray-800 max-w-[16rem]' : 'text-gray-600'}
                        ${negativo ? 'text-red-600 font-medium' : ''}`}>
                      {formatearCelda(valor, col.tipo)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {visibles.length === 0 && (
              <tr><td colSpan={columnas.length} className="px-3 py-6 text-center text-gray-400">
                {base.length === 0 ? 'Sin datos en el período.' : 'Ninguna fila coincide con el filtro.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {ordenadas.length > FILAS_INICIALES && (
        <div className="px-4 py-2 border-t border-gray-100 flex items-center justify-between gap-2 text-xs text-gray-500">
          <span>Mostrando {visibles.length} de {ordenadas.length}</span>
          <button type="button" onClick={() => setTodas((v) => !v)} className="font-medium text-blue-600 hover:text-blue-700">
            {todas ? `Ver solo ${FILAS_INICIALES}` : `Ver las ${ordenadas.length}`}
          </button>
        </div>
      )}
    </section>
  );
}

// ── Los hallazgos ────────────────────────────────────────────────────────────
export function Hallazgos({ hallazgos, onVerTabla }) {
  if (!hallazgos.length) {
    return (
      <div className="bg-white border border-gray-100 rounded-2xl p-6 text-center text-sm text-gray-400">
        No hay hallazgos en este período: no hubo ventas ni compras que analizar, o nada se sale de lo normal.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {hallazgos.map((h, i) => {
        const n = NIVEL[h.nivel] ?? NIVEL.dato;
        const Icono = ICONO_NIVEL[h.nivel] ?? Info;
        const tabla = tablaPorId(h.tabla);
        return (
          <div key={i} className={`border rounded-2xl p-3.5 flex items-start gap-3 ${n.caja}`}>
            <Icono size={17} className={`flex-shrink-0 mt-0.5 ${n.icono}`} />
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <p className="text-sm font-semibold text-gray-900">{h.titulo}</p>
              <p className="text-xs text-gray-600 leading-relaxed">{h.detalle}</p>
              {tabla && (
                <button type="button" onClick={() => onVerTabla(tabla)}
                  className="self-start text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1 mt-0.5">
                  <Table2 size={12} /> Ver en «{tabla.titulo}»
                </button>
              )}
            </div>
            <span className={`text-[11px] px-1.5 py-0.5 rounded-md border flex-shrink-0 ${n.chip}`}>{n.titulo}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function PanelAsesor({ desde, hasta }) {
  const variasSedes = useSucursalStore((s) => s.sucursales.length > 1);
  const [alcance,    setAlcance]    = useState('sede');
  const [grupo,      setGrupo]      = useState('hallazgos');
  const [exportando, setExportando] = useState(false);
  const [errorExcel, setErrorExcel] = useState('');

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ['analisis-asesor', desde, hasta, alcance],
    queryFn:  () => getAnalisisAsesor(desde, hasta, alcance).then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });

  const verTabla = (tabla) => {
    setGrupo(tabla.grupo);
    // La tabla aún no está pintada en este mismo clic: se espera un cuadro.
    setTimeout(() => document.getElementById(`tabla-${tabla.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  const exportar = async () => {
    if (!data) return;
    setExportando(true);
    setErrorExcel('');
    try {
      // El módulo de Excel pesa: se carga solo cuando alguien exporta.
      const { exportarAnalisisAsesorExcel } = await import('../../utils/exportarAnalisisAsesorExcel');
      exportarAnalisisAsesorExcel(data);
    } catch {
      setErrorExcel('No se pudo generar el Excel. Intenta de nuevo.');
    } finally {
      setExportando(false);
    }
  };

  const alertas = data ? data.hallazgos.filter((h) => h.nivel === 'alerta').length : 0;
  const clave   = `${desde}|${hasta}|${alcance}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1">
          {variasSedes && (
            <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
              {[['sede', 'Esta sede'], ['negocio', 'Todo el negocio']].map(([valor, titulo]) => (
                <button key={valor} type="button" onClick={() => setAlcance(valor)} aria-pressed={alcance === valor}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                    ${alcance === valor ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {titulo}
                </button>
              ))}
            </div>
          )}
          {data && (
            <p className="text-xs text-gray-400">
              {data.alcance.sedes.map((s) => s.nombre).join(', ')} · {data.alcance.dias} días
              {isFetching ? ' · actualizando…' : ''}
            </p>
          )}
        </div>
        <button type="button" onClick={exportar} disabled={!data || exportando}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-emerald-600 text-white
            hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          <FileSpreadsheet size={16} />
          {exportando ? 'Generando…' : 'Exportar Excel'}
        </button>
      </div>

      {errorExcel && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">{errorExcel}</div>
      )}
      {isLoading && <Spinner className="py-20" />}
      {isError && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">
          No se pudo cargar el análisis. Intenta de nuevo; si el período es muy largo, prueba con uno más corto.
        </div>
      )}

      {data && (
        <>
          {/* Indicadores */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {INDICADORES.map((ind) => (
              <div key={ind.clave} title={ind.ayuda} className="bg-white border border-gray-100 rounded-xl p-3">
                <p className="text-[11px] text-gray-400 leading-tight">{ind.titulo}</p>
                <p className="text-sm font-bold text-gray-900 tabular-nums mt-0.5">
                  {formatearCelda(data.resumen[ind.clave], ind.tipo)}
                </p>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 flex items-start gap-1.5 -mt-1">
            <Info size={12} className="flex-shrink-0 mt-0.5" />
            La utilidad de estas tablas es la de lo vendido en el período, por fecha de venta: incluye lo vendido a
            crédito que aún no se cobra. No es la utilidad cobrada de las gráficas. Lo que no tiene costo no suma utilidad.
            Inventario, cartera y deudas son a hoy.
          </p>

          {/* Pestañas */}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit max-w-full overflow-x-auto">
            <button type="button" onClick={() => setGrupo('hallazgos')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all
                ${grupo === 'hallazgos' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <Lightbulb size={13} /> Hallazgos
              {alertas > 0 && <span className="px-1.5 rounded-full bg-red-500 text-white text-[10px]">{alertas}</span>}
            </button>
            {GRUPOS.map((g) => (
              <button key={g.id} type="button" onClick={() => setGrupo(g.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all
                  ${grupo === g.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {g.titulo}
              </button>
            ))}
          </div>

          {grupo === 'hallazgos'
            ? <Hallazgos hallazgos={data.hallazgos} onVerTabla={verTabla} />
            : TABLAS.filter((t) => t.grupo === grupo)
              // «Por sede» no existe con una sola sede: no se pinta una tabla vacía.
              .filter((t) => t.id !== 'sedes' || data.sedes.length > 1)
              .map((t) => <TablaAsesor key={`${t.id}|${clave}`} tabla={t} datos={data} />)}
        </>
      )}
    </div>
  );
}
