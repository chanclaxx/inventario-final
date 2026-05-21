import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios.config';
import { useAuth } from '../../context/useAuth';
import { Modal }   from '../../components/ui/Modal';
import { Button }  from '../../components/ui/Button';
import { Input }   from '../../components/ui/Input';
import { Badge }   from '../../components/ui/Badge';
import { Plus, Pencil, UserX, UserCheck, Users, ShieldCheck, Truck, PackageSearch, FileDown } from 'lucide-react';

// ─── Constantes ───────────────────────────────────────────────────────────────

const ROLES = [
  { value: 'admin_negocio', label: 'Admin negocio' },
  { value: 'supervisor',    label: 'Supervisor'    },
  { value: 'vendedor',      label: 'Vendedor'      },
];

const MODULOS = [
  { key: 'inventario',  label: 'Inventario'  },
  { key: 'facturar',    label: 'Facturas'    },
  { key: 'servicios',   label: 'Servicios'   },
  { key: 'proveedores', label: 'Proveedores' },
  { key: 'prestamos',   label: 'Préstamos'   },
  { key: 'caja',        label: 'Caja'        },
  { key: 'traslados',   label: 'Traslados'   },
  { key: 'reportes',    label: 'Reportes'    },
  { key: 'acreedores',  label: 'Acreedores'  },
];

const PERMISOS_BASE = {
  supervisor: ['inventario','facturar','servicios','proveedores',
               'prestamos','caja','traslados','reportes','acreedores'],
  vendedor:   ['inventario','facturar','servicios','prestamos'],
};

const CAMPOS_EDICION = [
  { key: 'nombre',          label: 'Nombre'        },
  { key: 'precio',          label: 'Precio'        },
  { key: 'costo',           label: 'Costo'         },
  { key: 'stock_minimo',    label: 'Stock mín.'    },
  { key: 'unidad_medida',   label: 'Unidad medida' },
  { key: 'linea',           label: 'Línea'         },
  { key: 'proveedor',       label: 'Proveedor'     },
  { key: 'imei',            label: 'IMEI/Serial'   },
  { key: 'color',           label: 'Color'         },
  { key: 'caracteristicas', label: 'Características' },
];

const CAMPOS_DEFAULT = CAMPOS_EDICION
  .map((c) => c.key)
  .filter((k) => k !== 'proveedor' && k !== 'costo');

const FORM_INICIAL = {
  nombre:                      '',
  email:                       '',
  password:                    '',
  rol:                         'vendedor',
  sucursal_id:                 '',
  modulos_permitidos:          null,
  permisos_proveedores:        null,
  permisos_edicion_productos:  null,
};

// ─── Queries ──────────────────────────────────────────────────────────────────

const fetchUsuarios   = () => api.get('/usuarios').then((r)   => r.data.data);
const fetchSucursales = () => api.get('/sucursales').then((r) => r.data.data);
const fetchProveedores = () => api.get('/proveedores').then((r) => {
  const data = r.data.data;
  return Array.isArray(data) ? data : [];
});

// ─── CheckboxCustom ───────────────────────────────────────────────────────────

function CheckboxCustom({ checked, onChange, color = 'indigo' }) {
  const colors = {
    indigo: checked ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300 bg-white',
    green:  checked ? 'bg-green-600  border-green-600'  : 'border-gray-300 bg-white',
    blue:   checked ? 'bg-blue-600   border-blue-600'   : 'border-gray-300 bg-white',
  };
  return (
    <span
      onClick={onChange}
      className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0
        cursor-pointer transition-all ${colors[color]}`}
    >
      {checked && (
        <svg viewBox="0 0 8 8" className="w-2.5 h-2.5">
          <path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5"
            fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </span>
  );
}

// ─── SelectorPermisosProveedores ──────────────────────────────────────────────

function SelectorPermisosProveedores({ permisos, onChange, proveedores = [] }) {
  const tieneVer    = permisos?.ver         ?? false;
  const tieneCrear  = permisos?.crear       ?? false;
  const verTodos    = permisos?.ver_todos   ?? true;
  const verLista    = permisos?.ver_lista   ?? [];
  const verCompras  = permisos?.ver_compras ?? false;

  const update = (partial) => {
    const base = permisos || { ver: false, ver_todos: true, ver_lista: [], crear: false, ver_compras: false };
    onChange({ ...base, ...partial });
  };

  const toggleVerLista = (id) => {
    const lista = verLista.includes(id)
      ? verLista.filter((v) => v !== id)
      : [...verLista, id];
    update({ ver_lista: lista });
  };

  return (
    <div className="flex flex-col gap-3 bg-indigo-50 border border-indigo-100 rounded-xl p-3.5">
      <div className="flex items-center gap-2">
        <Truck size={13} className="text-indigo-500 flex-shrink-0" />
        <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">
          Permisos de proveedores
        </p>
      </div>

      {/* ── Ver proveedores ── */}
      <label className="flex items-center gap-2.5 cursor-pointer select-none">
        <CheckboxCustom
          checked={tieneVer}
          onChange={() => update({ ver: !tieneVer })}
        />
        <span className="text-sm text-gray-700">Puede ver proveedores</span>
      </label>

      {tieneVer && (
        <div className="ml-6 flex flex-col gap-2">
          {/* Radios: ver todos / ver algunos */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="radio"
              className="accent-indigo-600 w-3.5 h-3.5"
              checked={verTodos}
              onChange={() => update({ ver_todos: true, ver_lista: [] })}
            />
            <span className="text-sm text-gray-600">Ver todos</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="radio"
              className="accent-indigo-600 w-3.5 h-3.5"
              checked={!verTodos}
              onChange={() => update({ ver_todos: false })}
            />
            <span className="text-sm text-gray-600">Ver solo algunos</span>
          </label>

          {!verTodos && (
            <div className="mt-1 bg-white border border-indigo-100 rounded-xl overflow-hidden">
              {proveedores.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-3">
                  Sin proveedores registrados
                </p>
              ) : (
                <div className="flex flex-col divide-y divide-gray-50 max-h-40 overflow-y-auto">
                  {proveedores.map((p) => {
                    const pId      = p.id;
                    const pNombre  = p.nombre;
                    const selected = verLista.includes(pId);
                    return (
                      <label
                        key={pId}
                        className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer
                          select-none transition-colors
                          ${selected ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}
                      >
                        <CheckboxCustom
                          checked={selected}
                          onChange={() => toggleVerLista(pId)}
                        />
                        <span className="text-xs text-gray-700 truncate">{pNombre}</span>
                      </label>
                    );
                  })}
                </div>
              )}
              {!verTodos && verLista.length > 0 && (
                <p className="text-xs text-indigo-600 px-3 py-1.5 border-t border-indigo-100 bg-indigo-50">
                  {verLista.length} proveedor(es) seleccionado(s)
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Crear proveedores ── */}
      <label className="flex items-center gap-2.5 cursor-pointer select-none">
        <CheckboxCustom
          checked={tieneCrear}
          onChange={() => update({ crear: !tieneCrear })}
        />
        <span className="text-sm text-gray-700">Puede crear proveedores</span>
      </label>

      {/* ── Ver historial de compras ── */}
      <label className="flex items-center gap-2.5 cursor-pointer select-none">
        <CheckboxCustom
          checked={verCompras}
          onChange={() => update({ ver_compras: !verCompras })}
        />
        <span className="text-sm text-gray-700">Puede ver historial de compras</span>
      </label>

      {/* Nota: si no tiene ningún permiso activo, mostrar hint */}
      {!tieneVer && !tieneCrear && !verCompras && (
        <p className="text-xs text-gray-400 bg-white rounded-lg px-3 py-1.5 border border-gray-100">
          Sin permisos de proveedores — el módulo estará vacío para este usuario.
        </p>
      )}
    </div>
  );
}

// ─── SelectorPermisosEdicionProductos ────────────────────────────────────────

function SelectorPermisosEdicionProductos({ permisos, onChange }) {
  const puedeEditar        = permisos?.puede_editar        ?? false;
  const puedeExportar      = permisos?.puede_exportar      ?? false;
  const puedeExportarGlobal = permisos?.puede_exportar_global ?? false;
  const campos             = permisos?.campos ?? CAMPOS_DEFAULT;

  const update = (partial) => {
    const base = permisos || { puede_editar: false, puede_exportar: false, puede_exportar_global: false, campos: CAMPOS_DEFAULT };
    onChange({ ...base, ...partial });
  };

  const toggleCampo = (key) => {
    const siguiente = campos.includes(key)
      ? campos.filter((c) => c !== key)
      : [...campos, key];
    update({ campos: siguiente });
  };

  return (
    <div className="flex flex-col gap-3 bg-purple-50 border border-purple-100 rounded-xl p-3.5">
      <div className="flex items-center gap-2">
        <PackageSearch size={13} className="text-purple-500 flex-shrink-0" />
        <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide">
          Permisos de edición de productos
        </p>
      </div>

      <label className="flex items-center gap-2.5 cursor-pointer select-none">
        <CheckboxCustom
          checked={puedeEditar}
          onChange={() => {
            if (!puedeEditar) {
              onChange({ puede_editar: true, campos: CAMPOS_DEFAULT });
            } else {
              onChange(null);
            }
          }}
          color="indigo"
        />
        <span className="text-sm text-gray-700">Puede editar productos</span>
      </label>

      {puedeEditar && (
        <div className="ml-6 flex flex-col gap-2">
          <p className="text-xs text-gray-500">Campos que puede editar:</p>
          <div className="grid grid-cols-2 gap-1.5">
            {CAMPOS_EDICION.map(({ key, label }) => {
              const activo = campos.includes(key);
              return (
                <label
                  key={key}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border
                    cursor-pointer select-none text-xs transition-colors
                    ${activo
                      ? 'bg-purple-100 border-purple-300 text-purple-800'
                      : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300'}`}
                >
                  <CheckboxCustom
                    checked={activo}
                    onChange={() => toggleCampo(key)}
                    color="indigo"
                  />
                  {label}
                </label>
              );
            })}
          </div>
          {campos.length === 0 && (
            <p className="text-xs text-orange-500 bg-orange-50 rounded-lg px-3 py-1.5 border border-orange-100">
              Sin campos seleccionados — el modal se abrirá vacío.
            </p>
          )}
        </div>
      )}

      {!puedeEditar && (
        <p className="text-xs text-gray-400 bg-white rounded-lg px-3 py-1.5 border border-gray-100">
          Sin permiso — no podrá editar productos del inventario.
        </p>
      )}

      {/* Exportar inventario — independiente de puede_editar */}
      <label className="flex items-center gap-2.5 cursor-pointer select-none">
        <CheckboxCustom
          checked={puedeExportar}
          onChange={() => update({
            puede_exportar:        !puedeExportar,
            // al quitar exportar, también se quita el global
            ...(!puedeExportar ? {} : { puede_exportar_global: false }),
          })}
          color="indigo"
        />
        <span className="text-sm text-gray-700">Puede exportar inventario (Excel)</span>
      </label>

      {puedeExportar && (
        <label className="flex items-center gap-2.5 cursor-pointer select-none ml-6">
          <CheckboxCustom
            checked={puedeExportarGlobal}
            onChange={() => update({ puede_exportar_global: !puedeExportarGlobal })}
            color="indigo"
          />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-gray-700">Permite exportar inventario global</span>
            <span className="text-xs text-gray-400">Puede exportar todas las sucursales del negocio</span>
          </div>
        </label>
      )}

      {!puedeEditar && !puedeExportar && (
        <p className="text-xs text-gray-400 bg-white rounded-lg px-3 py-1.5 border border-gray-100">
          Sin permisos de inventario — no podrá editar ni exportar.
        </p>
      )}
    </div>
  );
}

// ─── SelectorModulos ──────────────────────────────────────────────────────────

function SelectorModulos({ rol, modulosPermitidos, onChange }) {
  if (rol === 'admin_negocio') {
    return (
      <div className="flex items-center gap-2 bg-blue-50 border border-blue-100
        rounded-xl px-3 py-2.5">
        <ShieldCheck size={14} className="text-blue-500 flex-shrink-0" />
        <p className="text-xs text-blue-700 font-medium">
          Admin negocio — acceso total a todos los módulos
        </p>
      </div>
    );
  }

  const estaPersonalizado = modulosPermitidos !== null;
  const activos = estaPersonalizado
    ? modulosPermitidos
    : (PERMISOS_BASE[rol] || []);

  const handleToggle = (key) => {
    const base = estaPersonalizado ? modulosPermitidos : (PERMISOS_BASE[rol] || []);
    const siguiente = base.includes(key)
      ? base.filter((k) => k !== key)
      : [...base, key];
    onChange(siguiente);
  };

  const handleResetear = () => onChange(null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">
          Acceso a módulos
        </label>
        {estaPersonalizado && (
          <button
            type="button"
            onClick={handleResetear}
            className="text-xs text-blue-500 hover:text-blue-700 transition-colors"
          >
            Restablecer por rol
          </button>
        )}
      </div>

      {!estaPersonalizado && (
        <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-1.5">
          Usando permisos base del rol. Toca un módulo para personalizar.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {MODULOS.map((modulo) => {
          const moduloKey   = modulo.key;
          const moduloLabel = modulo.label;
          const estaActivo  = activos.includes(moduloKey);
          const esBase      = !estaPersonalizado && (PERMISOS_BASE[rol] || []).includes(moduloKey);

          return (
            <button
              key={moduloKey}
              type="button"
              onClick={() => handleToggle(moduloKey)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm
                font-medium transition-all text-left
                ${estaActivo
                  ? esBase
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-gray-50 border-gray-200 text-gray-400 hover:border-gray-300'}`}
            >
              <span className={`w-3 h-3 rounded-sm border flex-shrink-0 flex items-center
                justify-center transition-all
                ${estaActivo
                  ? 'bg-current border-current'
                  : 'border-gray-300 bg-white'}`}
              >
                {estaActivo && (
                  <svg viewBox="0 0 8 8" className="w-2 h-2 text-white fill-current">
                    <path d="M1 4l2 2 4-4" stroke="currentColor" strokeWidth="1.5"
                      fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </span>
              {moduloLabel}
            </button>
          );
        })}
      </div>

      {estaPersonalizado && (
        <p className="text-xs text-blue-500">
          {activos.length} de {MODULOS.length} módulos habilitados — personalizado
        </p>
      )}
    </div>
  );
}

// ─── FilaUsuario ──────────────────────────────────────────────────────────────

function FilaUsuario({ usuario, onEditar, onToggleActivo }) {
  const rolLabel = ROLES.find((r) => r.value === usuario.rol)?.label ?? usuario.rol;
  const esAdmin  = usuario.rol === 'admin_negocio';

  const modulosActivos = esAdmin
    ? null
    : (usuario.modulos_permitidos ?? PERMISOS_BASE[usuario.rol] ?? []);

  const pp  = usuario.permisos_proveedores;
  const pep = usuario.permisos_edicion_productos;
  const tienePermProv     = !esAdmin && pp  && (pp.ver || pp.crear);
  const tienePermEditar   = !esAdmin && pep && pep.puede_editar;
  const tienePermExportar = !esAdmin && pep?.puede_exportar === true;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all
      ${usuario.activo ? 'bg-gray-50 border-gray-100' : 'bg-gray-50/50 border-gray-100 opacity-60'}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-gray-800 truncate">{usuario.nombre}</p>
          {!usuario.activo && <Badge variant="red">Inactivo</Badge>}
        </div>
        <p className="text-xs text-gray-400 truncate">{usuario.email}</p>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <Badge variant="blue">{rolLabel}</Badge>
          {usuario.sucursal_nombre && (
            <Badge variant="gray">{usuario.sucursal_nombre}</Badge>
          )}
          {esAdmin ? (
            <span className="text-xs text-blue-500 flex items-center gap-1">
              <ShieldCheck size={11} /> Acceso total
            </span>
          ) : usuario.modulos_permitidos !== null ? (
            <span className="text-xs text-purple-600 font-medium">
              {modulosActivos.length} módulos personalizados
            </span>
          ) : (
            <span className="text-xs text-gray-400">
              Permisos base del rol
            </span>
          )}
          {tienePermProv && (
            <span className="text-xs text-indigo-600 flex items-center gap-1">
              <Truck size={10} />
              {[pp.ver && 'Ver', pp.crear && 'Crear', pp.ver_compras && 'Compras']
                .filter(Boolean).join('+') + ' prov.'}
            </span>
          )}
          {tienePermEditar && (
            <span className="text-xs text-purple-600 flex items-center gap-1">
              <PackageSearch size={10} />
              Edita productos ({pep.campos?.length ?? 0} campos)
            </span>
          )}
          {tienePermExportar && (
            <span className="text-xs text-emerald-600 flex items-center gap-1">
              <FileDown size={10} />
              Exporta inventario
            </span>
          )}
        </div>
      </div>
      <div className="flex gap-1 flex-shrink-0">
        <button
          onClick={() => onEditar(usuario)}
          className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400
            hover:text-gray-600 transition-colors"
          title="Editar usuario"
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={() => onToggleActivo(usuario)}
          className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400
            hover:text-gray-600 transition-colors"
          title={usuario.activo ? 'Desactivar' : 'Activar'}
        >
          {usuario.activo ? <UserX size={14} /> : <UserCheck size={14} />}
        </button>
      </div>
    </div>
  );
}

// ─── ModalUsuario ─────────────────────────────────────────────────────────────

function ModalUsuario({ open, onClose, editando, sucursales, onGuardar, cargando, error }) {
  const [form, setForm] = useState(() =>
    editando
      ? {
          nombre:                      editando.nombre      || '',
          email:                       editando.email       || '',
          password:                    '',
          rol:                         editando.rol         || 'vendedor',
          sucursal_id:                 editando.sucursal_id ?? '',
          modulos_permitidos:          editando.modulos_permitidos          ?? null,
          permisos_proveedores:        editando.permisos_proveedores        ?? null,
          permisos_edicion_productos:  editando.permisos_edicion_productos  ?? null,
        }
      : FORM_INICIAL
  );

  const set = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));

  const requiereSucursal = form.rol !== 'admin_negocio';

  // Módulos efectivos del usuario (para saber si proveedores está habilitado)
  const modulosEfectivos = form.rol === 'admin_negocio'
    ? null
    : (form.modulos_permitidos ?? PERMISOS_BASE[form.rol] ?? []);
  const tieneModuloProveedores  = modulosEfectivos === null || modulosEfectivos.includes('proveedores');
  const tieneModuloInventario   = modulosEfectivos === null || modulosEfectivos.includes('inventario');
  const mostrarPermProv   = form.rol !== 'admin_negocio' && tieneModuloProveedores;
  const mostrarPermEditar = form.rol !== 'admin_negocio' && tieneModuloInventario;

  // Lista de proveedores para el selector "ver solo algunos"
  const { data: proveedoresLista = [] } = useQuery({
    queryKey:  ['proveedores-selector'],
    queryFn:   fetchProveedores,
    enabled:   mostrarPermProv,
    staleTime: 60_000,
  });

  // Cuando cambia el rol: resetear módulos Y permisos de proveedores
  const handleRolChange = (nuevoRol) => {
    setForm((f) => ({
      ...f,
      rol:                  nuevoRol,
      modulos_permitidos:   null,
      permisos_proveedores: null,
    }));
  };

  // Cuando se desactiva un módulo: limpiar sus permisos asociados
  const handleModulosChange = (modulos) => {
    const tieneProveedores = modulos === null || modulos.includes('proveedores');
    const tieneInv         = modulos === null || modulos.includes('inventario');
    set('modulos_permitidos', modulos);
    if (!tieneProveedores) set('permisos_proveedores', null);
    if (!tieneInv)         set('permisos_edicion_productos', null);
  };

  const handleGuardar = () => {
    const payload = { ...form };
    if (!payload.password) delete payload.password;
    if (!requiereSucursal) payload.sucursal_id = null;
    if (payload.rol === 'admin_negocio') {
      payload.permisos_proveedores       = null;
      payload.permisos_edicion_productos = null;
    }
    onGuardar(payload);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editando ? 'Editar usuario' : 'Nuevo usuario'}
      size="md"
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Nombre"
          placeholder="Juan Pérez"
          value={form.nombre}
          onChange={(e) => set('nombre', e.target.value)}
        />
        <Input
          label="Email"
          type="email"
          placeholder="juan@ejemplo.com"
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
        />
        <Input
          label={editando
            ? 'Nueva contraseña (dejar vacío para no cambiar)'
            : 'Contraseña inicial'}
          type="password"
          placeholder="••••••••"
          value={form.password}
          onChange={(e) => set('password', e.target.value)}
        />

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Rol</label>
          <select
            value={form.rol}
            onChange={(e) => handleRolChange(e.target.value)}
            className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm
              text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500
              focus:bg-white transition-all"
          >
            {ROLES.map((r) => {
              const rVal   = r.value;
              const rLabel = r.label;
              return <option key={rVal} value={rVal}>{rLabel}</option>;
            })}
          </select>
        </div>

        {requiereSucursal && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Sucursal asignada</label>
            <select
              value={form.sucursal_id}
              onChange={(e) => set('sucursal_id', e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-sm
                text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500
                focus:bg-white transition-all"
            >
              <option value="">Selecciona una sucursal</option>
              {sucursales.map((s) => {
                const sId     = s.id;
                const sNombre = s.nombre;
                return <option key={sId} value={sId}>{sNombre}</option>;
              })}
            </select>
          </div>
        )}

        {/* Selector de módulos */}
        <SelectorModulos
          rol={form.rol}
          modulosPermitidos={form.modulos_permitidos}
          onChange={handleModulosChange}
        />

        {/* Permisos granulares de proveedores (solo si el módulo está activo) */}
        {mostrarPermProv && (
          <SelectorPermisosProveedores
            permisos={form.permisos_proveedores}
            onChange={(p) => set('permisos_proveedores', p)}
            proveedores={proveedoresLista}
          />
        )}

        {/* Permisos de edición de productos (solo si el módulo inventario está activo) */}
        {mostrarPermEditar && (
          <SelectorPermisosEdicionProductos
            permisos={form.permisos_edicion_productos}
            onChange={(p) => set('permisos_edicion_productos', p)}
          />
        )}

        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button className="flex-1" loading={cargando} onClick={handleGuardar}>
            {editando ? 'Guardar cambios' : 'Crear usuario'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function UsuariosConfig() {
  const { esAdminNegocio } = useAuth();
  const queryClient        = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editando,  setEditando]  = useState(null);
  const [error,     setError]     = useState('');

  const { data: usuarios   = [] } = useQuery({ queryKey: ['usuarios'],   queryFn: fetchUsuarios });
  const { data: sucursales = [] } = useQuery({ queryKey: ['sucursales'], queryFn: fetchSucursales });

  const mutCrear = useMutation({
    mutationFn: (payload) => api.post('/usuarios', payload),
    onSuccess:  () => { queryClient.invalidateQueries({ queryKey: ['usuarios'] }); cerrarModal(); },
    onError:    (e) => setError(e.response?.data?.error || 'Error al crear usuario'),
  });

  const mutEditar = useMutation({
    mutationFn: (payload) => api.put(`/usuarios/${editando.id}`, payload),
    onSuccess:  () => { queryClient.invalidateQueries({ queryKey: ['usuarios'] }); cerrarModal(); },
    onError:    (e) => setError(e.response?.data?.error || 'Error al actualizar usuario'),
  });

  const mutToggleActivo = useMutation({
    mutationFn: (usuario) => api.put(`/usuarios/${usuario.id}`, {
      nombre:                      usuario.nombre,
      email:                       usuario.email,
      rol:                         usuario.rol,
      sucursal_id:                 usuario.sucursal_id,
      modulos_permitidos:          usuario.modulos_permitidos,
      permisos_proveedores:        usuario.permisos_proveedores,
      permisos_edicion_productos:  usuario.permisos_edicion_productos,
      activo:                      !usuario.activo,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['usuarios'] }),
  });

  const abrirNuevo  = () => { setEditando(null); setError(''); setModalOpen(true); };
  const abrirEditar = (usuario) => { setEditando(usuario); setError(''); setModalOpen(true); };
  const cerrarModal = () => { setModalOpen(false); setEditando(null); setError(''); };

  const handleGuardar = (payload) => {
    setError('');
    if (!payload.nombre?.trim()) return setError('El nombre es requerido');
    if (!payload.email?.trim())  return setError('El email es requerido');
    if (!editando && !payload.password?.trim()) return setError('La contraseña es requerida');
    if (payload.rol !== 'admin_negocio' && !payload.sucursal_id) {
      return setError('Debes asignar una sucursal');
    }
    editando ? mutEditar.mutate(payload) : mutCrear.mutate(payload);
  };

  if (!esAdminNegocio()) return null;

  const activos   = usuarios.filter((u) => u.activo);
  const inactivos = usuarios.filter((u) => !u.activo);

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Usuarios</h2>
          <Badge variant="gray">{activos.length} activos</Badge>
        </div>
        <button
          onClick={abrirNuevo}
          className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center
            hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} className="text-white" />
        </button>
      </div>

      {usuarios.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-gray-400">
          <Users size={32} className="text-gray-200" />
          <p className="text-sm">Sin usuarios registrados</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {activos.map((u) => (
            <FilaUsuario key={u.id} usuario={u}
              onEditar={abrirEditar}
              onToggleActivo={(usr) => mutToggleActivo.mutate(usr)} />
          ))}
          {inactivos.length > 0 && (
            <>
              <p className="text-xs text-gray-400 mt-2 px-1">Inactivos</p>
              {inactivos.map((u) => (
                <FilaUsuario key={u.id} usuario={u}
                  onEditar={abrirEditar}
                  onToggleActivo={(usr) => mutToggleActivo.mutate(usr)} />
              ))}
            </>
          )}
        </div>
      )}

      <ModalUsuario
        key={editando?.id ?? 'nuevo'}
        open={modalOpen}
        onClose={cerrarModal}
        editando={editando}
        sucursales={sucursales}
        onGuardar={handleGuardar}
        cargando={mutCrear.isPending || mutEditar.isPending}
        error={error}
      />
    </div>
  );
}
