import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getDashboard } from '../api/reportes.api';
import { useAuth } from '../context/useAuth.js';
import { formatCOP } from '../utils/formatters';
import { Spinner } from '../components/ui/Spinner';
import {
  TrendingUp, FileText, Package, Handshake,
  CreditCard, ShoppingCart, AlertTriangle
} from 'lucide-react';

function StatCard({ icon, label, valor, sub, color = 'blue', onClick }) {
  const colors = {
    blue:   'bg-blue-50 text-blue-600',
    green:  'bg-green-50 text-green-600',
    yellow: 'bg-yellow-50 text-yellow-600',
    red:    'bg-red-50 text-red-600',
    purple: 'bg-purple-50 text-purple-600',
  };

  return (
    <button
      onClick={onClick}
      className={`bg-white border border-gray-100 rounded-2xl p-4 flex items-start gap-4 
        shadow-sm hover:shadow-md transition-all duration-200 text-left w-full
        ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${colors[color]}`}>
        {(() => { const StatIcon = icon; return <StatIcon size={20} />; })()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-400 font-medium">{label}</p>
        <p className="text-xl font-bold text-gray-900 mt-0.5">{valor}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </button>
  );
}

export default function Dashboard() {
  const { usuario } = useAuth();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => getDashboard().then((r) => r.data.data),
    refetchInterval: 60000,
  });

  const hora = new Date().getHours();
  const saludo = hora < 12 ? 'Buenos días' : hora < 18 ? 'Buenas tardes' : 'Buenas noches';

  if (isLoading) return <Spinner className="py-32" />;

  return (
    <div className="flex flex-col gap-6">

      {/* Saludo */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {saludo}, {usuario?.nombre?.split(' ')[0]} 👋
        </h1>
        <p className="text-gray-400 text-sm mt-1">
          {new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {/* Stats principales */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={TrendingUp}
          label="Ventas hoy"
          valor={formatCOP(data?.ventas_hoy || 0)}
          sub={`${data?.facturas_hoy || 0} factura(s)`}
          color="green"
          onClick={() => navigate('/reportes')}
        />
        <StatCard
          icon={Handshake}
          label="Préstamos activos"
          valor={data?.prestamos_activos?.cantidad || 0}
          sub={formatCOP(data?.prestamos_activos?.deuda_total || 0)}
          color="blue"
          onClick={() => navigate('/prestamos')}
        />
        <StatCard
          icon={CreditCard}
          label="Créditos activos"
          valor={data?.creditos_activos?.cantidad || 0}
          sub={formatCOP(data?.creditos_activos?.deuda_total || 0)}
          color="purple"
          onClick={() => navigate('/prestamos')}
        />
        <StatCard
          icon={AlertTriangle}
          label="Stock bajo"
          valor={data?.stock_bajo || 0}
          sub="productos"
          color={data?.stock_bajo > 0 ? 'red' : 'yellow'}
          onClick={() => navigate('/inventario')}
        />
      </div>

      {/* Pagos de hoy */}
      {data?.pagos_hoy?.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <FileText size={16} className="text-blue-600" />
            Pagos recibidos hoy
          </h2>
          <div className="flex flex-wrap gap-3">
            {data.pagos_hoy.map((p) => (
              <div key={p.metodo} className="flex items-center gap-2 bg-gray-50 rounded-xl px-4 py-2">
                <span className="text-sm text-gray-500">{p.metodo}</span>
                <span className="text-sm font-bold text-gray-900">{formatCOP(p.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Accesos rápidos */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 mb-3">Accesos rápidos</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Nueva venta',   icon: ShoppingCart, path: '/inventario', color: 'bg-blue-600' },
            { label: 'Préstamos',     icon: Handshake,    path: '/prestamos',  color: 'bg-indigo-500' },
            { label: 'Inventario',    icon: Package,      path: '/inventario', color: 'bg-green-500' },
            { label: 'Reportes',      icon: TrendingUp,   path: '/reportes',   color: 'bg-purple-500' },
          ].map((item) => {
            const ItemIcon = item.icon;
            return (
              <button
                key={item.label}
                onClick={() => navigate(item.path)}
                className="flex flex-col items-center gap-2 p-4 bg-white border border-gray-100
                  rounded-2xl shadow-sm hover:shadow-md transition-all duration-200"
              >
                <div className={`w-10 h-10 ${item.color} rounded-xl flex items-center justify-center`}>
                  <ItemIcon size={20} className="text-white" />
                </div>
                <span className="text-xs font-medium text-gray-700">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}