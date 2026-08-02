import { Routes, Route, Navigate } from 'react-router-dom';
import { PrivateRoute } from './components/layout/PrivateRoute';
import { MainLayout }   from './components/layout/MainLayout';
import { ModuloGuard }  from './components/ModuloGuard';

import Login                from './pages/Login';
import PlanBloqueadoPage    from './pages/PlanBloqueadoPage';
import RegisterPage         from './pages/RegisterPage';
import SuperAdminPage       from './pages/SuperAdminPage';
import RecuperarPassword    from './pages/RecuperarPassword';
import NuevaPassword        from './pages/NuevaPassword';
import SinAccesoPage        from './pages/SinAccesoPage';

import Dashboard            from './pages/Dashboard';
import InventarioPage       from './pages/inventario/InventarioPage';
import FacturarPage         from './pages/facturas/FacturarPage';
import PrestamosPage        from './pages/prestamos/PrestamosPage';
import CajaPage             from './pages/caja/CajaPage';
import ReportesPage         from './pages/reportes/ReportesPage';
import ConfigPage              from './pages/configuracion/ConfigPage';
import ActividadUsuariosPage  from './pages/actividad/ActividadUsuariosPage';
import AcreedoresPage       from './pages/acreedores/AcreedoresPage';
import ProveedoresPage      from './pages/proveedores/ProveedoresPage';
import ServiciosPage        from './pages/servicios/ServiciosPage';
import TrasladosPage        from './pages/traslados/TrasladosPage';
import RedInternaPage       from './pages/red-interna/RedInternaPage';
import TesoreriaPage        from './pages/tesoreria/TesoreriaPage';
import BusquedaPage         from './pages/busqueda/BusquedaPage';
import CobrosPage           from './pages/cobros/CobrosPage';

export default function App() {
  return (
    <Routes>
      {/* Rutas públicas */}
      <Route path="/login"                element={<Login />} />
      <Route path="/registro"             element={<RegisterPage />} />
      <Route path="/plan-bloqueado"       element={<PlanBloqueadoPage />} />
      <Route path="/superadmin"           element={<SuperAdminPage />} />
      <Route path="/recuperar-contrasena" element={<RecuperarPassword />} />
      <Route path="/nueva-contrasena"     element={<NuevaPassword />} />

      {/* Rutas privadas */}
      <Route path="/*" element={
        <PrivateRoute>
          <MainLayout>
            <Routes>
              {/* Solo admin_negocio */}
              <Route path="/" element={
                <PrivateRoute rol="admin_negocio"><Dashboard /></PrivateRoute>
              } />

              {/* Módulos con guard de permisos */}
              <Route path="/inventario" element={
                <ModuloGuard modulo="inventario"><InventarioPage /></ModuloGuard>
              } />
              <Route path="/facturar" element={
                <ModuloGuard modulo="facturar"><FacturarPage /></ModuloGuard>
              } />
              <Route path="/prestamos" element={
                <ModuloGuard modulo="prestamos"><PrestamosPage /></ModuloGuard>
              } />
              {/* Cobros del día: la pantalla que abre el aviso de cartera
                  vencida. Va bajo el permiso de préstamos porque es la misma
                  cartera (créditos + préstamos vencidos). */}
              <Route path="/cobros" element={
                <ModuloGuard modulo="prestamos"><CobrosPage /></ModuloGuard>
              } />
              <Route path="/servicios" element={
                <ModuloGuard modulo="servicios"><ServiciosPage /></ModuloGuard>
              } />
              <Route path="/caja" element={
                <ModuloGuard modulo="caja"><CajaPage /></ModuloGuard>
              } />
              <Route path="/traslados" element={
                <ModuloGuard modulo="traslados"><TrasladosPage /></ModuloGuard>
              } />
              {/* Red interna (bodega → locales). Solo existe para los negocios
                  que activaron la feature: el backend responde 404 al resto y
                  la página muestra un estado vacío explicativo. */}
              <Route path="/bodega" element={
                <ModuloGuard modulo="red_interna"><RedInternaPage /></ModuloGuard>
              } />
              <Route path="/tesoreria" element={
                <ModuloGuard modulo="tesoreria"><TesoreriaPage /></ModuloGuard>
              } />
              <Route path="/reportes" element={
                <ModuloGuard modulo="reportes"><ReportesPage /></ModuloGuard>
              } />
              <Route path="/proveedores" element={
                <ModuloGuard modulo="proveedores"><ProveedoresPage /></ModuloGuard>
              } />
              <Route path="/acreedores" element={
                <ModuloGuard modulo="acreedores"><AcreedoresPage /></ModuloGuard>
              } />
              {/* Búsqueda — todos los roles */}
              <Route path="/busqueda" element={<BusquedaPage />} />

              {/* Solo admin_negocio — sin ModuloGuard */}
              <Route path="/config" element={
                <PrivateRoute rol="admin_negocio"><ConfigPage /></PrivateRoute>
              } />
              <Route path="/actividad-usuarios" element={
                <PrivateRoute rol="admin_negocio"><ActividadUsuariosPage /></PrivateRoute>
              } />

              {/* Página sin acceso */}
              <Route path="/sin-acceso" element={<SinAccesoPage />} />

              <Route path="*" element={<Navigate to="/inventario" replace />} />
            </Routes>
          </MainLayout>
        </PrivateRoute>
      } />
    </Routes>
  );
}