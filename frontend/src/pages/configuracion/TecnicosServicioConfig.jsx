import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/useAuth';
import { getSucursales } from '../../api/sucursales.api';
import { getUsuarios } from '../../api/usuarios.api';
import {
  getTecnicosServicio, crearTecnicoServicio, actualizarTecnicoServicio,
} from '../../api/servicios.api';
import { Modal }  from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input }  from '../../components/ui/Input';
import { Badge }  from '../../components/ui/Badge';
import {
  Plus, Pencil, UserX, UserCheck, HardHat, ToggleLeft, ToggleRight, Store, User,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Técnicos INTERNOS de servicio técnico (quién reparó cada orden). Opt-in:
// `servicios_tecnicos_activo` (ausente = apagado). Encendido, «Marcar listo»
// pide quién lo reparó, las órdenes se filtran por técnico y Reportes → Ventas
// trae la tabla «Por técnico». Un técnico puede no tener usuario en la app.
// Los técnicos EXTERNOS son otra cosa y viven en su propio apartado.
// ─────────────────────────────────────────────────────────────────────────────

function Toggle({ enabled, onChange, label, description }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {description && <span className="text-xs text-gray-400">{description}</span>}
      </div>
      <button type="button" onClick={() => onChange(!enabled)} className="flex-shrink-0 transition-colors"
        aria-pressed={enabled}>
        {enabled
          ? <ToggleRight size={28} className="text-blue-600" />
          : <ToggleLeft  size={28} className="text-gray-300" />}
      </button>
    </div>
  );
}

const CLASE_SELECT = `w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm text-gray-900
  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all`;

function ModalTecnico({ editando, sucursales, usuarios, onClose, onGuardar, cargando, error }) {
  const [nombre,     setNombre]     = useState(editando?.nombre ?? '');
  const [sucursalId, setSucursalId] = useState(editando?.sucursal_id ?? '');
  const [usuarioId,  setUsuarioId]  = useState(editando?.usuario_id ?? '');

  return (
    <Modal open onClose={onClose} title={editando ? 'Editar técnico' : 'Nuevo técnico'} size="sm">
      <div className="flex flex-col gap-4">
        <Input label="Nombre" placeholder="Ej: Andrés Gómez" value={nombre}
          onChange={(e) => setNombre(e.target.value)} autoFocus />
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Sede</label>
          <select value={sucursalId ?? ''} onChange={(e) => setSucursalId(e.target.value)} className={CLASE_SELECT}>
            <option value="">Todas las sedes</option>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Su usuario en la app <span className="text-gray-400 font-normal">(opcional)</span>
          </label>
          <select value={usuarioId ?? ''} onChange={(e) => setUsuarioId(e.target.value)} className={CLASE_SELECT}>
            <option value="">No tiene usuario</option>
            {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </div>
        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={cargando}
            onClick={() => onGuardar({
              nombre, sucursal_id: sucursalId || null, usuario_id: usuarioId || null,
            })}>
            {editando ? 'Guardar cambios' : 'Crear técnico'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function FilaTecnico({ tecnico, onEditar, onToggleActivo }) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all
      ${tecnico.activo ? 'bg-gray-50 border-gray-100' : 'bg-gray-50/50 border-gray-100 opacity-60'}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-gray-800 truncate">{tecnico.nombre}</p>
          {!tecnico.activo && <Badge variant="red">Inactivo</Badge>}
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 flex-wrap">
          <span className="flex items-center gap-1"><Store size={11} />{tecnico.sucursal_nombre || 'Todas las sedes'}</span>
          {tecnico.usuario_nombre && (
            <span className="flex items-center gap-1"><User size={11} />{tecnico.usuario_nombre}</span>
          )}
        </div>
      </div>
      <div className="flex gap-1 flex-shrink-0">
        <button onClick={() => onEditar(tecnico)} title="Editar técnico"
          className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors">
          <Pencil size={14} />
        </button>
        <button onClick={() => onToggleActivo(tecnico)} title={tecnico.activo ? 'Desactivar' : 'Activar'}
          className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors">
          {tecnico.activo ? <UserX size={14} /> : <UserCheck size={14} />}
        </button>
      </div>
    </div>
  );
}

export function TecnicosServicioConfig({ valores, set }) {
  const { esAdminNegocio } = useAuth();
  const esAdmin = esAdminNegocio();
  const queryClient = useQueryClient();
  const activo = valores['servicios_tecnicos_activo'] === '1';

  const [modal, setModal] = useState(null);   // null | 'nuevo' | técnico
  const [error, setError] = useState('');

  const { data } = useQuery({
    queryKey: ['servicios-tecnicos', 'todos'],
    queryFn:  () => getTecnicosServicio(true).then((r) => r.data.data),
    enabled:  activo && esAdmin,
  });
  const tecnicos = data?.tecnicos || [];
  const { data: sucursales = [] } = useQuery({
    queryKey: ['sucursales'],
    queryFn:  () => getSucursales().then((r) => r.data.data),
    enabled:  activo && esAdmin,
  });
  const { data: usuarios = [] } = useQuery({
    queryKey: ['usuarios'],
    queryFn:  () => getUsuarios().then((r) => r.data.data),
    enabled:  activo && esAdmin,
  });

  const refrescar = () => queryClient.invalidateQueries({ queryKey: ['servicios-tecnicos'], exact: false });
  const cerrar = () => { setModal(null); setError(''); };
  const mutGuardar = useMutation({
    mutationFn: (payload) => (modal && modal !== 'nuevo'
      ? actualizarTecnicoServicio(modal.id, payload)
      : crearTecnicoServicio(payload)),
    onSuccess: () => { refrescar(); cerrar(); },
    onError:   (e) => setError(e.response?.data?.error || 'No se pudo guardar el técnico'),
  });
  const mutActivo = useMutation({
    mutationFn: (t) => actualizarTecnicoServicio(t.id, { activo: !t.activo }),
    onSuccess:  refrescar,
  });

  const activos   = tecnicos.filter((t) => t.activo);
  const inactivos = tecnicos.filter((t) => !t.activo);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <HardHat size={15} className="text-gray-400" />
        <h3 className="text-sm font-semibold text-gray-700">Técnicos de servicio técnico</h3>
      </div>
      <p className="text-xs text-gray-400 -mt-2">
        Quién repara cada equipo. Encendido, al marcar una orden como lista se pide qué técnico la
        reparó, las órdenes se pueden filtrar por técnico y Reportes → Ventas muestra cuántas
        reparó cada uno, cuánto dejaron y cuántas volvieron por garantía.
      </p>
      <Toggle
        label="Registrar qué técnico reparó cada orden"
        description="Se guarda con el botón Guardar"
        enabled={activo}
        onChange={(val) => set('servicios_tecnicos_activo', val ? '1' : '0')}
      />

      {activo && !esAdmin && (
        <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
          Solo el administrador del negocio puede gestionar la lista de técnicos.
        </p>
      )}

      {activo && esAdmin && (
        <div className="flex flex-col gap-3 border-t border-gray-100 pt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-gray-700">Lista de técnicos</h4>
              <Badge variant="gray">{activos.length} activos</Badge>
            </div>
            <button onClick={() => { setError(''); setModal('nuevo'); }} title="Agregar técnico"
              className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center hover:bg-blue-700 transition-colors">
              <Plus size={16} className="text-white" />
            </button>
          </div>
          {tecnicos.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">
              Sin técnicos registrados. Crea el primero con el botón +.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {activos.map((t) => (
                <FilaTecnico key={t.id} tecnico={t} onEditar={(x) => { setError(''); setModal(x); }}
                  onToggleActivo={(x) => mutActivo.mutate(x)} />
              ))}
              {inactivos.length > 0 && (
                <>
                  <p className="text-xs text-gray-400 mt-2 px-1">Inactivos</p>
                  {inactivos.map((t) => (
                    <FilaTecnico key={t.id} tecnico={t} onEditar={(x) => { setError(''); setModal(x); }}
                      onToggleActivo={(x) => mutActivo.mutate(x)} />
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {modal && (
        <ModalTecnico key={modal === 'nuevo' ? 'nuevo' : modal.id}
          editando={modal === 'nuevo' ? null : modal}
          sucursales={sucursales} usuarios={usuarios}
          onClose={cerrar} onGuardar={(p) => mutGuardar.mutate(p)}
          cargando={mutGuardar.isPending} error={error} />
      )}
    </div>
  );
}
