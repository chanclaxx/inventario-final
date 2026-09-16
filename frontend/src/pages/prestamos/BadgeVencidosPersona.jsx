import { AlertTriangle } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Cuántos cobros VENCIDOS tiene una persona, en su tarjeta de la lista.
//
// Lo comparten Préstamos (compañeros y clientes) y Créditos. «Vencido» es la
// regla del aviso de cobros de las 8:00 (`notificaciones.alertas.cartera`):
// activo y con la fecha límite ya pasada. Si la tarjeta contara distinto, el
// aviso diría «3 cobros vencidos» y la lista mostraría otra cosa.
//
// Solo el conteo y el atraso del más viejo: la mora y el interés los calcula
// el backend al abrir la ficha, y una cifra en plata calculada aquí no daría la
// misma que ve el usuario adentro.
// ─────────────────────────────────────────────────────────────────────────────
export function BadgeVencidosPersona({ cuantos, diasMax, etiqueta = 'vencido', etiquetaPlural = 'vencidos' }) {
  const n = Number(cuantos || 0);
  if (n <= 0) return null;
  const dias = Number(diasMax || 0);
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full
      bg-red-600 text-white whitespace-nowrap">
      <AlertTriangle size={11} className="flex-shrink-0" />
      {n} {n === 1 ? etiqueta : etiquetaPlural}
      {dias > 0 && (
        <span className="font-normal opacity-90">
          · {n === 1 ? 'hace' : 'el más viejo hace'} {dias} día{dias === 1 ? '' : 's'}
        </span>
      )}
    </span>
  );
}
