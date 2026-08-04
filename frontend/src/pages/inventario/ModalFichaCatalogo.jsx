import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Upload, Trash2, Star, ImagePlus, AlertCircle, Loader2, X, Check,
} from 'lucide-react';
import { Modal }  from '../../components/ui/Modal';
import { Input }  from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { formatCOP } from '../../utils/formatters';
import { comprimirImagen, esImagenValida } from '../../utils/imagen';
import {
  getItemCatalogo, guardarItem, subirImagen, eliminarImagen, reordenarImagenes,
} from '../../api/catalogo.api';

// ─────────────────────────────────────────────────────────────────────────────
// Ficha comercial de un producto en la vitrina.
//
// TODO lo que se edita aquí vive en `catalogo_items` / `catalogo_imagenes`: el
// inventario no se modifica. Por eso la marca y la descripción de aquí no
// aparecen en la pantalla de inventario ni en las facturas — son datos de la
// vitrina y de nadie más.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_IMAGENES = 6;

function Toggle({ enabled, onChange, label, description }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className="flex items-center justify-between gap-4 w-full text-left"
      aria-pressed={enabled}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {description && <span className="text-xs text-gray-400">{description}</span>}
      </div>
      <span className={`flex-shrink-0 w-10 h-6 rounded-full transition-colors relative
        ${enabled ? 'bg-blue-600' : 'bg-gray-200'}`}>
        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all
          ${enabled ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

export function ModalFichaCatalogo({ producto, imagenesActivas, onClose }) {
  const queryClient = useQueryClient();

  // `item_id` es null mientras el producto nunca se haya tocado en la vitrina.
  // Las fotos necesitan una ficha existente, así que se habilitan tras guardar.
  const [itemId,   setItemId]   = useState(producto.item_id ?? null);
  const [error,    setError]    = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const inputArchivo            = useRef(null);

  // Las fotos se piden solo al abrir la ficha, no en la lista del inventario.
  const claveDetalle = ['catalogo-item', itemId];
  const { data: detalle } = useQuery({
    queryKey: claveDetalle,
    queryFn:  () => getItemCatalogo(itemId).then((r) => r.data.data),
    enabled:  Boolean(itemId),
  });

  // La caché de React Query es la única fuente de verdad de las imágenes: no se
  // duplica en un useState. Subir, borrar y reordenar escriben directo en ella,
  // así la galería se actualiza al instante sin esperar un refetch.
  const imagenes = detalle?.imagenes ?? [];

  const actualizarImagenes = (transformar) => {
    queryClient.setQueryData(claveDetalle, (prev) =>
      prev ? { ...prev, imagenes: transformar(prev.imagenes || []) } : prev);
  };

  // Los ids llegan como número desde el detalle (JSON_BUILD_OBJECT) y como
  // texto desde la subida (pg serializa BIGINT como string para no perder
  // precisión). Comparar siempre normalizado evita que borrar una foto recién
  // subida no encuentre su fila.
  const mismoId = (a, b) => Number(a) === Number(b);

  const [form, setForm] = useState({
    publicado:      Boolean(producto.publicado),
    titulo:         producto.titulo      ?? '',
    descripcion:    producto.descripcion ?? '',
    // En serial el inventario ya trae marca: se propone como valor inicial para
    // que el admin no la reescriba, pero se guarda en el catálogo.
    marca:          producto.marca ?? producto.marca_inventario ?? '',
    precio_publico: producto.precio_publico ?? '',
    mostrar_precio: producto.mostrar_precio ?? true,
    destacado:      Boolean(producto.destacado),
  });

  // Editar cualquier campo limpia el error anterior: si el usuario ya está
  // corrigiendo, el mensaje viejo solo estorba.
  const set = (clave, valor) => {
    setForm((f) => ({ ...f, [clave]: valor }));
    setError('');
  };

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ['catalogo-items'], exact: false });
  };

  const guardar = useMutation({
    mutationFn: () => guardarItem({
      tipo:           producto.tipo,
      producto_id:    producto.producto_id,
      publicado:      form.publicado,
      titulo:         form.titulo.trim()      || null,
      descripcion:    form.descripcion.trim() || null,
      marca:          form.marca.trim()       || null,
      precio_publico: form.precio_publico === '' ? null : Number(form.precio_publico),
      mostrar_precio: form.mostrar_precio,
      destacado:      form.destacado,
      orden:          producto.orden ?? 0,
    }),
    onSuccess: (res) => {
      setItemId(res.data.data.id);
      invalidar();
    },
    onError: (err) => setError(err?.response?.data?.error || 'No se pudo guardar la ficha'),
  });

  const borrar = useMutation({
    mutationFn: (imagenId) => eliminarImagen(imagenId),
    onSuccess: (_res, imagenId) => {
      actualizarImagenes((lista) => lista.filter((i) => !mismoId(i.id, imagenId)));
      invalidar();
    },
    onError: (err) => setError(err?.response?.data?.error || 'No se pudo eliminar la imagen'),
  });

  const reordenar = useMutation({
    mutationFn: (ids) => reordenarImagenes(itemId, ids),
    onSuccess: () => invalidar(),
  });

  // ── Subida ────────────────────────────────────────────────────────────────
  const onArchivos = async (event) => {
    const archivos = Array.from(event.target.files || []);
    event.target.value = '';   // permite volver a elegir el mismo archivo
    if (!archivos.length || !itemId) return;

    const cupo = MAX_IMAGENES - imagenes.length;
    if (cupo <= 0) {
      setError(`Máximo ${MAX_IMAGENES} imágenes por producto`);
      return;
    }

    setSubiendo(true);
    setError('');
    // Secuencial a propósito: en 4G, tres subidas en paralelo se estorban y
    // además el backend valida el cupo fila por fila.
    for (const archivo of archivos.slice(0, cupo)) {
      try {
        if (!esImagenValida(archivo)) {
          setError('Solo se aceptan imágenes JPG, PNG o WebP');
          continue;
        }
        const { blob, nombre } = await comprimirImagen(archivo);
        const res = await subirImagen(itemId, blob, nombre);
        actualizarImagenes((lista) => [...lista, res.data.data]);
      } catch (err) {
        setError(err?.response?.data?.error || err.message || 'No se pudo subir la imagen');
        break;
      }
    }
    setSubiendo(false);
    invalidar();
  };

  // La portada es simplemente la primera: se mueve al frente y se persiste el
  // orden completo, que es como lo espera el backend.
  const hacerPortada = (imagenId) => {
    const nueva = [
      ...imagenes.filter((i) =>  mismoId(i.id, imagenId)),
      ...imagenes.filter((i) => !mismoId(i.id, imagenId)),
    ];
    actualizarImagenes(() => nueva);
    reordenar.mutate(nueva.map((i) => i.id));
  };

  const precioInventario = producto.precio != null ? Number(producto.precio) : null;

  return (
    <Modal open onClose={onClose} title={producto.nombre} size="xl">
      <div className="flex flex-col gap-5">

        {/* ── Estado de publicación ── */}
        <div className={`rounded-2xl p-4 border transition-colors
          ${form.publicado ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
          <Toggle
            enabled={form.publicado}
            onChange={(v) => set('publicado', v)}
            label={form.publicado ? 'Visible en el catálogo' : 'Oculto del catálogo'}
            description={form.publicado
              ? 'Cualquiera con el enlace puede ver este producto'
              : 'Nadie lo ve, aunque la vitrina esté activa'}
          />
        </div>

        {/* ── Fotos ── */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">
              Fotos <span className="font-normal text-gray-400">({imagenes.length}/{MAX_IMAGENES})</span>
            </p>
            {itemId && imagenesActivas && imagenes.length < MAX_IMAGENES && (
              <Button size="sm" variant="secondary" onClick={() => inputArchivo.current?.click()}
                loading={subiendo} disabled={subiendo}>
                <Upload size={14} /> Agregar
              </Button>
            )}
          </div>

          <input
            ref={inputArchivo}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={onArchivos}
          />

          {!imagenesActivas ? (
            <p className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50
              border border-amber-200 rounded-xl px-3 py-2.5">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              El almacenamiento de imágenes no está configurado en el servidor. El
              producto se puede publicar igual, pero sin fotos.
            </p>
          ) : !itemId ? (
            <p className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50
              border border-gray-200 rounded-xl px-3 py-2.5">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              Guarda la ficha una vez y aquí aparecerá el botón para subir fotos.
            </p>
          ) : imagenes.length === 0 ? (
            <button
              type="button"
              onClick={() => inputArchivo.current?.click()}
              disabled={subiendo}
              className="flex flex-col items-center justify-center gap-2 py-8 rounded-2xl
                border-2 border-dashed border-gray-200 text-gray-400
                hover:border-blue-300 hover:text-blue-500 transition-colors"
            >
              {subiendo
                ? <Loader2 size={22} className="animate-spin" />
                : <ImagePlus size={22} />}
              <span className="text-xs font-medium">
                {subiendo ? 'Subiendo…' : 'Toca para agregar fotos'}
              </span>
            </button>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {imagenes.map((img, i) => (
                <div key={img.id} className="relative group aspect-square rounded-xl
                  overflow-hidden bg-gray-100 border border-gray-200">
                  <img src={img.url} alt={img.alt || producto.nombre}
                    className="w-full h-full object-cover" loading="lazy" />

                  {i === 0 && (
                    <span className="absolute top-1 left-1 flex items-center gap-0.5
                      bg-blue-600 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-md">
                      <Star size={9} fill="currentColor" /> Portada
                    </span>
                  )}

                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100
                    transition-opacity flex items-center justify-center gap-1">
                    {i !== 0 && (
                      <button type="button" onClick={() => hacerPortada(img.id)}
                        title="Usar como portada"
                        className="p-1.5 bg-white/90 rounded-lg text-gray-700 hover:text-blue-600">
                        <Star size={13} />
                      </button>
                    )}
                    <button type="button" onClick={() => borrar.mutate(img.id)}
                      title="Eliminar"
                      className="p-1.5 bg-white/90 rounded-lg text-gray-700 hover:text-red-600">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
              {subiendo && (
                <div className="aspect-square rounded-xl border-2 border-dashed
                  border-gray-200 flex items-center justify-center text-gray-300">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Datos comerciales ── */}
        <div className="flex flex-col gap-3">
          <Input
            label="Título en el catálogo"
            placeholder={producto.nombre}
            value={form.titulo}
            maxLength={120}
            onChange={(e) => set('titulo', e.target.value)}
          />
          <p className="-mt-2 text-xs text-gray-400">
            Déjalo vacío para usar el nombre del inventario.
          </p>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Descripción</label>
            <textarea
              rows={3}
              maxLength={2000}
              value={form.descripcion}
              onChange={(e) => set('descripcion', e.target.value)}
              placeholder="Qué incluye, para qué sirve, detalles que ayuden a decidir…"
              className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-gray-900
                placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500
                focus:bg-white transition-all duration-150 text-sm resize-none"
            />
          </div>

          <Input
            label="Marca"
            placeholder="Sin marca"
            value={form.marca}
            maxLength={60}
            onChange={(e) => set('marca', e.target.value)}
          />
        </div>

        {/* ── Precio ── */}
        <div className="flex flex-col gap-3 bg-gray-50 rounded-2xl p-4 border border-gray-100">
          <Toggle
            enabled={form.mostrar_precio}
            onChange={(v) => set('mostrar_precio', v)}
            label="Mostrar el precio"
            description="Apágalo para que diga solo “Consultar precio”"
          />

          {form.mostrar_precio && (
            <>
              <Input
                label="Precio en el catálogo"
                type="number"
                min="0"
                placeholder={precioInventario != null ? String(precioInventario) : 'Sin precio'}
                value={form.precio_publico}
                onChange={(e) => set('precio_publico', e.target.value)}
              />
              <p className="-mt-1 text-xs text-gray-400">
                {precioInventario != null
                  ? <>Vacío = usar el del inventario ({formatCOP(precioInventario)}).</>
                  : <>Este producto no tiene precio en el inventario. Si lo dejas vacío,
                     el catálogo lo mostrará como “Consultar precio”.</>}
              </p>
            </>
          )}
        </div>

        <Toggle
          enabled={form.destacado}
          onChange={(v) => set('destacado', v)}
          label="Destacado"
          description="Aparece de primero en el catálogo"
        />

        {error && (
          <p className="flex items-start gap-2 text-xs text-red-600 bg-red-50
            border border-red-200 rounded-xl px-3 py-2.5">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            {error}
          </p>
        )}

        {/* ── Acciones ── */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            <X size={15} /> Cerrar
          </Button>
          <Button onClick={() => guardar.mutate()} loading={guardar.isPending}>
            <Check size={15} /> Guardar
          </Button>
        </div>

        {guardar.isSuccess && !guardar.isPending && (
          <p className="text-xs text-green-600 text-right -mt-3">Ficha guardada</p>
        )}
      </div>
    </Modal>
  );
}
