import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Globe, Copy, Check, ExternalLink, AlertCircle, Save, MessageCircle,
  ToggleLeft, ToggleRight, Store,
} from 'lucide-react';
import { getVitrina, guardarVitrina } from '../../api/catalogo.api';
import { getSucursales } from '../../api/sucursales.api';
import { Input }   from '../../components/ui/Input';
import { Button }  from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import useSucursalStore from '../../store/sucursalStore';

// ─────────────────────────────────────────────────────────────────────────────
// CATÁLOGO WEB PÚBLICO — configuración de la vitrina de UNA sucursal.
//
// El catálogo es por sucursal: cada una tiene su propia dirección y publica sus
// propios productos. Esta pantalla configura la sucursal ACTIVA; para configurar
// otra se cambia de sucursal en la barra superior.
//
// Nada de lo que se guarda aquí toca el inventario: todo vive en la tabla
// `catalogo_sucursal`.
// ─────────────────────────────────────────────────────────────────────────────

const BASE_CATALOGO = import.meta.env.VITE_CATALOGO_URL || '';

const COLORES = [
  { id: '#2563eb', nombre: 'Azul'    },
  { id: '#059669', nombre: 'Verde'   },
  { id: '#7c3aed', nombre: 'Morado'  },
  { id: '#db2777', nombre: 'Rosa'    },
  { id: '#ea580c', nombre: 'Naranja' },
  { id: '#0f172a', nombre: 'Negro'   },
];

// Mismo slugify que el backend, para que la sugerencia coincida con lo que se
// va a validar del otro lado y el usuario no vea el campo rebotar.
const slugify = (texto) =>
  String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

function Toggle({ enabled, onChange, label, description }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {description && <span className="text-xs text-gray-400">{description}</span>}
      </div>
      <button type="button" onClick={() => onChange(!enabled)}
        className="flex-shrink-0 transition-colors" aria-pressed={enabled}>
        {enabled
          ? <ToggleRight size={28} className="text-blue-600" />
          : <ToggleLeft  size={28} className="text-gray-300" />}
      </button>
    </div>
  );
}

/**
 * Envoltura: remonta el formulario al cambiar de sucursal.
 *
 * Sin la `key`, los cambios sin guardar de una sucursal se arrastrarían a la
 * siguiente y el admin podría publicar la dirección equivocada.
 */
export function CatalogoWebConfig() {
  const sucursalActiva = useSucursalStore((s) => s.sucursalActiva);
  return <VitrinaForm key={sucursalActiva ?? 'sin-sucursal'} sucursalActiva={sucursalActiva} />;
}

function VitrinaForm({ sucursalActiva }) {
  const queryClient = useQueryClient();

  // `form` guarda SOLO lo que el usuario tocó; el resto se deriva de la BD.
  // Es el mismo patrón que usa ConfigPage (`{ ...config, ...form }`) y evita
  // sincronizar estado dentro de un efecto.
  const [form,    setForm]    = useState({});
  const [error,   setError]   = useState('');
  const [copiado, setCopiado] = useState(false);

  const { data: sucursales = [] } = useQuery({
    queryKey: ['sucursales'],
    queryFn:  () => getSucursales().then((r) => r.data.data),
  });

  const { data: res, isLoading } = useQuery({
    queryKey: ['catalogo-vitrina', 'config', sucursalActiva],
    queryFn:  () => getVitrina().then((r) => r.data),
    enabled:  Boolean(sucursalActiva),
    retry:    false,
  });

  const sucursal = sucursales.find((s) => s.id === sucursalActiva);

  // Sin vitrina en la BD se arma un borrador con la dirección sugerida a partir
  // del nombre de la sucursal. Nada se escribe hasta que el usuario guarde.
  const base = useMemo(() => {
    const v = res?.data;
    return {
      slug:                   v?.slug ?? slugify(sucursal?.nombre || ''),
      activo:                 v?.activo ?? false,
      titulo:                 v?.titulo ?? '',
      descripcion:            v?.descripcion ?? '',
      whatsapp:               v?.whatsapp ?? '',
      direccion:              v?.direccion ?? '',
      horario:                v?.horario ?? '',
      color_primario:         v?.color_primario ?? COLORES[0].id,
      mostrar_precios:        v?.mostrar_precios ?? true,
      mostrar_disponibilidad: v?.mostrar_disponibilidad ?? true,
      ocultar_agotados:       v?.ocultar_agotados ?? false,
    };
  }, [res, sucursal?.nombre]);

  const valores = { ...base, ...form };

  const guardar = useMutation({
    mutationFn: () => guardarVitrina(valores),
    onSuccess: () => {
      setError('');
      setForm({});   // lo guardado ya es la base: se sueltan los overrides
      queryClient.invalidateQueries({ queryKey: ['catalogo-vitrina'], exact: false });
    },
    onError: (err) => setError(err?.response?.data?.error || 'No se pudo guardar el catálogo'),
  });

  if (!sucursalActiva) {
    return (
      <div className="bg-white border border-gray-100 rounded-2xl p-6 text-center">
        <Store size={26} className="mx-auto text-gray-300 mb-2" />
        <p className="text-sm text-gray-500">
          Selecciona una sucursal en la barra superior para configurar su catálogo.
        </p>
      </div>
    );
  }

  if (isLoading) return <Spinner className="py-20" />;

  const set = (clave, valor) => setForm((f) => ({ ...f, [clave]: valor }));

  const url = BASE_CATALOGO && valores.slug
    ? `${BASE_CATALOGO.replace(/\/+$/, '')}/${valores.slug}`
    : null;

  const copiar = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch { /* sin portapapeles: el enlace se ve completo y se copia a mano */ }
  };

  return (
    <div className="flex flex-col gap-4">

      {/* ── Encabezado ── */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <Globe size={17} className="text-blue-600" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">
              Catálogo web de {sucursal?.nombre || 'esta sucursal'}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Una página pública con los productos que tú elijas, para compartir por
              WhatsApp. No vende ni cobra: es una vitrina.
            </p>
          </div>
        </div>

        <Toggle
          enabled={valores.activo}
          onChange={(v) => set('activo', v)}
          label="Catálogo activo"
          description={valores.activo
            ? 'La página está publicada y cualquiera con el enlace puede verla'
            : 'La página no existe para el público. Los productos publicados quedan guardados.'}
        />
      </div>

      {/* ── Dirección ── */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 flex flex-col gap-3">
        <h4 className="text-sm font-semibold text-gray-900">Dirección del catálogo</h4>

        <div className="flex items-center gap-2">
          {BASE_CATALOGO && (
            <span className="text-sm text-gray-400 font-mono whitespace-nowrap">
              {BASE_CATALOGO.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/
            </span>
          )}
          <div className="flex-1 min-w-0">
            <Input
              value={valores.slug}
              onChange={(e) => set('slug', slugify(e.target.value))}
              placeholder="mi-tienda"
              maxLength={50}
            />
          </div>
        </div>

        <p className="text-xs text-gray-400">
          Solo minúsculas, números y guiones. Es la parte del enlace que verá tu
          cliente, así que conviene que sea corta y fácil de leer.
        </p>

        {!BASE_CATALOGO && (
          <p className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50
            border border-amber-200 rounded-xl px-3 py-2.5">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            Falta configurar <span className="font-mono">VITE_CATALOGO_URL</span> en el
            frontend para poder mostrar el enlace completo.
          </p>
        )}

        {url && valores.activo && (
          <div className="flex items-center gap-2 px-3 py-2.5 bg-green-50
            border border-green-200 rounded-xl">
            <Globe size={14} className="text-green-600 flex-shrink-0" />
            <p className="flex-1 min-w-0 font-mono text-xs text-gray-700 truncate">{url}</p>
            <button onClick={copiar} title="Copiar enlace"
              className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-white">
              {copiado ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
            </button>
            <a href={url} target="_blank" rel="noopener noreferrer" title="Abrir"
              className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-white">
              <ExternalLink size={14} />
            </a>
          </div>
        )}
      </div>

      {/* ── Presentación ── */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 flex flex-col gap-3">
        <h4 className="text-sm font-semibold text-gray-900">Presentación</h4>

        <Input
          label="Título"
          placeholder={sucursal?.nombre || 'Nombre del negocio'}
          value={valores.titulo}
          maxLength={120}
          onChange={(e) => set('titulo', e.target.value)}
        />

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Descripción</label>
          <textarea
            rows={2}
            maxLength={2000}
            value={valores.descripcion}
            onChange={(e) => set('descripcion', e.target.value)}
            placeholder="Una frase corta sobre tu negocio"
            className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-gray-900
              placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500
              focus:bg-white transition-all duration-150 text-sm resize-none"
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <Input label="Dirección" placeholder="Calle 10 #4-32"
            value={valores.direccion} maxLength={200}
            onChange={(e) => set('direccion', e.target.value)} />
          <Input label="Horario" placeholder="Lun a Sáb, 9am - 7pm"
            value={valores.horario} maxLength={200}
            onChange={(e) => set('horario', e.target.value)} />
        </div>

        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <MessageCircle size={13} /> WhatsApp
          </label>
          <Input
            placeholder="3001234567"
            value={valores.whatsapp}
            onChange={(e) => set('whatsapp', e.target.value)}
          />
          <p className="text-xs text-gray-400">
            Aparece un botón para escribirte con el producto ya mencionado. Déjalo
            vacío para no mostrarlo.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">Color</label>
          <div className="flex gap-2">
            {COLORES.map((c) => (
              <button
                key={c.id}
                type="button"
                title={c.nombre}
                onClick={() => set('color_primario', c.id)}
                style={{ backgroundColor: c.id }}
                className={`w-8 h-8 rounded-xl transition-all
                  ${valores.color_primario === c.id
                    ? 'ring-2 ring-offset-2 ring-gray-400 scale-105'
                    : 'hover:scale-105'}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── Qué se muestra ── */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 flex flex-col gap-4">
        <h4 className="text-sm font-semibold text-gray-900">Qué se muestra</h4>

        <Toggle
          enabled={valores.mostrar_precios}
          onChange={(v) => set('mostrar_precios', v)}
          label="Mostrar precios"
          description="Si lo apagas, todos los productos dicen “Consultar precio”"
        />
        <Toggle
          enabled={valores.mostrar_disponibilidad}
          onChange={(v) => set('mostrar_disponibilidad', v)}
          label="Mostrar disponibilidad"
          description="Solo “Disponible” o “Agotado”. Nunca se publica la cantidad exacta."
        />
        <Toggle
          enabled={valores.ocultar_agotados}
          onChange={(v) => set('ocultar_agotados', v)}
          label="Ocultar los agotados"
          description="Los productos sin existencias desaparecen del catálogo"
        />

        <p className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50
          border border-gray-100 rounded-xl px-3 py-2.5">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5 text-gray-400" />
          El catálogo nunca publica costos, IMEI, proveedores, notas internas,
          ubicaciones ni la cantidad exacta en stock. Los productos se eligen uno
          por uno desde Inventario → Catálogo web.
        </p>
      </div>

      {error && (
        <p className="flex items-start gap-2 text-xs text-red-600 bg-red-50
          border border-red-200 rounded-xl px-3 py-2.5">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-3">
        {guardar.isSuccess && !guardar.isPending && (
          <span className="text-xs text-green-600">Guardado</span>
        )}
        <Button onClick={() => guardar.mutate()} loading={guardar.isPending}>
          <Save size={15} /> Guardar catálogo
        </Button>
      </div>
    </div>
  );
}
