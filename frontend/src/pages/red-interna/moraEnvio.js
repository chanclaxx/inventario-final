import { useQuery } from '@tanstack/react-query';
import { getContextoRed } from '../../api/redInterna.api';
import { fechaLegible } from '../../utils/mora';
import { formatCOP } from '../../utils/formatters';

// ─────────────────────────────────────────────────────────────────────────────
// PLAZO DE PAGO DE LOS ENVÍOS — lógica de PRESENTACIÓN (sin componentes)
//
// Aquí NO se calcula la mora: llega calculada del backend en la clave `mora` de
// cada envío (el mismo motor de créditos). Esto solo lee la configuración para
// pintar el selector y traduce a palabras lo que ya viene resuelto. Va aparte
// de PlazoEnvio.jsx porque el fast refresh exige archivos de solo componentes.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Las condiciones de mora de la red. Salen del contexto de la red (la misma
 * consulta y la misma clave que el carrito), no de `/config`: así solo llegan
 * las que el backend considera válidas y con la migración instalada.
 */
export function useMoraRed() {
  const { data } = useQuery({
    queryKey: ['red-contexto'],
    queryFn:  () => getContextoRed().then((r) => r.data.data),
    retry:    false,
    staleTime: 5 * 60 * 1000,
  });
  const m = data?.mora;
  return {
    activa:       !!m?.activa,
    condiciones:  m?.condiciones || [],
    defaultId:    m?.default_id || null,
    plazoDefault: m?.plazo_default || null,
  };
}

/**
 * Lo que la bodega elige al despachar o al cambiar el plazo.
 *
 * `valor` es `{ condicion_id, plazo_dias }`, o `null` para «sin plazo».
 * Controlado desde afuera: el estado vive en quien lo usa (sin efectos que
 * sincronicen), y el valor inicial lo arma `plazoPorDefecto`.
 */
export const plazoPorDefecto = (mora) => {
  if (!mora?.activa) return null;
  const cond = mora.condiciones.find((c) => c.id === mora.defaultId);
  if (!cond || !mora.plazoDefault) return null;
  return { condicion_id: cond.id, plazo_dias: mora.plazoDefault };
};

/** ¿El valor elegido se puede mandar? Días enteros entre 1 y 365. */
export const plazoValido = (valor) =>
  !valor || (Number.isInteger(Number(valor.plazo_dias))
             && Number(valor.plazo_dias) >= 1 && Number(valor.plazo_dias) <= 365);

/**
 * Cómo se ve la mora de un envío en su tarjeta. `m` es `envio.mora` tal cual
 * lo manda el backend. Null cuando no hay nada que decir.
 */
export const estadoPlazo = (m, { enTransito = false } = {}) => {
  if (!m) return null;
  if (!m.aplica) {
    return enTransito && m.plazo_dias
      ? { tono: 'gris', texto: `Plazo: ${m.plazo_dias} días desde que se reciba` }
      : null;
  }
  if (m.en_mora && m.pendiente > 0) {
    return { tono: 'rojo', texto: `Vencido hace ${m.dias_vencidos} día(s) · mora ${formatCOP(m.pendiente)}` };
  }
  if (m.en_mora) {
    return { tono: 'rojo', texto: `Vencido hace ${m.dias_vencidos} día(s)${m.solo_aviso ? '' : ' · mora al día'}` };
  }
  if (m.dias_para_vencer != null) {
    return {
      tono: m.dias_para_vencer <= 3 ? 'ambar' : 'gris',
      texto: m.dias_para_vencer === 0
        ? `Vence HOY (${fechaLegible(m.fecha_limite)})`
        : `Vence el ${fechaLegible(m.fecha_limite)} · faltan ${m.dias_para_vencer} día(s)`,
    };
  }
  return null;
};

