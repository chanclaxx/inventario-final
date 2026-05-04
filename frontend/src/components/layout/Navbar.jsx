import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/useAuth.js';
import { usePermisos } from '../../hooks/usePermisos.js';
import {
  LayoutDashboard, Package, FileText, Handshake,
  Wallet, BarChart2, Settings, LogOut, ShoppingCart,
  Users, Truck, Wrench, ArrowRightLeft,
} from 'lucide-react';
import { getSucursales } from '../../api/sucursales.api.js';
import useCarritoStore  from '../../store/carritoStore.js';
import useSucursalStore from '../../store/sucursalStore.js';
import { SucursalSelector } from './SucursalSelector.jsx';

const NAV_ITEMS = [
  { path: '/',            label: 'Inicio',      Icn: LayoutDashboard, soloAdmin: true                         },
  { path: '/inventario',  label: 'Inventario',  Icn: Package,         modulo: 'inventario'                    },
  { path: '/facturar',    label: 'Facturas',    Icn: FileText,        modulo: 'facturar'                      },
  { path: '/servicios',   label: 'Servicios',   Icn: Wrench,          modulo: 'servicios'                     },
  { path: '/proveedores', label: 'Proveedores', Icn: Truck,           modulo: 'proveedores'                   },
  { path: '/prestamos',   label: 'Préstamos',   Icn: Handshake,       modulo: 'prestamos'                     },
  { path: '/caja',        label: 'Caja',        Icn: Wallet,          modulo: 'caja'                          },
  { path: '/traslados',   label: 'Traslados',   Icn: ArrowRightLeft,  modulo: 'traslados', multiSucursal: true },
  { path: '/reportes',    label: 'Reportes',    Icn: BarChart2,       modulo: 'reportes'                      },
  { path: '/acreedores',  label: 'Acreedores',  Icn: Users,           modulo: 'acreedores'                    },
  { path: '/config',      label: 'Config',      Icn: Settings,        soloAdmin: true                         },
];

function esItemVisible(item, puedeVer, esAdmin, totalSucursales) {
  if (item.multiSucursal && totalSucursales < 2) return false;
  if (item.soloAdmin) return esAdmin;
  if (item.modulo)    return puedeVer(item.modulo);
  return true;
}

function AvatarUsuario({ nombre }) {
  const initials = (nombre || '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-700 rounded-xl
      flex items-center justify-center shadow-sm flex-shrink-0">
      <span className="text-white text-xs font-bold">{initials}</span>
    </div>
  );
}

export function Navbar() {
  const { usuario, logout } = useAuth();
  const { puedeVer, esAdmin } = usePermisos();
  const navigate  = useNavigate();
  const location  = useLocation();

  const cantidadItems = useCarritoStore((s) => s.cantidadItems());
  const resetSucursal = useSucursalStore((s) => s.reset);

  const [visible,    setVisible]    = useState(true);
  const [lastScroll, setLastScroll] = useState(0);

  const { data: sucursalesRaw } = useQuery({
    queryKey: ['sucursales'],
    queryFn:  () => getSucursales().then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });
  const totalSucursales = (sucursalesRaw || []).length;

  useEffect(() => {
    const handleScroll = () => {
      const current = window.scrollY;
      setVisible(current < lastScroll || current < 50);
      setLastScroll(current);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScroll]);

  const handleLogout = async () => {
    await logout();
    resetSucursal();
    navigate('/login');
  };

  const itemsVisibles = NAV_ITEMS.filter((item) =>
    esItemVisible(item, puedeVer, esAdmin, totalSucursales)
  );

  return (
    <>
      {/* ── Barra superior ── */}
      <header className={`
        fixed top-0 left-0 right-0 z-40 transition-transform duration-300
        ${visible ? 'translate-y-0' : '-translate-y-full'}
      `}>
        <div className="bg-white/90 backdrop-blur-xl border-b border-gray-200/60 shadow-sm">
          <div className="max-w-screen-xl mx-auto px-4">
            <div className="flex items-center h-14 gap-3">

              {/* Logo */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center shadow">
                  <span className="text-white text-sm font-bold">I</span>
                </div>
                <span className="font-semibold text-gray-900 hidden sm:block">Inventario</span>
              </div>

              {/* Nav desktop — icon+label en lg, solo icono en md */}
              <nav className="hidden md:flex items-center gap-0.5 flex-1 justify-center">
                {itemsVisibles.map((item) => {
                  const active   = location.pathname === item.path;
                  const ItemIcon = item.Icn;
                  return (
                    <button
                      key={item.path}
                      onClick={() => navigate(item.path)}
                      title={item.label}
                      className={`flex items-center gap-1.5 rounded-xl transition-all duration-150
                        text-sm font-medium px-2.5 py-2
                        ${active
                          ? 'bg-blue-600 text-white shadow-sm shadow-blue-200'
                          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}`}
                    >
                      <ItemIcon size={17} />
                      <span className="hidden lg:block">{item.label}</span>
                    </button>
                  );
                })}
              </nav>

              {/* Derecha desktop */}
              <div className="hidden md:flex items-center gap-2 flex-shrink-0 ml-auto">
                <SucursalSelector />

                <button
                  onClick={() => navigate('/inventario')}
                  className="relative p-2 rounded-xl hover:bg-gray-100 transition-colors"
                  title="Carrito"
                >
                  <ShoppingCart size={20} className="text-gray-600" />
                  {cantidadItems > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-blue-600 text-white
                      text-xs rounded-full flex items-center justify-center font-medium leading-none">
                      {cantidadItems}
                    </span>
                  )}
                </button>

                <div className="flex items-center gap-2 pl-2 border-l border-gray-200">
                  <AvatarUsuario nombre={usuario?.nombre} />
                  <div className="hidden lg:flex flex-col items-start">
                    <span className="text-xs font-semibold text-gray-700 leading-tight">
                      {usuario?.nombre}
                    </span>
                    <span className="text-xs text-gray-400 capitalize leading-tight">
                      {usuario?.rol?.replace('_', ' ')}
                    </span>
                  </div>
                  <button
                    onClick={handleLogout}
                    title="Cerrar sesión"
                    className="p-2 rounded-xl hover:bg-red-50 hover:text-red-500
                      text-gray-400 transition-colors"
                  >
                    <LogOut size={18} />
                  </button>
                </div>
              </div>

              {/* Derecha mobile */}
              <div className="flex md:hidden items-center gap-1 ml-auto">
                <SucursalSelector />

                <button
                  onClick={() => navigate('/inventario')}
                  className="relative p-2 rounded-xl hover:bg-gray-100 transition-colors"
                  title="Carrito"
                >
                  <ShoppingCart size={20} className="text-gray-600" />
                  {cantidadItems > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-blue-600 text-white
                      text-xs rounded-full flex items-center justify-center font-medium leading-none">
                      {cantidadItems}
                    </span>
                  )}
                </button>

                <div className="flex items-center gap-1 pl-1 border-l border-gray-200">
                  <AvatarUsuario nombre={usuario?.nombre} />
                  <button
                    onClick={handleLogout}
                    title="Cerrar sesión"
                    className="p-2 rounded-xl hover:bg-red-50 hover:text-red-500
                      text-gray-400 transition-colors"
                  >
                    <LogOut size={18} />
                  </button>
                </div>
              </div>

            </div>
          </div>
        </div>
      </header>

      {/* ── Nav inferior mobile ── */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden
        bg-white/95 backdrop-blur-xl border-t border-gray-200/70 shadow-[0_-2px_12px_rgba(0,0,0,0.06)]">
        <div className="flex items-stretch overflow-x-auto no-scrollbar px-1 py-1 gap-0.5">
          {itemsVisibles.map((item) => {
            const active   = location.pathname === item.path;
            const ItemIcon = item.Icn;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`flex flex-col items-center justify-center gap-0.5
                  flex-1 min-w-[52px] px-1 py-1.5 rounded-xl
                  transition-all duration-150 select-none
                  ${active ? 'text-blue-600' : 'text-gray-400 active:scale-95'}`}
              >
                <div className={`p-1.5 rounded-xl transition-all duration-150
                  ${active ? 'bg-blue-50 scale-110' : ''}`}>
                  <ItemIcon size={19} strokeWidth={active ? 2.25 : 1.75} />
                </div>
                <span className="text-[10px] font-medium leading-none truncate max-w-full px-0.5">
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
