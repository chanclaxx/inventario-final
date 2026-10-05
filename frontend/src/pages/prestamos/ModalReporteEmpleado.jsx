import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Building2, FileDown, ListChecks, Smartphone, Store, UserRound, Users } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Spinner } from '../../components/ui/Spinner';
import {
  getEmpleadosReporte, descargarPdfReporteEmpleado, getResumenReporteSede, descargarPdfReporteSede,
} from '../../api/prestamos.api';
import { useAuth } from '../../context/useAuth';
import useSucursalStore from '../../store/sucursalStore';
import { formatCOP } from '../../utils/formatters';
import { fechaHoyBogota } from '../../utils/formatters';

/**
 * Reporte por empleado: todo lo que vendió, prestó (a clientes y a compañeros)
 * y dio a crédito entre dos fechas, en un PDF organizado por tipo y por estado.
 *
 * Solo muestra. La liquidación (qué se paga por un equipo vendido, uno
 * devuelto, uno prestado) la hacen el empleado y el jefe: el PDF no suma plata.
 *
 * El vendedor solo puede sacar el suyo — el backend lo impone aunque la
 * pantalla pidiera otro; aquí simplemente no se le ofrece elegir.
 */

// Rango de un mes a partir de 'YYYY-MM-DD'. `desplazamiento` -1 = mes pasado.
function rangoMes(hoy, desplazamiento = 0) {
  const [a, m] = hoy.split('-').map(Number);
  const inicio = new Date(Date.UTC(a, m - 1 + desplazamiento, 1));
  const fin    = new Date(Date.UTC(a, m + desplazamiento, 0));
  const iso = (d) => d.toISOString().slice(0, 10);
  return { desde: iso(inicio), hasta: desplazamiento === 0 ? hoy : iso(fin) };
}

async function mensajeDeError(err) {
  // La respuesta viene como blob: el motivo real está adentro, en JSON.
  const data = err.response?.data;
  if (data instanceof Blob) {
    try {
      const json = JSON.parse(await data.text());
      if (json.error || json.message) return json.error || json.message;
    } catch { /* no era JSON */ }
  }
  if (err.code === 'ECONNABORTED') return 'El reporte tardó demasiado. Prueba con un rango más corto.';
  return 'No se pudo generar el reporte. Intenta de nuevo.';
}

function guardar(blob, nombre) {
  const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
  const a   = document.createElement('a');
  a.href     = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const numero = (n) => Number(n || 0).toLocaleString('es-CO');
const registros = (n) => (n > 0 ? `${numero(n)} registro${n !== 1 ? 's' : ''}` : 'sin movimientos');

function PanelReporteEmpleado({ onClose }) {
  const hoy = fechaHoyBogota();
  const [rango,       setRango]       = useState(() => rangoMes(hoy));
  const [seleccion,   setSeleccion]   = useState(null);
  const [soloEquipos, setSoloEquipos] = useState(true);
  // null = la sede activa arriba. El admin puede elegir otra aquí mismo.
  const [sede,        setSede]        = useState(null);
  const [generando,   setGenerando]   = useState(false);
  const [error,       setError]       = useState('');

  const rangoMalo = !rango.desde || !rango.hasta || rango.desde > rango.hasta;

  // La lista trae cuántas filas tendría el PDF de cada empleado en el rango:
  // sin eso, elegir a alguien sin movimientos en esta sede (el propio admin,
  // o un admin que trabaja en otra) entregaba un PDF en blanco sin explicación.
  const { data, isLoading, isError } = useQuery({
    queryKey: ['prestamos', 'reporte-empleado', 'empleados', rango.desde, rango.hasta, soloEquipos, sede],
    queryFn:  () => getEmpleadosReporte({
      desde: rango.desde, hasta: rango.hasta, solo_equipos: soloEquipos, sucursal_id: sede,
    }).then((r) => r.data.data),
    enabled: !rangoMalo,
    placeholderData: (prev) => prev,
  });

  const hayConteos  = (data?.empleados ?? []).some((e) => typeof e.movimientos === 'number');
  // Los que tienen algo que mostrar, primero.
  const empleados   = [...(data?.empleados ?? [])]
    .sort((a, b) => Number(b.movimientos > 0) - Number(a.movimientos > 0));
  const puedeElegir = !!data?.puede_elegir;
  const sedes       = data?.sedes ?? [];
  const sedeActual  = sede ?? data?.sucursal_id ?? null;
  const nombreSede  = data?.sucursal_nombre || 'esta sucursal';

  // Sin elección todavía: uno mismo si tiene movimientos; si no, todos.
  const yo          = empleados.find((e) => e.id === data?.yo);
  const porDefecto  = yo && (!hayConteos || yo.movimientos > 0) ? String(yo.id) : 'todos';
  // Al cambiar de sede el elegido puede no estar en la lista nueva.
  const sigueEnLista = seleccion === 'todos' || empleados.some((e) => String(e.id) === seleccion);
  const elegido     = puedeElegir
    ? (seleccion && sigueEnLista ? seleccion : porDefecto)
    : String(data?.yo ?? '');
  const empleado    = empleados.find((e) => String(e.id) === elegido);
  const cuantos     = elegido === 'todos' ? data?.total_sede : empleado?.movimientos;
  const vacio       = hayConteos && cuantos === 0;

  const mesActual = rangoMes(hoy);
  const mesPasado = rangoMes(hoy, -1);
  const esRango   = (r) => r.desde === rango.desde && r.hasta === rango.hasta;

  const nombreArchivo = () => {
    const quien = elegido === 'todos'
      ? 'todos'
      : (empleados.find((e) => String(e.id) === elegido)?.nombre || 'empleado')
          .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
    return `reporte-${quien}-${rango.desde}-a-${rango.hasta}.pdf`;
  };

  const descargar = async () => {
    if (generando || rangoMalo) return;
    setError('');
    setGenerando(true);
    try {
      const res = await descargarPdfReporteEmpleado({
        usuario_id: elegido, desde: rango.desde, hasta: rango.hasta, solo_equipos: soloEquipos,
        sucursal_id: sede,
      });
      guardar(res.data, nombreArchivo());
      onClose();
    } catch (err) {
      setError(await mensajeDeError(err));
    } finally {
      setGenerando(false);
    }
  };

  return (
      <div className="flex flex-col gap-4">
        <p className="text-xs text-gray-500 leading-relaxed">
          Todo lo que el empleado vendió de contado, dio a crédito y prestó a clientes y a
          compañeros en el período, separado por estado: pagados, pendientes, devueltos y
          cancelados. <span className="font-medium text-gray-600">Solo muestra la información;
          no calcula comisiones.</span>
        </p>

        {/* Sucursal (solo el admin, y solo si hay más de una) */}
        {sedes.length > 1 && (
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <Store size={14} className="text-gray-400" /> Sucursal
            </label>
            <select value={sedeActual ?? ''} onChange={(e) => setSede(Number(e.target.value))}
              className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm text-gray-900
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white">
              {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
        )}

        {/* Empleado */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Empleado</label>
          {isLoading ? (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-100 rounded-xl text-sm text-gray-400">
              <Spinner size="sm" /> Cargando…
            </div>
          ) : isError ? (
            <p className="text-xs text-red-500">No se pudo cargar la lista de empleados.</p>
          ) : puedeElegir ? (
            <select value={elegido} onChange={(e) => setSeleccion(e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm text-gray-900
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white">
              <option value="todos">
                Todos los empleados (uno por hoja){hayConteos ? ` — ${registros(data.total_sede)}` : ''}
              </option>
              {empleados.map((e) => (
                <option key={e.id} value={String(e.id)}>
                  {e.nombre}{e.activo === false ? ' (inactivo)' : ''}
                  {hayConteos ? ` — ${registros(e.movimientos)}` : ''}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-100 rounded-xl text-sm text-gray-800">
              <UserRound size={15} className="text-gray-400" />
              {empleados[0]?.nombre || 'Tú'}
              {hayConteos && <span className="ml-auto text-xs text-gray-500">{registros(empleados[0]?.movimientos)}</span>}
            </div>
          )}
          {hayConteos && cuantos > 0 && (
            <p className="text-xs text-gray-500">
              El PDF trae {registros(cuantos)} de {nombreSede}.
            </p>
          )}
        </div>

        {/* Período */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-sm font-medium text-gray-700">Período</label>
            <div className="flex gap-1">
              {[{ id: 'este', label: 'Este mes', r: mesActual }, { id: 'pasado', label: 'Mes pasado', r: mesPasado }]
                .map((p) => (
                  <button key={p.id} type="button" onClick={() => setRango(p.r)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors
                      ${esRango(p.r) ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    {p.label}
                  </button>
                ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input type="date" label="Desde" value={rango.desde} max={rango.hasta || undefined}
              onChange={(e) => setRango((r) => ({ ...r, desde: e.target.value }))} />
            <Input type="date" label="Hasta" value={rango.hasta} min={rango.desde || undefined}
              onChange={(e) => setRango((r) => ({ ...r, hasta: e.target.value }))} />
          </div>
          {rangoMalo && rango.desde && rango.hasta && (
            <p className="text-xs text-red-500">La fecha inicial no puede ser posterior a la final.</p>
          )}
        </div>

        {/* Qué incluye */}
        <label className="flex items-start gap-3 p-3 rounded-xl border border-gray-200 cursor-pointer hover:bg-gray-50">
          <input type="checkbox" checked={soloEquipos} onChange={(e) => setSoloEquipos(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
          <span className="flex-1">
            <span className="flex items-center gap-1.5 text-sm font-medium text-gray-800">
              <Smartphone size={14} className="text-gray-400" /> Solo equipos con IMEI
            </span>
            <span className="block text-xs text-gray-500 mt-0.5">
              Deja por fuera accesorios y productos por cantidad. Desmárcalo para ver todo.
            </span>
          </span>
        </label>

        {/* Por qué saldría vacío, y cómo llegar a lo que sí hay */}
        {vacio && !rangoMalo && (
          <div className="flex flex-col gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
            <p className="flex items-start gap-2 text-xs text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                <span className="font-semibold">
                  {elegido === 'todos'
                    ? `No hay ventas ni préstamos en ${nombreSede} en este período.`
                    : `${empleado?.nombre || 'Este empleado'} no tiene ventas ni préstamos en ${nombreSede} en este período.`}
                </span>{' '}
                El reporte cuenta lo que cada empleado registró con su propio usuario.
              </span>
            </p>
            {soloEquipos && empleado?.sin_imei > 0 && (
              <button type="button" onClick={() => setSoloEquipos(false)}
                className="self-start px-2.5 py-1 rounded-lg bg-white border border-amber-300 text-xs font-medium text-amber-800 hover:bg-amber-100">
                Tiene {numero(empleado.sin_imei)} sin IMEI — incluir todos los productos
              </button>
            )}
            {(empleado?.otras_sedes ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {empleado.otras_sedes.map((s) => (
                  <button key={s.sucursal_id} type="button" onClick={() => setSede(s.sucursal_id)}
                    className="px-2.5 py-1 rounded-lg bg-white border border-amber-300 text-xs font-medium text-amber-800 hover:bg-amber-100">
                    Ver en {s.nombre} · {registros(s.movimientos)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {error && <p className="text-xs text-red-500 text-center">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={generando}
            disabled={isLoading || isError || rangoMalo || !elegido} onClick={descargar}>
            {!generando && <FileDown size={15} />}
            {generando ? 'Generando…' : 'Descargar PDF'}
          </Button>
        </div>
      </div>
  );
}

// ─── Reporte por SEDE ───────────────────────────────────────────────────────
//
// La sede entera en el período: cuántos equipos (con IMEI) y accesorios, cuántos
// siguen pendientes y cuántos ya se pagaron, lo pagado y lo que se debe, por
// tipo, mes a mes y por empleado. Sale de las MISMAS consultas que el reporte por
// empleado. Aquí sí hay plata (pedido del negocio, oct-2026). Las cifras se ven
// ANTES de descargar: son las mismas que trae el PDF.

const unidadesVigentes = (t, cat) => {
  const u = t?.unidades?.[cat];
  return u ? u.pagado + u.pendiente + u.devuelto_parcial : 0;
};

function CifraSede({ titulo, valor, detalle, tono = 'text-gray-900' }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 truncate">{titulo}</p>
      <p className={`text-base font-bold tabular-nums truncate ${tono}`}>{valor}</p>
      {detalle && <p className="text-[11px] text-gray-500 truncate">{detalle}</p>}
    </div>
  );
}

function PanelReporteSede({ onClose }) {
  const hoy = fechaHoyBogota();
  const { usuario } = useAuth();
  const esAdmin    = usuario?.rol === 'admin_negocio';
  const sucursales = useSucursalStore((s) => s.sucursales);
  const activa     = useSucursalStore((s) => s.sucursalActiva);

  const [rango,      setRango]      = useState(() => rangoMes(hoy));
  // 'todas' | id de sede | null (= la activa arriba).
  const [sede,       setSede]       = useState(null);
  const [pendientes, setPendientes] = useState(true);
  const [generando,  setGenerando]  = useState(false);
  const [error,      setError]      = useState('');

  const rangoMalo = !rango.desde || !rango.hasta || rango.desde > rango.hasta;
  const todas     = esAdmin && sede === 'todas';
  const sedeId    = todas ? null : (sede ?? null);
  const filtros   = { desde: rango.desde, hasta: rango.hasta, todas, sucursal_id: sedeId };

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: ['prestamos', 'reporte-sede', rango.desde, rango.hasta, todas, sedeId ?? activa],
    queryFn:  () => getResumenReporteSede(filtros).then((r) => r.data.data),
    enabled:  !rangoMalo,
    placeholderData: (prev) => prev,
  });

  const total  = data ? (data.consolidado ?? data.sedes?.[0]?.total) : null;
  const vacio  = data && (data.sedes || []).every((s) => s.vacio);
  const nombre = todas ? 'Todas las sedes' : (data?.sedes?.[0]?.nombre || '');

  const mesActual = rangoMes(hoy);
  const mesPasado = rangoMes(hoy, -1);
  const esRango   = (r) => r.desde === rango.desde && r.hasta === rango.hasta;

  const descargar = async () => {
    if (generando || rangoMalo) return;
    setError('');
    setGenerando(true);
    try {
      const res = await descargarPdfReporteSede({ ...filtros, pendientes });
      const quien = (todas ? 'todas-las-sedes' : nombre || 'sede')
        .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
      guardar(res.data, `reporte-sede-${quien}-${rango.desde}-a-${rango.hasta}.pdf`);
      onClose();
    } catch (err) {
      setError(await mensajeDeError(err));
    } finally {
      setGenerando(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-gray-500 leading-relaxed">
        La sucursal completa: cuántos <span className="font-medium text-gray-600">celulares y equipos</span> y
        cuántos <span className="font-medium text-gray-600">accesorios</span> se vendieron y prestaron, cuántos
        siguen pendientes y cuántos ya se pagaron, lo pagado y lo que se debe — por tipo, mes a mes y por empleado.
      </p>

      {/* Sucursal */}
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <Store size={14} className="text-gray-400" /> Sucursal
        </label>
        {esAdmin && sucursales.length > 1 ? (
          <select value={sede ?? String(activa ?? '')}
            onChange={(e) => setSede(e.target.value === 'todas' ? 'todas' : Number(e.target.value))}
            className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm text-gray-900
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white">
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            <option value="todas">Todas las sedes (consolidado + una por hoja)</option>
          </select>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-100 rounded-xl text-sm text-gray-800">
            <Building2 size={15} className="text-gray-400" /> {nombre || 'Tu sucursal'}
          </div>
        )}
      </div>

      {/* Período */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <label className="text-sm font-medium text-gray-700">Período</label>
          <div className="flex gap-1">
            {[{ id: 'este', label: 'Este mes', r: mesActual }, { id: 'pasado', label: 'Mes pasado', r: mesPasado }]
              .map((p) => (
                <button key={p.id} type="button" onClick={() => setRango(p.r)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors
                    ${esRango(p.r) ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {p.label}
                </button>
              ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" label="Desde" value={rango.desde} max={rango.hasta || undefined}
            onChange={(e) => setRango((r) => ({ ...r, desde: e.target.value }))} />
          <Input type="date" label="Hasta" value={rango.hasta} min={rango.desde || undefined}
            onChange={(e) => setRango((r) => ({ ...r, hasta: e.target.value }))} />
        </div>
        <p className="text-[11px] text-gray-400">Con varios meses, el PDF trae una fila por mes.</p>
        {rangoMalo && rango.desde && rango.hasta && (
          <p className="text-xs text-red-500">La fecha inicial no puede ser posterior a la final.</p>
        )}
      </div>

      {/* Vista previa: las mismas cifras del PDF */}
      {!rangoMalo && (
        isLoading ? (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-gray-400">
            <Spinner size="sm" /> Calculando…
          </div>
        ) : isError ? (
          <p className="text-xs text-red-500">No se pudieron calcular las cifras. Intenta de nuevo.</p>
        ) : vacio ? (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            No hay ventas, créditos ni préstamos en {nombre || 'esta sucursal'} en este período.
          </div>
        ) : total && (
          <div className={`grid grid-cols-2 sm:grid-cols-3 gap-2 transition-opacity ${isFetching ? 'opacity-60' : ''}`}>
            <CifraSede titulo="Celulares y equipos" valor={numero(unidadesVigentes(total, 'equipo'))}
              detalle={`${numero(total.unidades.equipo.pendiente)} pendientes · ${numero(total.unidades.equipo.pagado)} pagados`}
              tono="text-blue-600" />
            <CifraSede titulo="Accesorios" valor={numero(unidadesVigentes(total, 'accesorio'))}
              detalle={`${numero(total.unidades.accesorio.pendiente)} pendientes · ${numero(total.unidades.accesorio.pagado)} pagados`}
              tono="text-violet-600" />
            <CifraSede titulo="Activos por cobrar" valor={numero(total.activos)}
              detalle={`${numero(total.saldados)} documentos pagados`} tono="text-amber-600" />
            <CifraSede titulo="Valor del período" valor={formatCOP(total.valor)}
              detalle={`${numero(total.documentos)} documentos`} />
            <CifraSede titulo="Total pagado" valor={formatCOP(total.pagado)} tono="text-green-600" />
            <CifraSede titulo="Total debido" valor={formatCOP(total.debe)} detalle="capital, sin mora" tono="text-red-600" />
          </div>
        )
      )}

      {/* Qué incluye */}
      <label className="flex items-start gap-3 p-3 rounded-xl border border-gray-200 cursor-pointer hover:bg-gray-50">
        <input type="checkbox" checked={pendientes} onChange={(e) => setPendientes(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
        <span className="flex-1">
          <span className="flex items-center gap-1.5 text-sm font-medium text-gray-800">
            <ListChecks size={14} className="text-gray-400" /> Incluir lo que se debe, documento por documento
          </span>
          <span className="block text-xs text-gray-500 mt-0.5">
            Cada crédito y préstamo con saldo: persona, producto, empleado, pagado y debe. Desmárcalo para solo el resumen.
          </span>
        </span>
      </label>

      {error && <p className="text-xs text-red-500 text-center">{error}</p>}

      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
        <Button className="flex-1" loading={generando} disabled={rangoMalo || isError} onClick={descargar}>
          {!generando && <FileDown size={15} />}
          {generando ? 'Generando…' : 'Descargar PDF'}
        </Button>
      </div>
    </div>
  );
}

/**
 * Reportes de Préstamos: por empleado (lo que cada uno movió) y por sede (la
 * sucursal entera, con plata). El vendedor solo ve el suyo: el de sede son las
 * cifras de todos y el backend se lo niega.
 */
export function ModalReporteEmpleado({ onClose }) {
  const { usuario } = useAuth();
  const puedeSede = usuario?.rol && usuario.rol !== 'vendedor';
  const [vista, setVista] = useState('empleado');

  return (
    <Modal open onClose={onClose} title={puedeSede ? 'Reportes' : 'Reporte por empleado'} size="md">
      <div className="flex flex-col gap-4">
        {puedeSede && (
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
            {[
              { id: 'empleado', label: 'Por empleado', Icn: Users     },
              { id: 'sede',     label: 'Por sede',     Icn: Building2 },
            ].map((v) => {
              const VIcn = v.Icn;
              return (
                <button key={v.id} type="button" onClick={() => setVista(v.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                    ${vista === v.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  <VIcn size={13} /> {v.label}
                </button>
              );
            })}
          </div>
        )}
        {vista === 'sede' && puedeSede
          ? <PanelReporteSede onClose={onClose} />
          : <PanelReporteEmpleado onClose={onClose} />}
      </div>
    </Modal>
  );
}
