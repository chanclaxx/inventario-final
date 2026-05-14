import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/useAuth.js';
import { usePermisos } from '../../hooks/usePermisos.js';
import {
  LayoutDashboard, Package, FileText, Handshake,
  Wallet, BarChart2, Settings, LogOut, ShoppingCart,
  Users, Truck, Wrench, ArrowRightLeft, Search,
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
  { path: '/prestamos',    label: 'Préstamos',    Icn: Handshake,   modulo: 'prestamos'                     },
  { path: '/caja',        label: 'Caja',        Icn: Wallet,          modulo: 'caja'                          },
  { path: '/traslados',   label: 'Traslados',   Icn: ArrowRightLeft,  modulo: 'traslados', multiSucursal: true },
  { path: '/reportes',    label: 'Reportes',    Icn: BarChart2,       modulo: 'reportes'                      },
  { path: '/acreedores',  label: 'Acreedores',  Icn: Users,           modulo: 'acreedores'                    },
  { path: '/busqueda',    label: 'Búsqueda',    Icn: Search                                                   },
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
    <div className="w-7 h-7 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg
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
  const headerRef = useRef(null);

  const { data: sucursalesRaw } = useQuery({
    queryKey: ['sucursales'],
    queryFn:  () => getSucursales().then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });
  const totalSucursales = (sucursalesRaw || []).length;

  // Publica la altura real del navbar como --navbar-height en :root
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const publish = () => {
      document.documentElement.style.setProperty(
        '--navbar-height',
        `${el.offsetHeight}px`
      );
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    <header
      ref={headerRef}
      className={`
        fixed top-0 left-0 right-0 z-40 transition-transform duration-300
        ${visible ? 'translate-y-0' : '-translate-y-full'}
      `}
    >

      {/* ── Barra superior — logo + controles (todas las pantallas) ── */}
      <div className="bg-white/90 backdrop-blur-xl border-b border-gray-200/60 shadow-sm">
        <div className="max-w-screen-xl mx-auto px-4">
          <div className="flex items-center h-12 gap-3">

            {/* Logo */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center shadow">
                <span className="text-white text-xs font-bold">I</span>
              </div>
              <span className="font-semibold text-gray-900 text-sm hidden sm:block">
                Inventario
              </span>
            </div>

            <div className="flex-1" />

            {/* Controles */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <SucursalSelector />

              <button
                onClick={() => navigate('/inventario')}
                className="relative p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                title="Carrito"
              >
                <ShoppingCart size={17} className="text-gray-500" />
                {cantidadItems > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-600 text-white
                    text-xs rounded-full flex items-center justify-center font-medium leading-none">
                    {cantidadItems}
                  </span>
                )}
              </button>

              <div className="flex items-center gap-1.5 pl-2 border-l border-gray-200 ml-1">
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
                  className="p-1.5 rounded-lg hover:bg-red-50 hover:text-red-500
                    text-gray-400 transition-colors ml-1"
                >
                  <LogOut size={16} />
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ── Barra inferior DESKTOP — nav distribuida en todo el ancho ── */}
      <div className="hidden md:block bg-white/95 backdrop-blur-xl border-b border-gray-200/50">
        <div className="max-w-screen-xl mx-auto">
          <div className="flex items-stretch">
            {itemsVisibles.map((item) => {
              const active   = location.pathname === item.path;
              const ItemIcon = item.Icn;
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={`
                    flex-1 flex flex-col items-center justify-center gap-0.5
                    py-1.5 px-1 transition-all duration-150 border-b-2
                    ${active
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-400 hover:text-gray-700 hover:bg-gray-50'}
                  `}
                >
                  <ItemIcon size={15} />
                  <span className="text-xs font-medium leading-tight whitespace-nowrap">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Barra inferior MOBILE — scroll horizontal ── */}
      <div className="md:hidden bg-white/90 backdrop-blur-xl border-b border-gray-200/50">
        <div className="flex items-center overflow-x-auto no-scrollbar px-3 py-1.5 gap-1">
          {itemsVisibles.map((item) => {
            const active   = location.pathname === item.path;
            const ItemIcon = item.Icn;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl
                  transition-all duration-150 text-xs font-medium whitespace-nowrap flex-shrink-0
                  ${active
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-200'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'}`}
              >
                <ItemIcon size={14} />
                <span>{item.label}</span>
              </button>
            );
          })}

          <div className="flex-shrink-0 pl-2 border-l border-gray-200 ml-1 flex items-center">
            <SucursalSelector />
          </div>
        </div>
      </div>

    </header>
  );
}