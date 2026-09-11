import { mm } from './etiquetasUi';

// ─────────────────────────────────────────────────────────────────────────────
// DIAGRAMA DEL ROLLO O DE LA PLANCHA
//
// Se dibuja con la geometría que devuelve el backend en el plan
// (`layout.geometria`), que sale de las MISMAS funciones con las que se arma
// el PDF. No se calcula nada aquí: si el diagrama y el papel pudieran decir
// cosas distintas, el usuario se enteraría después de gastar el rollo.
//
// Existe porque medir un rollo de 3 columnas con cinco números sueltos no se
// entiende; viéndolo, sí: tres etiquetas, el hueco entre ellas, el ancho del
// rollo y la fila siguiente que viene detrás.
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  papel:   '#EEF2F7',
  borde:   '#94A3B8',
  etiqueta:'#FFFFFF',
  texto:   '#334155',
  acento:  '#2563EB',
  suave:   '#CBD5E1',
};

/** Línea de cota horizontal con su texto encima. */
function CotaH({ x1, x2, y, texto, t, sw }) {
  const tick = t * 0.45;
  return (
    <g stroke={C.acento} strokeWidth={sw} fill="none">
      <line x1={x1} y1={y} x2={x2} y2={y} />
      <line x1={x1} y1={y - tick} x2={x1} y2={y + tick} />
      <line x1={x2} y1={y - tick} x2={x2} y2={y + tick} />
      <text x={(x1 + x2) / 2} y={y - t * 0.35} fontSize={t} fill={C.acento} stroke="none" textAnchor="middle">{texto}</text>
    </g>
  );
}

/** Línea de cota vertical con su texto a la derecha. */
function CotaV({ x, y1, y2, texto, t, sw }) {
  const tick = t * 0.45;
  return (
    <g stroke={C.acento} strokeWidth={sw} fill="none">
      <line x1={x} y1={y1} x2={x} y2={y2} />
      <line x1={x - tick} y1={y1} x2={x + tick} y2={y1} />
      <line x1={x - tick} y1={y2} x2={x + tick} y2={y2} />
      <text x={x + t * 0.5} y={(y1 + y2) / 2 + t * 0.35} fontSize={t} fill={C.acento} stroke="none">{texto}</text>
    </g>
  );
}

export function DiagramaFormato({ geometria }) {
  if (!geometria?.celdas?.length) return null;

  const { pagina, etiqueta, celdas, medio, separacion } = geometria;
  const W = pagina.ancho;
  const esRollo = medio === 'rollo';

  // Tamaño de letra y de trazo en milímetros del dibujo: proporcionales al
  // ancho, para que se lean igual en un rollo de 50 mm y en una A4.
  const t  = Math.max(2.4, W * 0.032);
  const sw = Math.max(0.18, W * 0.0035);

  // En el rollo se dibuja además la FILA SIGUIENTE, con el hueco entre filas:
  // es lo que la impresora avanza y lo que más se mide mal.
  const gap = Number(separacion?.y) || 0;
  const incluida = !!geometria.rollo?.incluirSeparacion;
  const siguienteY = esRollo ? pagina.alto + (incluida ? 0 : gap) : 0;
  const altoDibujo = esRollo ? siguienteY + etiqueta.alto : pagina.alto;

  const margenArriba = esRollo ? t * 2.6 : t * 0.8;
  const margenDerecha = esRollo ? t * 4 : t * 0.8;
  const margenAbajo = esRollo ? t * 2.8 : t * 0.8;
  const vb = `${-t} ${-margenArriba} ${W + t + margenDerecha} ${altoDibujo + margenArriba + margenAbajo}`;

  const numerar = celdas.length <= 40;
  const primera = celdas[0];

  return (
    <svg viewBox={vb} className="w-full h-auto max-h-64" role="img"
      aria-label={`Diagrama: página de ${mm(W)} × ${mm(pagina.alto)} mm con ${celdas.length} etiquetas de ${mm(etiqueta.ancho)} × ${mm(etiqueta.alto)} mm`}>
      <defs>
        <pattern id="etq-rayas" width={t * 0.8} height={t * 0.8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2={t * 0.8} stroke={C.suave} strokeWidth={sw * 1.5} />
        </pattern>
      </defs>

      {/* El papel: el rollo (con la fila siguiente) o la hoja */}
      <rect x={0} y={esRollo ? -t * 0.6 : 0} width={W} height={esRollo ? altoDibujo + t * 1.2 : pagina.alto}
        rx={esRollo ? t * 0.4 : 0} fill={esRollo ? C.papel : '#FFFFFF'} stroke={C.borde} strokeWidth={sw} />

      {/* Una página del PDF = esta franja */}
      {esRollo && (
        <rect x={0} y={0} width={W} height={pagina.alto} fill="none"
          stroke={C.acento} strokeWidth={sw} strokeDasharray={`${t * 0.5} ${t * 0.35}`} />
      )}

      {celdas.map((c) => (
        <g key={c.indice}>
          <rect x={c.x} y={c.y} width={etiqueta.ancho} height={etiqueta.alto} rx={Math.min(1.5, etiqueta.alto * 0.08)}
            fill={c.saltada ? 'url(#etq-rayas)' : C.etiqueta} stroke={C.borde} strokeWidth={sw} />
          {numerar && (
            <text x={c.x + etiqueta.ancho / 2} y={c.y + etiqueta.alto / 2 + t * 0.35} fontSize={t}
              fill={c.saltada ? C.borde : C.texto} textAnchor="middle">{c.indice + 1}</text>
          )}
        </g>
      ))}

      {/* La fila siguiente del rollo, en gris */}
      {esRollo && celdas.filter((c) => c.y === primera.y).map((c) => (
        <rect key={`s${c.indice}`} x={c.x} y={siguienteY} width={etiqueta.ancho} height={etiqueta.alto}
          rx={Math.min(1.5, etiqueta.alto * 0.08)} fill={C.etiqueta} stroke={C.suave} strokeWidth={sw}
          strokeDasharray={`${t * 0.3} ${t * 0.3}`} />
      ))}

      {/* Cotas. Solo las grandes: los huecos de 2 mm no se leen dibujados a
          esta escala y van escritos debajo, en `LeyendaFormato`. */}
      {esRollo && (
        <>
          <CotaH x1={0} x2={W} y={-t * 1.4} t={t} sw={sw} texto={`${mm(W)} mm (rollo)`} />
          <CotaH x1={primera.x} x2={primera.x + etiqueta.ancho} y={altoDibujo + t * 1.8} t={t} sw={sw}
            texto={`${mm(etiqueta.ancho)}`} />
          <CotaV x={W + t * 0.8} y1={0} y2={etiqueta.alto} t={t} sw={sw} texto={mm(etiqueta.alto)} />
        </>
      )}
    </svg>
  );
}

/**
 * Las medidas que no se leen en el dibujo (huecos, márgenes), escritas. En una
 * A4 de 65 etiquetas, o en un hueco de 2 mm, una cota dibujada sale de dos
 * píxeles; en texto se lee siempre.
 */
export function LeyendaFormato({ geometria }) {
  if (!geometria) return null;
  const { etiqueta, columnas, filas, separacion, margen, medio, pagina } = geometria;
  const partes = [
    medio === 'rollo'
      ? `${columnas} ${columnas === 1 ? 'etiqueta' : 'etiquetas'} de ${mm(etiqueta.ancho)} × ${mm(etiqueta.alto)} mm por fila`
      : `${columnas * filas} etiquetas de ${mm(etiqueta.ancho)} × ${mm(etiqueta.alto)} mm (${columnas} × ${filas}) en ${mm(pagina.ancho)} × ${mm(pagina.alto)} mm`,
  ];
  if (columnas > 1) partes.push(`hueco entre columnas ${mm(separacion?.x || 0)} mm`);
  if (medio === 'rollo' || filas > 1) partes.push(`hueco entre filas ${mm(separacion?.y || 0)} mm`);
  partes.push(medio === 'rollo'
    ? `margen izquierdo ${mm(margen?.izquierda || 0)} mm`
    : `márgenes ${mm(margen?.arriba || 0)} mm arriba y ${mm(margen?.izquierda || 0)} mm a la izquierda`);
  return <>{partes.join(' · ')}</>;
}

export default DiagramaFormato;
