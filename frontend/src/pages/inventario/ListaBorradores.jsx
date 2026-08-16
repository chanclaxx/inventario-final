import { useState } from 'react';
import {
  Bookmark, ChevronDown, ChevronRight, Trash2, FileText, Handshake,
  HelpCircle, AlertTriangle, Clock, ShoppingCart, X,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { formatCOP } from '../../utils/formatters';
import useCarritoStore from '../../store/carritoStore';
import { useBorradores, cargarBorrador, renovarBorrador } from '../../hooks/useBorradores';

// ─────────────────────────────────────────────────────────────────────────────
// Lista de borradores, debajo del carrito.
//
// Cargar un borrador lo COPIA al carrito: el borrador sobrevive y sigue
// reservando su mercancía hasta que la venta se concrete. Así, cerrar el
// navegador o cambiar de sucursal —que vacían el carrito— no lo pierden.
// ─────────────────────────────────────────────────────────────────────────────

const DESTINO_CHIP = {
  factura:    { label: 'Factura',  icon: FileText,   clase: 'bg-blue-50 text-blue-600 border-blue-100' },
  prestamo:   { label: 'Préstamo', icon: Handshake,  clase: 'bg-purple-50 text-purple-600 border-purple-100' },
  indefinido: { label: 'Sin definir', icon: HelpCircle, clase: 'bg-gray-100 text-gray-500 border-gray-200' },
};

// Antigüedad en lenguaje de mostrador. No merece un util compartido: solo se
// usa aquí y la precisión que hace falta es "¿esto es de hoy o de la semana
// pasada?".
const hace = (iso) => {
  if (!iso) return '';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1)  return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
};

// El aviso de vencimiento solo aparece cuando ya importa: faltando dos días o
// menos. Mostrarlo desde el día uno lo volvería parte del decorado.
const avisoVencimiento = (dias) => {
  if (dias == null || dias > 2) return null;
  if (dias <= 0) return 'vence hoy';
  return dias === 1 ? 'vence mañana' : `vence en ${dias} días`;
};

function TarjetaBorrador({
  borrador, onCargar, onDescartar, cargando, descartando,
  // Este borrador es el que está ahora mismo en el carrito. No se vuelve a
  // cargar: ya está ahí, y volver a traerlo pisaría los cambios que el vendedor
  // le haya hecho (un precio ajustado, un producto agregado).
  enCarrito,
  // Hay OTRA carga en curso. Se bloquean todas para que dos clics rápidos en
  // tarjetas distintas no dejen el carrito con la que respondió de última.
  bloqueado,
}) {
  const [abierto, setAbierto] = useState(false);
  const chip = DESTINO_CHIP[borrador.destino] || DESTINO_CHIP.indefinido;
  const ChipIcon = chip.icon;
  const vence = avisoVencimiento(borrador.dias_para_vencer);

  return (
    <div className={`rounded-xl overflow-hidden border transition-colors
      ${enCarrito ? 'bg-blue-50/40 border-blue-300 ring-1 ring-blue-200' : 'bg-white border-gray-200'}`}>
      {/* Cabecera: pulsable para desplegar los productos */}
      <button
        onClick={() => setAbierto((v) => !v)}
        className="w-full flex items-start gap-2 p-3 text-left hover:bg-gray-50 transition-colors"
      >
        {abierto
          ? <ChevronDown  size={14} className="text-gray-400 flex-shrink-0 mt-0.5" />
          : <ChevronRight size={14} className="text-gray-400 flex-shrink-0 mt-0.5" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium text-gray-800 truncate">{borrador.titulo}</span>
            <span className={`inline-flex items-center gap-1 text-[10px] font-medium
              px-1.5 py-0.5 rounded-full border ${chip.clase}`}>
              <ChipIcon size={9} /> {chip.label}
            </span>
            {enCarrito && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium
                px-1.5 py-0.5 rounded-full border bg-blue-100 text-blue-700 border-blue-200">
                <ShoppingCart size={9} /> En el carrito
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {borrador.num_items} producto{borrador.num_items !== 1 ? 's' : ''}
            {' · '}
            <span className="font-semibold text-gray-700">{formatCOP(borrador.total)}</span>
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1 flex-wrap">
            {borrador.usuario_nombre && <span>{borrador.usuario_nombre} ·</span>}
            <span>{hace(borrador.creado_en)}</span>
            {vence && (
              <span className="inline-flex items-center gap-0.5 text-amber-600 font-medium">
                <Clock size={9} /> {vence}
              </span>
            )}
          </p>
        </div>
      </button>

      {/* Productos del borrador */}
      {abierto && (
        <div className="px-3 pb-2 flex flex-col gap-1 border-t border-gray-100 pt-2">
          {(borrador.items || []).map((i) => (
            <div key={i.id} className="flex items-start justify-between gap-2 text-xs">
              <div className="min-w-0 flex-1">
                <span className="text-gray-600">
                  {i.cantidad > 1 && <span className="text-gray-400">{i.cantidad}× </span>}
                  {i.nombre}
                </span>
                {i.imei && (
                  <span className="block font-mono text-[10px] text-gray-400">{i.imei}</span>
                )}
                {(i.atributo_label || i.variante_label) && (
                  <span className="block text-[10px] text-gray-400">
                    {[i.atributo_label, i.variante_label].filter(Boolean).join(' / ')}
                  </span>
                )}
              </div>
              <span className="text-gray-500 flex-shrink-0">
                {formatCOP(Number(i.precio_final) * (Number(i.cantidad) || 1))}
              </span>
            </div>
          ))}
          {borrador.nota && (
            <p className="text-[11px] text-gray-400 italic mt-1 pt-1 border-t border-gray-50">
              {borrador.nota}
            </p>
          )}
        </div>
      )}

      {/* Acciones */}
      <div className={`flex items-center gap-2 px-3 py-2 border-t
        ${enCarrito ? 'bg-blue-50/60 border-blue-100' : 'bg-gray-50 border-gray-100'}`}>
        {enCarrito ? (
          // Ya está cargado: el botón lleva a terminar la venta, no a volver a
          // traerlo. Recargarlo borraría lo que el vendedor haya ajustado.
          <Button size="sm" className="flex-1" onClick={() => onCargar(borrador)}>
            {borrador.destino === 'prestamo' ? <Handshake size={13} /> : <FileText size={13} />}
            {borrador.destino === 'prestamo' ? 'Continuar préstamo' : 'Continuar factura'}
          </Button>
        ) : (
          <Button size="sm" className="flex-1" onClick={() => onCargar(borrador)}
            loading={cargando} disabled={bloqueado}>
            <ShoppingCart size={13} /> Cargar al carrito
          </Button>
        )}
        <button
          onClick={() => onDescartar(borrador)}
          disabled={descartando}
          title="Descartar borrador"
          className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50
            transition-colors disabled:opacity-40"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

export function ListaBorradores({ onCargado }) {
  const { activo, borradores, isLoading, descartar } = useBorradores();
  const items               = useCarritoStore((s) => s.items);
  const borradorOrigenId    = useCarritoStore((s) => s.borradorOrigenId);
  const cargarDesdeBorrador = useCarritoStore((s) => s.cargarDesdeBorrador);

  const [abierta,       setAbierta]       = useState(true);
  const [cargandoId,    setCargandoId]    = useState(null);
  const [confirmando,   setConfirmando]   = useState(null); // borrador pendiente de reemplazar el carrito
  const [aDescartar,    setADescartar]    = useState(null);
  const [noDisponibles, setNoDisponibles] = useState(null); // { titulo, lista[] }
  const [error,         setError]         = useState('');

  // Apagada la feature no se renderiza nada: el carrito queda como estaba.
  if (!activo) return null;

  const ejecutarCarga = async (borrador) => {
    // Cierra la puerta a la segunda pulsación: el botón de confirmar puede
    // recibir dos clics antes de que el diálogo desaparezca.
    if (cargandoId) return;
    setConfirmando(null);
    setError('');
    setCargandoId(borrador.id);
    try {
      const { items: nuevos, noDisponibles: fuera } = await cargarBorrador(borrador.id);

      if (!nuevos.length) {
        setNoDisponibles({ titulo: borrador.titulo, lista: fuera, vacio: true });
        return;
      }

      cargarDesdeBorrador(nuevos, borrador.id, borrador.datos || null);
      // El borrador que se sigue trabajando no debería vencerse por el camino.
      // Si falla, da igual: es una comodidad, no parte de la carga.
      renovarBorrador(borrador.id).catch(() => {});

      // Sin ítems fuera se abre de una el modal que corresponde; con ítems
      // fuera, primero el aviso — abrir un modal encima de otro escondería lo
      // que ya no se puede vender.
      if (fuera.length) setNoDisponibles({ titulo: borrador.titulo, lista: fuera, borrador });
      else onCargado?.(borrador);
    } catch (e) {
      setError(e.response?.data?.error || 'No se pudo cargar el borrador');
    } finally {
      setCargandoId(null);
    }
  };

  // Cargar reemplaza el carrito. Si hay algo dentro, se avisa antes: perder un
  // carrito a medio armar sin preguntar es de las cosas que hacen que la gente
  // deje de usar una feature.
  //
  // Tres casos, y la diferencia importa para que no estorbe:
  //
  //   1. Ya es el borrador del carrito → NO se recarga. Se abre el modal para
  //      terminar la venta. Volver a traerlo pisaría el precio que el vendedor
  //      acaba de ajustar, y preguntarle "¿reemplazo el carrito?" por su propio
  //      borrador es ruido.
  //   2. El carrito tiene otra cosa → se pregunta antes de pisarla.
  //   3. Carrito vacío → se carga directo.
  const handleCargar = (borrador) => {
    if (borradorOrigenId === borrador.id) { onCargado?.(borrador); return; }
    if (cargandoId) return;                       // ya hay una carga en vuelo
    if (items.length > 0) setConfirmando(borrador);
    else ejecutarCarga(borrador);
  };

  const handleDescartar = (borrador) => setADescartar(borrador);

  const confirmarDescarte = () => {
    descartar.mutate(aDescartar.id, {
      onSuccess: () => setADescartar(null),
      onError:   (e) => setError(e.response?.data?.error || 'No se pudo descartar'),
    });
  };

  if (isLoading) {
    return (
      <div className="border-t border-gray-100 mt-4 pt-4 flex justify-center">
        <Spinner />
      </div>
    );
  }

  // Sin borradores no se ocupa espacio: el carrito se ve igual que siempre.
  if (!borradores.length && !error) return null;

  // El que está en el carrito va primero: es sobre el que el vendedor está
  // trabajando ahora mismo.
  const ordenados = borradorOrigenId
    ? [...borradores].sort((a, b) =>
        (b.id === borradorOrigenId ? 1 : 0) - (a.id === borradorOrigenId ? 1 : 0))
    : borradores;

  return (
    <div className="border-t border-gray-100 mt-4 pt-3">
      <button
        onClick={() => setAbierta((v) => !v)}
        className="w-full flex items-center justify-between mb-2 group"
      >
        <div className="flex items-center gap-2">
          <Bookmark size={15} className="text-amber-500" />
          <span className="text-sm font-semibold text-gray-800">Borradores</span>
          <span className="bg-amber-100 text-amber-700 text-xs font-medium px-2 py-0.5 rounded-full">
            {borradores.length}
          </span>
        </div>
        {abierta
          ? <ChevronDown  size={15} className="text-gray-400 group-hover:text-gray-600" />
          : <ChevronRight size={15} className="text-gray-400 group-hover:text-gray-600" />}
      </button>

      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

      {abierta && (
        <div className="flex flex-col gap-2">
          {ordenados.map((b) => (
            <TarjetaBorrador
              key={b.id}
              borrador={b}
              enCarrito={borradorOrigenId === b.id}
              cargando={cargandoId === b.id}
              bloqueado={!!cargandoId && cargandoId !== b.id}
              descartando={descartar.isPending && aDescartar?.id === b.id}
              onCargar={handleCargar}
              onDescartar={handleDescartar}
            />
          ))}
        </div>
      )}

      {/* Confirmación: el carrito actual se va a reemplazar */}
      {confirmando && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setConfirmando(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full p-5 z-10">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={18} className="text-amber-600" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900">El carrito no está vacío</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Tiene {items.length} producto{items.length !== 1 ? 's' : ''} que se
                  reemplazarán por los de «{confirmando.titulo}».
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirmando(null)}>
                Cancelar
              </Button>
              <Button className="flex-1" onClick={() => ejecutarCarga(confirmando)}>
                Reemplazar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmación de descarte */}
      {aDescartar && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setADescartar(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full p-5 z-10">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <Trash2 size={17} className="text-red-500" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900">Descartar borrador</h3>
                <p className="text-sm text-gray-500 mt-1">
                  «{aDescartar.titulo}» se borrará y su mercancía dejará de estar apartada.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setADescartar(null)}>
                Cancelar
              </Button>
              <Button variant="danger" className="flex-1"
                loading={descartar.isPending} onClick={confirmarDescarte}>
                Descartar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Lo que ya no se puede vender del borrador cargado */}
      {noDisponibles && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setNoDisponibles(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full z-10
            max-h-[80vh] flex flex-col">
            <div className="flex items-start justify-between gap-2 p-5 pb-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center
                  justify-center flex-shrink-0">
                  <AlertTriangle size={18} className="text-amber-600" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-gray-900">
                    {noDisponibles.vacio
                      ? 'No queda nada por vender'
                      : 'Algunos productos ya no están'}
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {noDisponibles.vacio
                      ? `Todo lo de «${noDisponibles.titulo}» se vendió o se agotó.`
                      : 'El resto ya está en el carrito.'}
                  </p>
                </div>
              </div>
              <button onClick={() => setNoDisponibles(null)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 flex-shrink-0">
                <X size={16} />
              </button>
            </div>
            <div className="px-5 pb-4 overflow-y-auto flex flex-col gap-1.5">
              {noDisponibles.lista.map((i) => (
                <div key={i.id} className="flex items-start justify-between gap-2
                  bg-gray-50 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-700 truncate">{i.nombre}</p>
                    {i.imei && <p className="font-mono text-[10px] text-gray-400">{i.imei}</p>}
                  </div>
                  <span className="text-[11px] text-amber-700 bg-amber-50 border
                    border-amber-100 px-1.5 py-0.5 rounded-md flex-shrink-0">
                    {i.motivo}
                  </span>
                </div>
              ))}
            </div>
            <div className="p-5 pt-0">
              <Button className="w-full" onClick={() => {
                const b = noDisponibles.borrador;
                setNoDisponibles(null);
                if (b) onCargado?.(b);
              }}>
                Entendido
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
