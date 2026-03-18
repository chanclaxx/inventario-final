import { Routes, Route, Navigate } from 'react-router-dom';
import { PrivateRoute } from './components/layout/PrivateRoute';
import { MainLayout }   from './components/layout/MainLayout';

import Login                from './pages/Login';
import PlanBloqueadoPage    from './pages/PlanBloqueadoPage';
import RegisterPage         from './pages/RegisterPage';
import SuperAdminPage       from './pages/SuperAdminPage';
import RecuperarPassword    from './pages/RecuperarPassword';
import NuevaPassword        from './pages/NuevaPassword';

import Dashboard       from './pages/Dashboard';
import InventarioPage  from './pages/inventario/InventarioPage';
import FacturarPage    from './pages/facturas/FacturarPage';
import PrestamosPage   from './pages/prestamos/PrestamosPage';
import CajaPage        from './pages/caja/CajaPage';
import ReportesPage    from './pages/reportes/ReportesPage';
import ConfigPage      from './pages/configuracion/ConfigPage';
import AcreedoresPage  from './pages/acreedores/AcreedoresPage';
import ProveedoresPage from './pages/proveedores/ProveedoresPage';

export default function App() {
  return (
    <Routes>
      {/* Rutas públicas */}
      <Route path="/login"                 element={<Login />} />
      <Route path="/registro"              element={<RegisterPage />} />
      <Route path="/plan-bloqueado"        element={<PlanBloqueadoPage />} />
      <Route path="/superadmin"            element={<SuperAdminPage />} />
      <Route path="/recuperar-contrasena"  element={<RecuperarPassword />} />
      <Route path="/nueva-contrasena"      element={<NuevaPassword />} />

      {/* Rutas privadas */}
      <Route path="/*" element={
        <PrivateRoute>
          <MainLayout>
            <Routes>
              {/* Todos los roles */}
              <Route path="/"           element={<PrivateRoute rol="supervisor"><Dashboard /></PrivateRoute>} />
              <Route path="/inventario" element={<InventarioPage />} />
              <Route path="/facturar"   element={
                <PrivateRoute rol="supervisor"><FacturarPage /></PrivateRoute>
              } />
              <Route path="/prestamos"  element={<PrestamosPage />} />

              {/* Supervisor + admin_negocio */}
              <Route path="/caja" element={
                <PrivateRoute rol="supervisor"><CajaPage /></PrivateRoute>
              } />

              {/* Solo admin_negocio */}
              <Route path="/reportes" element={
                <PrivateRoute rol="admin_negocio"><ReportesPage /></PrivateRoute>
              } />
              <Route path="/proveedores" element={
                <PrivateRoute rol="admin_negocio"><ProveedoresPage /></PrivateRoute>
              } />
              <Route path="/acreedores" element={
                <PrivateRoute rol="admin_negocio"><AcreedoresPage /></PrivateRoute>
              } />
              <Route path="/config" element={
                <PrivateRoute rol="admin_negocio"><ConfigPage /></PrivateRoute>
              } />

              <Route path="*" element={<Navigate to="/inventario" replace />} />
            </Routes>
          </MainLayout>
        </PrivateRoute>
      } />
    </Routes>
  );
}