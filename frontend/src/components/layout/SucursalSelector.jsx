import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Building2, LayoutGrid } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/useAuth';
import useSucursalStore from '../../store/sucursalStore';
import useCarritoStore from '../../store/carritoStore';
import { getSucursales } from '../../api/sucursales.api';

/**
 * SucursalSelector
 *
 * Solo visible para admin_negocio Y cuando el negocio tiene más de una sucursal.
 *
 * Al montar, auto-selecciona la primera sucursal si no hay selección previa
 * válida — el usuario no necesita hacer clic para que los datos carguen.
 *
 * Al cambiar de sucursal:
 *   1. Actualiza sucursalStore
 *   2. Limpia el carrito
 *   3. Invalida todas las queries de React Query → recarga automática de datos
 */
export function SucursalSelector() {
  const { usuario, esAdminNegocio } = useAuth();
  const queryClient = useQueryClient();

  const sucursalActiva  = useSucursalStore((s) => s.sucursalActiva);
  const sucursales      = useSucursalStore((s) => s.sucursales);
  const setSucursal     = useSucursalStore((s) => s.setSucursal);
  const setSucursales   = useSucursalStore((s) => s.setSucursales);
  const esVistaGlobal   = useSucursalStore((s) => s.esVistaGlobal);
  const esUnicaSucursal = useSucursalStore((s) => s.esUnicaSucursal);
  const limpiarCarrito  = useCarritoStore((s) => s.limpiarCarrito);

  const [abierto, setAbierto] = useState(false);
  const ref = useRef(null);

  // Cargar lista de sucursales — solo si es admin
  const { data: listaSucursales } = useQuery({
    queryKey  : ['sucursales-selector'],
    queryFn   : async () => {
      const { data } = await getSucursales();
      return data.data ?? data;
    },
    enabled   : esAdminNegocio(),
    staleTime : 5 * 60 * 1000,
  });

  // Sincronizar lista con el store.
  // Pasa el negocio_id actual para que setSucursales pueda detectar cambios
  // de negocio y auto-seleccionar cuando sucursalActiva sea null.
  useEffect(() => {
    if (Array.isArray(listaSucursales) && listaSucursales.length > 0) {
      setSucursales(listaSucursales, usuario?.negocio_id ?? null);
    }
  }, [listaSucursales, setSucursales, usuario?.negocio_id]);

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    const handleClickFuera = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setAbierto(false);
      }
    };
    document.addEventListener('mousedown', handleClickFuera);
    return () => document.removeEventListener('mousedown', handleClickFuera);
  }, []);

  // No renderizar si: no es admin, o solo hay una sucursal
  if (!esAdminNegocio() || esUnicaSucursal()) return null;

  const handleSeleccionar = (valor) => {
    if (valor === sucursalActiva) {
      setAbierto(false);
      return;
    }
    setSucursal(valor);
    limpiarCarrito();
    queryClient.invalidateQueries();
    setAbierto(false);
  };

  const sucursalSeleccionada = sucursales.find((s) => s.id === sucursalActiva);
  const etiquetaActiva = esVistaGlobal()
    ? 'Todas las sucursales'
    : sucursalSeleccionada?.nombre ?? 'Seleccionar sucursal';

  return (
    <div ref={ref} className="relative">
      {/* Botón disparador */}
      <button
        onClick={() => setAbierto((v) => !v)}
        className={`
          flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium
          transition-all duration-150 hover:brightness-95
          ${esVistaGlobal()
            ? 'bg-purple-50 border-purple-200 text-purple-700'
            : 'bg-blue-50 border-blue-200 text-blue-700'}
        `}
      >
        {esVistaGlobal()
          ? <LayoutGrid size={14} />
          : <Building2 size={14} />
        }
        <span className="max-w-[130px] truncate hidden sm:inline">
          {etiquetaActiva}
        </span>
        <ChevronDown
          size={12}
          className={`transition-transform duration-150 ${abierto ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown */}
      {abierto && (
        <div className={`
          absolute right-0 top-full mt-1.5 w-56 bg-white rounded-xl
          border border-gray-200 shadow-lg z-50 overflow-hidden
          animate-in fade-in slide-in-from-top-1 duration-150
        `}>

          {/* Opción: Todas las sucursales */}
          <button
            onClick={() => handleSeleccionar('todas')}
            className={`
              w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors
              ${sucursalActiva === 'todas'
                ? 'bg-purple-50 text-purple-700 font-medium'
                : 'text-gray-700 hover:bg-gray-50'}
            `}
          >
            <LayoutGrid size={15} className="flex-shrink-0" />
            <span>Todas las sucursales</span>
          </button>

          <div className="border-t border-gray-100 mx-2" />

          {/* Lista de sucursales activas */}
          {sucursales.map((sucursal) => (
            <button
              key={sucursal.id}
              onClick={() => handleSeleccionar(sucursal.id)}
              className={`
                w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors
                ${sucursalActiva === sucursal.id
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-gray-700 hover:bg-gray-50'}
              `}
            >
              <Building2 size={15} className="flex-shrink-0" />
              <span className="truncate">{sucursal.nombre}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}