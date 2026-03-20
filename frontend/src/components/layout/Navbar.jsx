import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/useAuth.js';
import {
  LayoutDashboard, Package, FileText, Handshake,
  Wallet, BarChart2, Settings, LogOut, ShoppingCart, Users, Truck, Wrench,
} from 'lucide-react';
import useCarritoStore from '../../store/carritoStore.js';
import useSucursalStore from '../../store/sucursalStore.js';
import { SucursalSelector } from './SucursalSelector.jsx';

// rol: undefined = todos | 'supervisor' = supervisor+admin | 'admin_negocio' = solo admin
const NAV_ITEMS = [
  { path: '/',            label: 'Inicio',      icon: LayoutDashboard, rol: 'admin_negocio' },
  { path: '/inventario',  label: 'Inventario',  icon: Package                              },
  { path: '/servicios',   label: 'Servicios',   icon: Wrench                               },
  { path: '/facturar',    label: 'Facturar',    icon: FileText,        rol: 'supervisor'   },
  { path: '/proveedores', label: 'Proveedores', icon: Truck,           rol: 'admin_negocio'},
  { path: '/prestamos',   label: 'Préstamos',   icon: Handshake                            },
  { path: '/caja',        label: 'Caja',        icon: Wallet,          rol: 'supervisor'   },
  { path: '/reportes',    label: 'Reportes',    icon: BarChart2,       rol: 'admin_negocio'},
  { path: '/acreedores',  label: 'Acreedores',  icon: Users,           rol: 'admin_negocio'},
  { path: '/config',      label: 'Config',      icon: Settings,        rol: 'admin_negocio'},
];

function puedeVerItem(item, usuario) {
  if (!item.rol) return true;
  if (item.rol === 'supervisor')    return ['supervisor', 'admin_negocio'].includes(usuario?.rol);
  if (item.rol === 'admin_negocio') return usuario?.rol === 'admin_negocio';
  return false;
}

export function Navbar() {
  const { usuario, logout } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();

  const cantidadItems = useCarritoStore((s) => s.cantidadItems());
  const resetSucursal = useSucursalStore((s) => s.reset);

  const [visible,    setVisible]    = useState(true);
  const [lastScroll, setLastScroll] = useState(0);

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

  const itemsVisibles = NAV_ITEMS.filter((item) => puedeVerItem(item, usuario));

  return (
    <header className={`
      fixed top-0 left-0 right-0 z-40 transition-transform duration-300
      ${visible ? 'translate-y-0' : '-translate-y-full'}
    `}>

      {/* ── Barra principal ────────────────────────────────────── */}
      <div className="bg-white/80 backdrop-blur-xl border-b border-gray-200/50 shadow-sm">
        <div className="max-w-screen-xl mx-auto px-4">
          <div className="flex items-center justify-between h-14">

            {/* Logo */}
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center shadow">
                <span className="text-white text-sm font-bold">I</span>
              </div>
              <span className="font-semibold text-gray-900 hidden sm:block">Inventario</span>
            </div>

            {/* Nav — desktop */}
            <nav className="hidden md:flex items-center gap-1">
              {itemsVisibles.map((item) => {
                const active   = location.pathname === item.path;
                const ItemIcon = item.icon;
                return (
                  <button
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    className={`
                      flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl
                      transition-all duration-150 text-xs font-medium
                      ${active
                        ? 'bg-blue-50 text-blue-600'
                        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'}
                    `}
                  >
                    <ItemIcon size={18} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Derecha: selector + carrito + usuario */}
            <div className="flex items-center gap-2">

              {/* Selector de sucursal */}
              <SucursalSelector />

              {/* Carrito */}
              <button
                onClick={() => navigate('/inventario')}
                className="relative p-2 rounded-xl hover:bg-gray-100 transition-colors"
              >
                <ShoppingCart size={20} className="text-gray-600" />
                {cantidadItems > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-blue-600 text-white
                    text-xs rounded-full flex items-center justify-center font-medium">
                    {cantidadItems}
                  </span>
                )}
              </button>

              {/* Usuario + logout */}
              <div className="flex items-center gap-2 pl-2 border-l border-gray-200">
                <div className="hidden sm:flex flex-col items-end">
                  <span className="text-xs font-medium text-gray-700">{usuario?.nombre}</span>
                  <span className="text-xs text-gray-400 capitalize">
                    {usuario?.rol?.replace('_', ' ')}
                  </span>
                </div>
                <button
                  onClick={handleLogout}
                  className="p-2 rounded-xl hover:bg-red-50 hover:text-red-500 text-gray-500 transition-colors"
                >
                  <LogOut size={18} />
                </button>
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* ── Nav mobile ─────────────────────────────────────────── */}
      <div className="md:hidden bg-white/90 backdrop-blur-xl border-b border-gray-200/50">
        <div className="flex items-center overflow-x-auto px-2 py-1 gap-1 no-scrollbar">
          {itemsVisibles.map((item) => {
            const active   = location.pathname === item.path;
            const ItemIcon = item.icon;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`
                  flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl
                  transition-all duration-150 text-xs font-medium whitespace-nowrap flex-shrink-0
                  ${active
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-gray-500 hover:bg-gray-100'}
                `}
              >
                <ItemIcon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}

          {/* Selector al final del scroll horizontal en mobile */}
          <div className="flex-shrink-0 pl-2 border-l border-gray-200 ml-1 flex items-center">
            <SucursalSelector />
          </div>
        </div>
      </div>
    </header>
  );
}