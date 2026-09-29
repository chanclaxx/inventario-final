import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileDown, Smartphone, UserRound } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Spinner } from '../../components/ui/Spinner';
import { getEmpleadosReporte, descargarPdfReporteEmpleado } from '../../api/prestamos.api';
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

export function ModalReporteEmpleado({ onClose }) {
  const hoy = fechaHoyBogota();
  const [rango,       setRango]       = useState(() => rangoMes(hoy));
  const [seleccion,   setSeleccion]   = useState(null);
  const [soloEquipos, setSoloEquipos] = useState(true);
  const [generando,   setGenerando]   = useState(false);
  const [error,       setError]       = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['prestamos', 'reporte-empleado', 'empleados'],
    queryFn:  () => getEmpleadosReporte().then((r) => r.data.data),
  });

  const empleados   = data?.empleados ?? [];
  const puedeElegir = !!data?.puede_elegir;
  // Sin elección todavía: uno mismo si está en la lista; si no, todos.
  const porDefecto  = empleados.some((e) => e.id === data?.yo) ? String(data.yo) : 'todos';
  const elegido     = puedeElegir ? (seleccion ?? porDefecto) : String(data?.yo ?? '');

  const mesActual = rangoMes(hoy);
  const mesPasado = rangoMes(hoy, -1);
  const esRango   = (r) => r.desde === rango.desde && r.hasta === rango.hasta;
  const rangoMalo = !rango.desde || !rango.hasta || rango.desde > rango.hasta;

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
    <Modal open onClose={onClose} title="Reporte por empleado" size="md">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-gray-500 leading-relaxed">
          Todo lo que el empleado vendió de contado, dio a crédito y prestó a clientes y a
          compañeros en el período, separado por estado: pagados, pendientes, devueltos y
          cancelados. <span className="font-medium text-gray-600">Solo muestra la información;
          no calcula comisiones.</span>
        </p>

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
              <option value="todos">Todos los empleados (uno por hoja)</option>
              {empleados.map((e) => (
                <option key={e.id} value={String(e.id)}>
                  {e.nombre}{e.activo === false ? ' (inactivo)' : ''}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-100 rounded-xl text-sm text-gray-800">
              <UserRound size={15} className="text-gray-400" />
              {empleados[0]?.nombre || 'Tú'}
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
    </Modal>
  );
}
