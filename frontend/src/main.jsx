import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query'
import { AuthProvider } from './context/AuthContext.jsx'
import { REPORT_QUERY_KEYS } from './api/reportes.api'
import App from './App.jsx'
import './index.css'

// Deshabilitar scroll en inputs numéricos globalmente
document.addEventListener('wheel', () => {
  if (document.activeElement?.type === 'number') {
    document.activeElement.blur();
  }
}, { passive: false });

// Red de seguridad de robustez: tras CUALQUIER mutación exitosa (crear/editar/
// cancelar factura, devolución, abono o saldo de crédito/préstamo, cierre de
// servicio, etc.) se marcan como obsoletas todas las vistas de reportes. Las
// consultas activas se refrescan al instante; las inactivas al volver a abrirse.
// Así ninguna edición puede dejar los reportes desactualizados, incluso para
// mutaciones futuras que se agreguen sin recordar invalidar manualmente.
const mutationCache = new MutationCache({
  onSuccess: () => {
    REPORT_QUERY_KEYS.forEach((key) =>
      queryClient.invalidateQueries({ queryKey: [key], exact: false }),
    )
  },
})

const queryClient = new QueryClient({
  mutationCache,
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30000,
    },
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
)