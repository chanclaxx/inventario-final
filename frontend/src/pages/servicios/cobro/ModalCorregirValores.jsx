import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { corregirValoresServicio } from '../../../api/servicios.api';
import { useAuth } from '../../../context/useAuth';
import { formatCOP } from '../../../utils/formatters';
import { camposCorregibles, efectoCorreccion, abonado } from '../../../utils/servicioCobro';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { InputMoneda } from '../../../components/ui/InputMoneda';
import { SelectorMetodo } from './piezasServicio';

// ─────────────────────────────────────────────────────────────────────────────
// Corregir los valores de una orden (una equivocación al escribirlos): lo que
// se le cobra al cliente, el costo y el estimado. Antes de guardar dice qué
// pasa con la plata —la regla es la del backend (utils/servicioCobro.js)—:
// si el precio queda por debajo de lo pagado se devuelve la diferencia; si
// sube en una orden entregada, vuelve a quedar pendiente de pago; en un «sin
// reparar» cuyo diagnóstico sube, se cobra ahora. Solo viaja lo que cambió.
// ─────────────────────────────────────────────────────────────────────────────

const CLASE = `w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700
  focus:outline-none focus:ring-2 focus:ring-blue-500`;

const num = (v) => (v === null || v === undefined || v === '' ? '' : Number(v));

export function ModalCorregirValores({ orden, onClose, onExito }) {
  const { esAdminNegocio } = useAuth();
  const esAdmin = esAdminNegocio();
  const c = camposCorregibles(orden);
  const original = {
    precio: num(orden[c.campoPrecio]),
    costo: num(orden[c.campoCosto]),
    estimado: num(orden.costo_estimado),
  };
  const [precio, setPrecio] = useState(original.precio);
  const [costo, setCosto] = useState(original.costo);
  const [estimado, setEstimado] = useState(original.estimado);
  const [metodo, setMetodo] = useState('Efectivo');
  const [motivo, setMotivo] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const cambio = (actual, antes) => actual !== '' && Number(actual) !== Number(antes === '' ? NaN : antes);
  const cambiaPrecio = c.precio && cambio(precio, original.precio);
  const cambiaCosto = c.costo && cambio(costo, original.costo);
  const cambiaEstimado = cambio(estimado, original.estimado);
  const efecto = efectoCorreccion(orden, cambiaPrecio ? precio : null);
  const pideMetodo = efecto.devolver > 0 || efecto.cobrar > 0;
  const hayCambios = cambiaPrecio || cambiaCosto || cambiaEstimado;
  const listo = hayCambios && motivo.trim().length >= 3 && (esAdmin || pin.trim());

  const mut = useMutation({
    mutationFn: () => corregirValoresServicio(orden.id, {
      ...(cambiaPrecio ? { precio: Number(precio) } : {}),
      ...(cambiaCosto ? { costo: Number(costo) } : {}),
      ...(cambiaEstimado ? { costo_estimado: Number(estimado) } : {}),
      ...(pideMetodo ? { ajuste: { metodo } } : {}),
      motivo: motivo.trim(),
      ...(esAdmin ? {} : { pin: pin.trim() }),
    }),
    onSuccess: () => { onExito?.(); onClose(); },
    onError: (err) => setError(err.response?.data?.error || 'No se pudo corregir'),
  });

  return (
    <Modal open onClose={onClose} title="Corregir valores" size="sm">
      <div className="flex flex-col gap-4">
        <div className="bg-gray-50 rounded-xl px-3 py-2">
          <p className="text-sm font-semibold text-gray-800">
            #OS-{String(orden.numero ?? orden.id).padStart(4, '0')} · {orden.cliente_nombre}
          </p>
          <p className="text-xs text-gray-500">Pagado hasta hoy: {formatCOP(abonado(orden))}</p>
        </div>

        {c.precio && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">{c.etiquetaPrecio}</label>
            <InputMoneda value={precio} onChange={setPrecio} placeholder="0" className={CLASE} />
          </div>
        )}
        {c.costo && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">
              Costo <span className="text-gray-400 font-normal">(solo mueve la utilidad)</span>
            </label>
            <InputMoneda value={costo} onChange={setCosto} placeholder="0" className={CLASE} />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Costo estimado</label>
          <InputMoneda value={estimado} onChange={setEstimado} placeholder="0" className={CLASE} />
        </div>

        {cambiaPrecio && (efecto.devolver > 0 || efecto.cobrar > 0 || efecto.pendiente > 0
          || efecto.estado !== orden.estado) && (
          <div className="flex flex-col gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-sm text-amber-800">
            {efecto.devolver > 0 && <p>Hay que devolverle <strong>{formatCOP(efecto.devolver)}</strong> al cliente. Sale de la caja.</p>}
            {efecto.cobrar > 0 && <p>El cliente debe pagar ahora <strong>{formatCOP(efecto.cobrar)}</strong> más.</p>}
            {efecto.pendiente > 0 && (
              <p>Queda un saldo de <strong>{formatCOP(efecto.pendiente)}</strong>
                {efecto.estado === 'Pendiente_pago' && orden.estado === 'Entregado' ? ' y la orden vuelve a Pendiente de pago' : ''}.</p>
            )}
            {efecto.estado === 'Entregado' && orden.estado === 'Pendiente_pago' && <p>Con esto queda pagada y entregada.</p>}
            {pideMetodo && (
              <SelectorMetodo value={metodo} onChange={setMetodo}
                label={efecto.devolver > 0 ? '¿Cómo se le devuelve?' : '¿Cómo paga?'} />
            )}
          </div>
        )}

        <Input label="¿Por qué se corrige? *" placeholder="Ej: se escribió 300.000 y era 30.000"
          value={motivo} onChange={(e) => setMotivo(e.target.value)} />

        {!esAdmin && (
          <Input label="PIN de administrador *" type="password" inputMode="numeric"
            value={pin} onChange={(e) => { setPin(e.target.value); setError(''); }} />
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mut.isPending} disabled={!listo}
            onClick={() => { setError(''); mut.mutate(); }}>
            Guardar corrección
          </Button>
        </div>
      </div>
    </Modal>
  );
}
