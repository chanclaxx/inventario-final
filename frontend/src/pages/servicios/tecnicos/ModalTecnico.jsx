import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { crearTecnico, actualizarTecnico } from '../../../api/tecnicos.api';
import { Modal }  from '../../../components/ui/Modal';
import { Input }  from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';

// Crear o editar un técnico. Se remonta por `key` al cambiar de técnico: sin
// efectos que sincronicen el formulario.
export function ModalTecnico({ tecnico = null, onClose, onGuardado }) {
  const [form, setForm] = useState({
    nombre:                tecnico?.nombre ?? '',
    telefono:              tecnico?.telefono ?? '',
    cedula:                tecnico?.cedula ?? '',
    especialidad:          tecnico?.especialidad ?? '',
    garantia_dias_default: tecnico?.garantia_dias_default ?? '',
    notas:                 tecnico?.notas ?? '',
    activo:                tecnico?.activo ?? true,
  });
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const mut = useMutation({
    mutationFn: () => {
      const datos = {
        ...form,
        garantia_dias_default: form.garantia_dias_default === '' ? null : Number(form.garantia_dias_default),
      };
      return tecnico ? actualizarTecnico(tecnico.id, datos) : crearTecnico(datos);
    },
    onSuccess: (r) => { onGuardado?.(r.data.data); onClose(); },
    onError:   (err) => setError(err.response?.data?.error || 'No se pudo guardar el técnico'),
  });

  return (
    <Modal open onClose={onClose} title={tecnico ? 'Editar técnico' : 'Nuevo técnico'}>
      <div className="flex flex-col gap-3">
        <Input label="Nombre *" value={form.nombre} onChange={(e) => set('nombre', e.target.value)} autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Teléfono" value={form.telefono} onChange={(e) => set('telefono', e.target.value)} />
          <Input label="Cédula / NIT" value={form.cedula} onChange={(e) => set('cedula', e.target.value)} />
        </div>
        <Input label="Especialidad" placeholder="Baterías, pantallas, placa…"
          value={form.especialidad} onChange={(e) => set('especialidad', e.target.value)} />
        <Input label="Garantía que suele dar (días)" type="number" min="0"
          value={form.garantia_dias_default} onChange={(e) => set('garantia_dias_default', e.target.value)} />
        <p className="text-xs text-gray-400 -mt-2">
          Se precarga al recibir cada equipo; ahí se puede cambiar trabajo por trabajo.
        </p>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700">Notas</span>
          <textarea rows={2} value={form.notas} onChange={(e) => set('notas', e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </label>
        {tecnico && (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.activo} onChange={(e) => set('activo', e.target.checked)} />
            Activo (a un técnico inactivo no se le mandan equipos nuevos)
          </label>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={mut.isPending} disabled={!form.nombre.trim()} onClick={() => mut.mutate()}>
            Guardar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
