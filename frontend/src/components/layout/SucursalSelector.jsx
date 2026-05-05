import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Building2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/useAuth';
import useSucursalStore from '../../store/sucursalStore';
import useCarritoStore from '../../store/carritoStore';
import { getSucursales } from '../../api/sucursales.api';

/**
 * SucursalSelector
 *
 * Solo visible para admin_negocio Y cuando el negocio tiene más de una sucursal.
 * El admin siempre opera en una sucursal específica.
 */
export function SucursalSelector() {
  const { usuario, esAdminNegocio } = useAuth();
  const queryClient = useQueryClient();

  const sucursalActiva  = useSucursalStore((s) => s.sucursalActiva);
  const sucursales      = useSucursalStore((s) => s.sucursales);
  const setSucursal     = useSucursalStore((s) => s.setSucursal);
  const setSucursales   = useSucursalStore((s) => s.setSucursales);
  const esUnicaSucursal = useSucursalStore((s) => s.esUnicaSucursal);
  const limpiarCarrito  = useCarritoStore((s) => s.limpiarCarrito);

  const [abierto, setAbierto] = useState(false);
  const [pos, setPos]         = useState({ top: 0, left: 0, width: 0 });
  const ref     = useRef(null);
  const btnRef  = useRef(null);

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

  // Sincronizar lista con el store
  useEffect(() => {
    if (Array.isArray(listaSucursales) && listaSucursales.length > 0) {
      setSucursales(listaSucursales, usuario?.negocio_id ?? null);
    }
  }, [listaSucursales, setSucursales, usuario?.negocio_id]);

  // Calcular posición del dropdown relativa al botón cada vez que se abre
  useEffect(() => {
    if (!abierto || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({
      top   : rect.bottom + window.scrollY + 6,
      left  : rect.right - 224, // 224 = w-56 en px
      width : 224,
    });
  }, [abierto]);

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

  const handleSeleccionar = (sucursalId) => {
    if (sucursalId === sucursalActiva) {
      setAbierto(false);
      return;
    }
    setSucursal(sucursalId);
    limpiarCarrito();
    queryClient.invalidateQueries();
    setAbierto(false);
  };

  const sucursalSeleccionada = sucursales.find((s) => s.id === sucursalActiva);
  const etiquetaActiva = sucursalSeleccionada?.nombre ?? 'Seleccionar sucursal';

  return (
    <div ref={ref} className="relative">
      <button
        ref={btnRef}
        onClick={() => setAbierto((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium
          transition-all duration-150 hover:brightness-95
          bg-blue-50 border-blue-200 text-blue-700"
      >
        <Building2 size={14} />
        <span className="max-w-[130px] truncate hidden sm:inline">
          {etiquetaActiva}
        </span>
        <ChevronDown
          size={12}
          className={`transition-transform duration-150 ${abierto ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown montado en document.body vía portal para escapar del stacking context del navbar */}
      {abierto && (
        <DropdownPortal>
          <div
            style={{
              position : 'absolute',
              top      : pos.top,
              left     : Math.max(8, pos.left),
              width    : pos.width,
              zIndex   : 9999,
            }}
            className="bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden
              animate-in fade-in slide-in-from-top-1 duration-150"
          >
            {sucursales.map((sucursal) => (
              <button
                key={sucursal.id}
                onClick={() => handleSeleccionar(sucursal.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors
                  ${sucursalActiva === sucursal.id
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-50'}`}
              >
                <Building2 size={15} className="flex-shrink-0" />
                <span className="truncate">{sucursal.nombre}</span>
              </button>
            ))}
          </div>
        </DropdownPortal>
      )}
    </div>
  );
}

// Portal mínimo para montar el dropdown fuera del header fixed
import { createPortal } from 'react-dom';
function DropdownPortal({ children }) {
  return createPortal(children, document.body);
}