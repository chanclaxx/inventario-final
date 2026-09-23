import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Download, Upload, FileSpreadsheet, AlertTriangle, Info, CheckCircle2, X,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { getSucursales } from '../../api/sucursales.api';
import { getConfig } from '../../api/config.api';
import {
  descargarPlantillaPrecios, analizarPreciosExcel, importarPreciosExcel,
} from '../../api/listasPrecios.api';

// ─────────────────────────────────────────────────────────────────────────────
// PRECIOS POR LISTA EN EXCEL — el mismo archivo de ida y de vuelta.
//
// No hay «exportar» por un lado y una plantilla vacía por el otro: se descarga
// lo que HAY hoy, se edita en Excel y se vuelve a subir. Mantener 450 productos
// × 3 listas × 3 locales a mano no lo hace nadie dos veces; con el ida y vuelta
// es un martes por la tarde.
//
// Tres pasos, y el del medio es el que importa: ANTES de aplicar nada se ve
// exactamente qué va a cambiar. Es la misma forma que ya tiene la importación de
// inventario, y por la misma razón — quien sube un archivo de precios se está
// jugando el margen de todas sus ventas.
// ─────────────────────────────────────────────────────────────────────────────

function Aviso({ tipo, children }) {
  const estilos = tipo === 'conflicto'
    ? 'text-red-700 bg-red-50 border-red-100'
    : 'text-amber-700 bg-amber-50 border-amber-100';
  const Icono = tipo === 'conflicto' ? AlertTriangle : Info;
  return (
    <p className={`flex items-start gap-1.5 text-[11px] border rounded-lg px-2 py-1.5 ${estilos}`}>
      <Icono size={12} className="flex-shrink-0 mt-0.5" />
      <span>{children}</span>
    </p>
  );
}

// Una lista larga de avisos idénticos no se lee: se cuenta. Se muestran los
// primeros y se dice cuántos quedan.
const TOPE_VISIBLE = 8;

function ListaMensajes({ titulo, tipo, mensajes }) {
  if (!mensajes?.length) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-semibold text-gray-600">
        {titulo} ({mensajes.length})
      </p>
      {mensajes.slice(0, TOPE_VISIBLE).map((m, i) => (
        <Aviso key={i} tipo={tipo}>
          {m.hoja && <b>{m.hoja}</b>}{m.fila ? ` · fila ${m.fila}` : ''}{m.hoja ? ' — ' : ''}
          {m.mensaje}
        </Aviso>
      ))}
      {mensajes.length > TOPE_VISIBLE && (
        <p className="text-[11px] text-gray-400 px-1">
          … y {mensajes.length - TOPE_VISIBLE} más del mismo tipo
        </p>
      )}
    </div>
  );
}

export function ModalPreciosExcel({ onCerrar }) {
  const queryClient = useQueryClient();

  const { data: sucursalesRaw } = useQuery({
    queryKey: ['sucursales'],
    queryFn:  () => getSucursales().then((r) => r.data.data),
  });
  const sucursales = sucursalesRaw || [];

  // Ninguna marcada = todas a las que el usuario tiene acceso. Es lo que quiere
  // el caso normal (un negocio con tres locales que comparten catálogo) y el
  // backend lo resuelve igual, así que la pantalla no tiene que adivinar nada.
  const [elegidas, setElegidas] = useState([]);

  // Las tallas vienen MARCADAS si el negocio usa variantes: con variantes
  // activas el precio vive en la hoja (el producto es un contenedor), así que
  // una plantilla sin ellas no puede tarifar lo que de verdad se vende.
  //
  // `null` = el usuario no ha tocado la casilla, y entonces NI SIQUIERA se
  // manda el parámetro: decide el backend con la config del negocio. Guardar
  // aquí el valor inicial sería fijarlo mientras la config todavía carga —la
  // casilla diría una cosa y el archivo traería otra— y sincronizarlo después
  // con un efecto es lo que el linter rechaza.
  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn:  () => getConfig().then((r) => r.data.data),
    staleTime: 60 * 1000,
  });
  const variantesActivo = config?.variantes_activo === '1';
  const [eleccionVariantes, setEleccionVariantes] = useState(null);
  const variantes = eleccionVariantes ?? variantesActivo;
  const [archivo,  setArchivo]  = useState(null);
  const [informe,  setInforme]  = useState(null);
  const [error,    setError]    = useState('');
  const [listo,    setListo]    = useState(null);

  const alternar = (id) => {
    setElegidas((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    // Cambiar el alcance invalida el informe: se calculó contra otras sedes.
    setInforme(null);
  };

  const descargar = useMutation({
    mutationFn: () => descargarPlantillaPrecios({
      sucursales: elegidas,
      incluirVariantes: eleccionVariantes ?? undefined,
    }),
    onSuccess: (res) => {
      const url = URL.createObjectURL(new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `precios-por-lista-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setError('');
    },
    onError: () => setError('No se pudo generar la plantilla. Revisa que tengas listas de precios creadas.'),
  });

  const analizar = useMutation({
    mutationFn: () => analizarPreciosExcel(archivo, elegidas).then((r) => r.data.data),
    onSuccess: (data) => { setInforme(data); setError(''); },
    onError: (e) => setError(e.response?.data?.error || 'No se pudo leer el archivo'),
  });

  const importar = useMutation({
    mutationFn: () => importarPreciosExcel(archivo, elegidas).then((r) => r.data.data),
    onSuccess: (data) => {
      // Los precios viajan dentro de las listas del inventario y del árbol: sin
      // invalidar, el carrito seguiría agregando con los precios viejos.
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-serial'],   exact: false });
      queryClient.invalidateQueries({ queryKey: ['arbol-producto'],     exact: false });
      setListo(data);
    },
    onError: (e) => setError(e.response?.data?.error || 'No se pudo aplicar el archivo'),
  });

  const elegirArchivo = (e) => {
    const f = e.target.files?.[0] || null;
    setArchivo(f);
    setInforme(null);
    setError('');
  };

  // ── Terminado ─────────────────────────────────────────────────────────────
  if (listo) {
    return (
      <Modal open onClose={onCerrar} title="Precios actualizados" size="lg">
        <div className="flex flex-col gap-4 py-2">
          <div className="flex items-center gap-2 text-emerald-700">
            <CheckCircle2 size={20} />
            <span className="font-semibold">
              {listo.guardados} producto{listo.guardados !== 1 ? 's' : ''} actualizado{listo.guardados !== 1 ? 's' : ''}
            </span>
          </div>
          <ListaMensajes titulo="No se pudieron aplicar" tipo="conflicto" mensajes={listo.conflictos} />
          <ListaMensajes titulo="Para tener en cuenta" tipo="aviso" mensajes={listo.avisos} />
          <div className="flex justify-end">
            <Button onClick={onCerrar}>Listo</Button>
          </div>
        </div>
      </Modal>
    );
  }

  const hayConflictos = (informe?.conflictos?.length ?? 0) > 0;

  return (
    <Modal open onClose={onCerrar} title="Precios por lista en Excel" size="xl">
      <div className="flex flex-col gap-4">

        {/* ── Alcance ───────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-gray-600">¿Qué sucursales?</p>
          <div className="flex flex-wrap gap-1.5">
            {sucursales.map((s) => {
              const activa = elegidas.length === 0 || elegidas.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => alternar(s.id)}
                  className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors
                    ${activa
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300'}`}
                >
                  {s.nombre}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-gray-400">
            {elegidas.length === 0
              ? 'Todas. Cada sucursal va en su propia hoja del archivo.'
              : `${elegidas.length} de ${sucursales.length} — las demás no se tocan.`}
          </p>
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none mt-1">
            <input type="checkbox" checked={variantes}
              onChange={(e) => setEleccionVariantes(e.target.checked)}
              className="rounded border-gray-300" />
            Incluir las tallas y colores de cada producto
            <span className="text-gray-400">
              {variantesActivo
                ? '— cada talla puede tener su propio precio'
                : '— tu negocio no usa variantes'}
            </span>
          </label>
          <p className="text-[11px] text-gray-400">
            Los equipos con IMEI van siempre: su precio de lista es el de la referencia.
          </p>
        </div>

        {/* ── Paso 1 ────────────────────────────────────────────────────── */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-sm font-semibold text-blue-800">Paso 1 — Descarga tus precios</p>
          <p className="text-xs text-blue-700 leading-snug">
            El archivo baja <b>con los precios que tienes hoy</b>, no vacío. Corrige lo que
            quieras en las columnas verdes y vuelve a subirlo aquí.
          </p>
          <Button size="sm" variant="secondary" className="self-start"
            loading={descargar.isPending}
            onClick={() => descargar.mutate()}>
            <Download size={15} /> Descargar Excel
          </Button>
        </div>

        {/* ── Paso 2 ────────────────────────────────────────────────────── */}
        <div className="border border-gray-200 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-sm font-semibold text-gray-800">Paso 2 — Súbelo corregido</p>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border
              border-gray-200 bg-white hover:bg-gray-50 transition-colors text-sm">
              <Upload size={15} /> Elegir archivo
            </span>
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={elegirArchivo} />
            {archivo && (
              <span className="flex items-center gap-1 text-xs text-gray-500 min-w-0">
                <FileSpreadsheet size={13} className="flex-shrink-0" />
                <span className="truncate">{archivo.name}</span>
              </span>
            )}
          </label>
          {archivo && !informe && (
            <Button size="sm" className="self-start" loading={analizar.isPending}
              onClick={() => analizar.mutate()}>
              Ver qué va a cambiar
            </Button>
          )}
        </div>

        {/* ── Paso 3: el informe ────────────────────────────────────────── */}
        {informe && (
          <div className="border border-gray-200 rounded-xl p-3 flex flex-col gap-3">
            <p className="text-sm font-semibold text-gray-800">Paso 3 — Revisa y aplica</p>

            <div className="flex flex-wrap gap-3 text-xs">
              <span className="text-gray-500">
                Filas leídas: <b className="text-gray-800">{informe.total_filas}</b>
              </span>
              <span className="text-blue-700">
                Cambian: <b>{informe.con_cambio}</b>
              </span>
              <span className="text-gray-400">
                Quedan igual: {informe.sin_cambio}
              </span>
            </div>

            {informe.hojas?.length > 0 && (
              <div className="flex flex-col gap-0.5">
                {informe.hojas.map((h) => (
                  <p key={h.hoja} className="text-[11px] text-gray-500">
                    <b className="text-gray-700">{h.hoja}</b> — {h.cambios} cambio{h.cambios !== 1 ? 's' : ''} de {h.filas} filas
                  </p>
                ))}
              </div>
            )}

            <ListaMensajes titulo="No se van a aplicar" tipo="conflicto" mensajes={informe.conflictos} />
            <ListaMensajes titulo="Para tener en cuenta" tipo="aviso" mensajes={informe.avisos} />

            {informe.con_cambio === 0 ? (
              <p className="text-xs text-gray-500">
                No hay nada que cambiar: el archivo dice lo mismo que ya está guardado.
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <Button loading={importar.isPending} onClick={() => importar.mutate()}>
                  Aplicar {informe.con_cambio} cambio{informe.con_cambio !== 1 ? 's' : ''}
                </Button>
                {hayConflictos && (
                  <span className="text-[11px] text-gray-500">
                    Las filas con problema se saltan; el resto sí se aplica.
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="flex items-start gap-1.5 text-xs text-red-600 bg-red-50 border
            border-red-100 rounded-lg px-2.5 py-2">
            <X size={13} className="flex-shrink-0 mt-0.5" /> {error}
          </p>
        )}

        {(descargar.isPending || analizar.isPending) && !informe && (
          <div className="py-2 flex justify-center"><Spinner /></div>
        )}
      </div>
    </Modal>
  );
}

export default ModalPreciosExcel;
