import { Bell, BellOff, Smartphone, Send, ShieldAlert, Info, Check } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { usePush } from '../../hooks/usePush';

// ─────────────────────────────────────────────────────────────────────────────
// AVISOS — activación de las notificaciones push en ESTE dispositivo.
//
// Es por dispositivo, no por cuenta: el celular del dueño y el computador del
// local se activan por separado y cada uno se puede apagar sin tocar el otro.
//
// Todo el conocimiento de navegador (permisos, service worker, suscripción)
// vive en `usePush`; aquí solo se pinta el estado que ese hook resuelve.
// ─────────────────────────────────────────────────────────────────────────────

const CAJA = 'rounded-2xl border p-4 flex flex-col gap-3';

/** Explicación de por qué no se puede activar, según el caso. */
function Bloqueo({ estado, esIOS }) {
  if (estado === 'ios-sin-instalar') {
    return (
      <div className={`${CAJA} bg-amber-50 border-amber-200`}>
        <div className="flex items-center gap-2">
          <Smartphone size={16} className="text-amber-500 flex-shrink-0" />
          <span className="text-sm font-semibold text-amber-800">
            Instala la app para recibir avisos
          </span>
        </div>
        <p className="text-xs text-amber-700 leading-relaxed">
          En iPhone y iPad las notificaciones solo funcionan con la app agregada a la
          pantalla de inicio. Ábrela en Safari, toca el botón de <strong>Compartir</strong>,
          elige <strong>“Agregar a inicio”</strong> y vuelve a entrar desde ese ícono.
          Aquí mismo aparecerá el botón para activarlas.
        </p>
      </div>
    );
  }

  if (estado === 'no-soportado') {
    return (
      <div className={`${CAJA} bg-gray-50 border-gray-200`}>
        <div className="flex items-center gap-2">
          <BellOff size={16} className="text-gray-400 flex-shrink-0" />
          <span className="text-sm font-semibold text-gray-700">
            Este navegador no admite notificaciones
          </span>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">
          {esIOS
            ? 'Prueba abriendo la app desde el ícono que agregaste a la pantalla de inicio.'
            : 'Usa Chrome, Edge o Firefox actualizados. En una ventana de incógnito tampoco funcionan.'}
        </p>
      </div>
    );
  }

  if (estado === 'servidor-apagado') {
    return (
      <div className={`${CAJA} bg-gray-50 border-gray-200`}>
        <div className="flex items-center gap-2">
          <ShieldAlert size={16} className="text-gray-400 flex-shrink-0" />
          <span className="text-sm font-semibold text-gray-700">
            Las notificaciones no están habilitadas en el servidor
          </span>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">
          Falta configurar las claves de envío (VAPID). Cuando estén puestas, este
          botón se activa solo.
        </p>
      </div>
    );
  }

  if (estado === 'bloqueado') {
    return (
      <div className={`${CAJA} bg-red-50 border-red-200`}>
        <div className="flex items-center gap-2">
          <ShieldAlert size={16} className="text-red-500 flex-shrink-0" />
          <span className="text-sm font-semibold text-red-700">
            Bloqueaste las notificaciones en este navegador
          </span>
        </div>
        <p className="text-xs text-red-600 leading-relaxed">
          El sistema ya no puede volver a preguntarte: hay que habilitarlas a mano.
          Toca el candado 🔒 junto a la dirección del sitio → Permisos → Notificaciones
          → Permitir, y recarga la página.
        </p>
      </div>
    );
  }

  return null;
}

export function NotificacionesConfig() {
  const {
    estado, ocupado, error, aviso, dispositivos, esIOS,
    activar, desactivar, probar,
  } = usePush();

  const puedeActivar = estado === 'inactivo';
  const estaActivo   = estado === 'activo';

  return (
    <div className="flex flex-col gap-4">

      {/* Encabezado */}
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
          <Bell size={17} className="text-blue-600" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-gray-900">Avisos en el celular</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Recibe alertas del sistema aunque tengas la app cerrada.
          </p>
        </div>
      </div>

      <Bloqueo estado={estado} esIOS={esIOS} />

      {/* Activar / desactivar */}
      {(puedeActivar || estaActivo) && (
        <div className={`${CAJA} ${estaActivo ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-200'}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              {estaActivo
                ? <Check size={16} className="text-emerald-600 flex-shrink-0" />
                : <Bell  size={16} className="text-gray-400 flex-shrink-0" />}
              <span className={`text-sm font-semibold truncate
                ${estaActivo ? 'text-emerald-800' : 'text-gray-700'}`}>
                {estaActivo
                  ? 'Este dispositivo recibe notificaciones'
                  : 'Este dispositivo no recibe notificaciones'}
              </span>
            </div>
          </div>

          <p className="text-xs text-gray-500 leading-relaxed">
            {estaActivo
              ? 'Se activa por dispositivo: tu celular y el computador del local se manejan por separado.'
              : 'Al activar, el navegador te va a pedir permiso. Hay que aceptarlo.'}
          </p>

          <div className="flex flex-wrap gap-2">
            {puedeActivar && (
              <Button size="sm" loading={ocupado} onClick={activar}>
                <Bell size={14} /> Activar en este dispositivo
              </Button>
            )}
            {estaActivo && (
              <>
                <Button size="sm" variant="secondary" loading={ocupado} onClick={probar}>
                  <Send size={14} /> Enviar una de prueba
                </Button>
                <Button size="sm" variant="secondary" loading={ocupado} onClick={desactivar}>
                  <BellOff size={14} /> Desactivar aquí
                </Button>
              </>
            )}
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
          {aviso && <p className="text-xs text-emerald-600">{aviso}</p>}
        </div>
      )}

      {/* Dispositivos ya registrados por este usuario */}
      {dispositivos.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-gray-500">
            Tus dispositivos activos ({dispositivos.length})
          </span>
          <div className="flex flex-col gap-1.5">
            {dispositivos.map((d) => (
              <div key={d.id}
                className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                <Smartphone size={13} className="text-gray-400 flex-shrink-0" />
                <span className="text-xs text-gray-600 truncate flex-1 min-w-0">
                  {resumirDispositivo(d.user_agent)}
                </span>
                <span className="text-[10px] text-gray-400 flex-shrink-0">
                  ···{d.endpoint_fin}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Qué se va a notificar */}
      <div className="flex gap-2.5 bg-blue-50 border border-blue-100 rounded-xl p-3">
        <Info size={14} className="text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-700 leading-relaxed">
          <p className="font-medium">Por ahora esto es la base del sistema de avisos.</p>
          <p className="mt-1">
            Con las notificaciones activadas ya puedes recibir la de prueba. Los avisos
            automáticos (cartera vencida, vencimiento del plan, stock agotado) se irán
            conectando encima de esto.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Nombre legible del navegador/equipo a partir del user-agent. */
function resumirDispositivo(ua) {
  if (!ua) return 'Dispositivo';
  const sistema =
    /iPhone|iPad|iPod/i.test(ua) ? 'iPhone/iPad'
    : /Android/i.test(ua)        ? 'Android'
    : /Windows/i.test(ua)        ? 'Windows'
    : /Macintosh/i.test(ua)      ? 'Mac'
    : /Linux/i.test(ua)          ? 'Linux'
    : 'Dispositivo';
  const navegador =
    /Edg\//i.test(ua)     ? 'Edge'
    : /OPR\//i.test(ua)   ? 'Opera'
    : /Chrome\//i.test(ua)? 'Chrome'
    : /Firefox\//i.test(ua) ? 'Firefox'
    : /Safari\//i.test(ua)  ? 'Safari'
    : '';
  return navegador ? `${sistema} · ${navegador}` : sistema;
}

export default NotificacionesConfig;
