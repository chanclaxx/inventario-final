import { useQuery } from '@tanstack/react-query';
import { ToggleLeft, ToggleRight } from 'lucide-react';
import api from '../../api/axios.config';
import { Spinner } from '../../components/ui/Spinner';

// ─────────────────────────────────────────────────────────────────────────────
// A QUIÉN MÁS SE LE CONCEDE ALGO — lista de usuarios con un interruptor cada uno
//
// Lo usan «Quién puede usar el PIN» (Seguridad, `pin_usuarios_autorizados`) y
// «Quién ve el precio de los despachos» (Red interna,
// `red_interna_valores_usuarios`). Las dos se guardan igual: un arreglo JSON de
// ids en `config_negocio`, ausente = solo los administradores, que pasan
// siempre y por eso no se guardan. El backend valida que cada id sea del
// negocio con la misma función para las dos.
// ─────────────────────────────────────────────────────────────────────────────
const ROL_LABEL = { admin_negocio: 'Administrador', supervisor: 'Supervisor', vendedor: 'Vendedor' };

const _parsearIds = (raw) => {
  try {
    const lista = JSON.parse(raw || '[]');
    return Array.isArray(lista) ? lista.map(Number) : [];
  } catch {
    return [];
  }
};

/**
 * @param {string}   clave        clave de config_negocio donde vive la lista
 * @param {Function} [filtrar]    qué usuarios no-admin se ofrecen (por defecto, todos)
 * @param {string}   [vacio]      texto cuando no hay a quién ofrecérselo
 */
export function UsuariosAutorizados({ valores, set, clave, titulo, descripcion, filtrar, vacio }) {
  const { data: usuarios = [], isLoading } = useQuery({
    queryKey: ['usuarios'],
    queryFn:  () => api.get('/usuarios').then((r) => r.data.data),
  });

  const autorizados = _parsearIds(valores[clave]);
  const activos     = usuarios.filter((u) => u.activo);
  const admins      = activos.filter((u) => u.rol === 'admin_negocio');
  const otros       = activos.filter((u) => u.rol !== 'admin_negocio' && (!filtrar || filtrar(u)));

  const toggle = (id, activar) => {
    // Solo se guardan ids de usuarios activos que no son admin: un usuario
    // desactivado sale de la lista la próxima vez que se guarde.
    const idsOtros  = new Set(otros.map((u) => u.id));
    const siguiente = autorizados.filter((x) => x !== id && idsOtros.has(x));
    if (activar) siguiente.push(id);
    set(clave, JSON.stringify(siguiente));
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-semibold text-gray-800">{titulo}</p>
        {descripcion && <p className="text-xs text-gray-400 mt-0.5">{descripcion}</p>}
      </div>

      {isLoading ? <Spinner className="py-4" /> : (
        <div className="flex flex-col divide-y divide-gray-100 border border-gray-100 rounded-xl">
          {admins.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm text-gray-700 truncate">{u.nombre}</p>
                <p className="text-xs text-gray-400">{ROL_LABEL[u.rol]}</p>
              </div>
              <span className="text-xs text-gray-400 flex-shrink-0">Siempre</span>
            </div>
          ))}
          {otros.map((u) => {
            const activo = autorizados.includes(u.id);
            return (
              <div key={u.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-gray-700 truncate">{u.nombre}</p>
                  <p className="text-xs text-gray-400">
                    {ROL_LABEL[u.rol] ?? u.rol}{u.sucursal_nombre ? ` · ${u.sucursal_nombre}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(u.id, !activo)}
                  className="flex-shrink-0"
                  title={activo ? 'Quitar permiso' : 'Dar permiso'}
                >
                  {activo
                    ? <ToggleRight size={28} className="text-blue-600" />
                    : <ToggleLeft  size={28} className="text-gray-300" />}
                </button>
              </div>
            );
          })}
          {!otros.length && (
            <p className="text-xs text-gray-400 px-3 py-2.5">
              {vacio ?? 'No hay usuarios activos que no sean administradores.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default UsuariosAutorizados;
