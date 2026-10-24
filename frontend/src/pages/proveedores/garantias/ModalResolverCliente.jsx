import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Repeat2, Banknote } from 'lucide-react';
import { buscarCandidatos, resolverCliente } from '../../../api/garantiasProveedor.api';
import { Modal }       from '../../../components/ui/Modal';
import { Button }      from '../../../components/ui/Button';
import { Spinner }     from '../../../components/ui/Spinner';
import { SearchInput } from '../../../components/ui/SearchInput';
import { InputMoneda } from '../../../components/ui/InputMoneda';
import { useMetodosPago } from '../../../hooks/useMetodosPago';
import { useGarantiasProveedor } from '../../../hooks/useEnGarantia';
import { formatCOP } from '../../../utils/formatters';
import { mensajeError } from './garantiasUi';
import { TarjetaCandidato, OpcionGrande } from './piezasGarantia';
import { refrescarTrasGarantia } from './refrescar';

// ─────────────────────────────────────────────────────────────────────────────
// El cliente que quedó esperando: entregarle la unidad (suele ser la que acaba
// de reponer el proveedor) o devolverle el dinero. Las mismas reglas que al
// recibir: la unidad sale del stock vendible; el dinero deshace la venta.
// ─────────────────────────────────────────────────────────────────────────────
export function ModalResolverCliente({ reclamo, linea, onClose, onHecho }) {
  const queryClient = useQueryClient();
  const metodos = useMetodosPago();
  const { puede } = useGarantiasProveedor();
  const pendiente = Number(linea.cantidad) - Number(linea.cantidad_cliente);
  const [accion, setAccion]   = useState(puede('cliente') ? 'cambio' : 'reembolso');
  const [cantidad, setCantidad] = useState(pendiente);
  const [busqueda, setBusqueda] = useState('');
  const [reemplazo, setReemplazo] = useState(null);
  const [metodo, setMetodo]   = useState('Efectivo');
  const [valor, setValor]     = useState('');
  const [error, setError]     = useState('');

  const cant = linea.tipo === 'serial' ? 1 : Math.min(Math.max(1, Number(cantidad) || 1), pendiente);
  const esCredito = reclamo.factura_estado === 'Credito';
  const tope = Number(linea.precio_venta || 0) * cant;
  const q = busqueda.trim();
  const { data: raw = [], isFetching } = useQuery({
    queryKey: ['garantias-candidatos', 'reemplazo', q],
    queryFn:  () => buscarCandidatos({ q }).then((r) => r.data.data),
    enabled:  accion === 'cambio' && linea.tipo === 'serial' && q.length >= 2,
  });
  const opciones = raw.filter((c) => c.origen_tipo === 'inventario' && c.tipo === 'serial' && c.serial_id !== linea.serial_id);

  const mut = useMutation({
    mutationFn: () => resolverCliente(linea.id, accion === 'cambio'
      ? { tipo: 'cambio', cantidad: cant, unidad: linea.tipo === 'serial' ? { serial_id: reemplazo?.serial_id } : undefined }
      : { tipo: 'reembolso', cantidad: cant, metodo, valor: esCredito || valor === '' ? undefined : Number(valor) }),
    onSuccess: () => { refrescarTrasGarantia(queryClient); onHecho?.(); onClose(); },
    onError: (err) => setError(mensajeError(err, 'No se pudo registrar')),
  });

  const listo = accion === 'cambio' ? (linea.tipo === 'cantidad' || !!reemplazo) : true;

  return (
    <Modal open onClose={onClose} title={`Atender a ${reclamo.cliente_nombre || 'el cliente'}`} size="lg">
      <div className="flex flex-col gap-3">
        <TarjetaCandidato c={{ ...linea, tipo: undefined }} compacta />
        {linea.tipo === 'cantidad' && pendiente > 1 && (
          <label className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-700">¿Cuántas?</span>
            <input type="number" min={1} max={pendiente} value={cantidad} onChange={(e) => setCantidad(e.target.value)}
              className="w-24 px-3 py-2 border border-gray-200 rounded-xl text-sm" />
            <span className="text-xs text-gray-400">le faltan {pendiente}</span>
          </label>
        )}
        <OpcionGrande activa={accion === 'cambio'} onClick={() => setAccion('cambio')} icono={Repeat2} color="blue"
          titulo="Entregarle otra unidad" deshabilitada={!puede('cliente')}
          descripcion="Sale del stock vendible" nota={!puede('cliente') ? 'Tu usuario no tiene este permiso' : null} />
        {accion === 'cambio' && linea.tipo === 'serial' && (
          <div className="ml-12 flex flex-col gap-2">
            {reemplazo ? (
              <>
                <TarjetaCandidato c={reemplazo} compacta />
                <button type="button" onClick={() => setReemplazo(null)} className="text-xs text-blue-600 self-start hover:underline">Cambiar el equipo</button>
              </>
            ) : (
              <>
                <SearchInput value={busqueda} onChange={setBusqueda} autoFocus
                  placeholder="Escanea o busca el IMEI del equipo que le entregas…"
                  onEnter={() => { if (opciones.length === 1 && !opciones[0].bloqueo) setReemplazo(opciones[0]); }} />
                {isFetching && <Spinner className="py-2" />}
                {q.length >= 2 && !isFetching && (opciones.length === 0
                  ? <p className="text-xs text-gray-400">No hay equipos disponibles con ese IMEI.</p>
                  : <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                      {opciones.map((c) => <TarjetaCandidato key={c.clave} c={c} compacta onElegir={setReemplazo} />)}
                    </div>)}
              </>
            )}
          </div>
        )}
        {accion === 'cambio' && linea.tipo === 'cantidad' && (
          <p className="ml-12 text-xs text-gray-500">Se entregan {cant} unidad(es) de <b>{linea.nombre_producto}</b> del stock.</p>
        )}
        <OpcionGrande activa={accion === 'reembolso'} onClick={() => setAccion('reembolso')} icono={Banknote} color="green"
          titulo="Devolverle el dinero" deshabilitada={!puede('reembolsar') || reclamo.origen_tipo !== 'factura'}
          descripcion={esCredito ? `Se descuenta del crédito: ${formatCOP(tope)}` : `Sale de la caja y se deshace la venta (hasta ${formatCOP(tope)})`}
          nota={reclamo.origen_tipo !== 'factura' ? 'En un préstamo activo se devuelve con «Devolver» en el préstamo'
            : !puede('reembolsar') ? 'Tu usuario no tiene este permiso' : null} />
        {accion === 'reembolso' && !esCredito && (
          <div className="ml-12 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">Valor que se devuelve</span>
              <InputMoneda value={valor === '' ? tope : valor} onChange={setValor} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">Cómo se devuelve</span>
              <select value={metodo} onChange={(e) => setMetodo(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white">
                {metodos.filter((m) => m.id !== 'Credito').map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
          </div>
        )}
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mut.isPending} disabled={!listo} onClick={() => { setError(''); mut.mutate(); }}>
            Registrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
