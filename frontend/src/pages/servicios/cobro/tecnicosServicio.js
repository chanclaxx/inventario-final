import { useQuery } from '@tanstack/react-query';
import { getTecnicosServicio } from '../../../api/servicios.api';

/** Técnicos internos de la sede. `activa` = el negocio encendió la lista. */
export function useTecnicosServicio() {
  const { data, isLoading } = useQuery({
    queryKey: ['servicios-tecnicos'],
    queryFn:  () => getTecnicosServicio().then((r) => r.data.data),
    staleTime: 60_000,
  });
  return {
    activa:   !!data?.activa,
    tecnicos: data?.tecnicos || [],
    cargando: isLoading,
  };
}

/** Nombre de quién reparó (o tiene asignada) la orden, para tarjetas y detalle. */
export const nombreTecnico = (o) => o.tecnico_nombre || (o.tecnico_externo ? `${o.tecnico_externo} (externo)` : null);
