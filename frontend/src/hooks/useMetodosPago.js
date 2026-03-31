import { useQuery } from '@tanstack/react-query';
import api from '../api/axios.config';

const METODOS_PAGO_DEFAULT = [
  { id: 'Efectivo',      label: 'Efectivo'      },
  { id: 'Nequi',         label: 'Nequi'         },
  { id: 'Daviplata',     label: 'Daviplata'     },
  { id: 'Transferencia', label: 'Transferencia' },
  { id: 'Tarjeta',       label: 'Tarjeta'       },
];

export function useMetodosPago() {
  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
  });

  const raw = configData?.metodos_pago;

  if (!raw) return METODOS_PAGO_DEFAULT;

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((m) => (typeof m === 'string' ? { id: m, label: m } : m));
    }
  } catch {
    // JSON inválido → defaults
  }

  return METODOS_PAGO_DEFAULT;
}