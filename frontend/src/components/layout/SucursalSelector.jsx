import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Building2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/useAuth';
import useSucursalStore from '../../store/sucursalStore';
import useCarritoStore from '../../store/carritoStore';
import { getSucursales } from '../../api/sucursales.api';

export function SucursalSelector() {
  const { usuario, esAdminNegocio, esEspectador } = useAuth();
  const queryClient = useQueryClient();

  const sucursalActiva  = useSucursalStore((s) => s.sucursalActiva);
  const sucursales      = useSucursalStore((s) => s.sucursales);
  const setSucursal     = useSucursalStore((s) => s.setSucursal);
  const setSucursales   = useSucursalStore((s) => s.setSucursales);
  const esUnicaSucursal = useSucursalStore((s) => s.esUnicaSucursal);
  const limpiarCarrito  = useCarritoStore((s) => s.limpiarCarrito);

  const [abierto, setAbierto] = useState(false);
  const [pos, setPos]         = useState({ top: 0, left: 0 });
  const btnRef      = useRef(null);
  const dropdownRef = useRef(null);

  const puedeSeleccionar = esAdminNegocio() || esEspectador();

  const { data: listaSucursales } = useQuery({
    queryKey  : ['sucursales-selector'],
    queryFn   : async () => {
      const { data } = await getSucursales();
      return data.data ?? data;
    },
    enabled   : puedeSeleccionar,
    staleTime : 5 * 60 * 1000,
  });

  useEffect(() => {
    if (Array.isArray(listaSucursales) && listaSucursales.length > 0) {
      setSucursales(listaSucursales, usuario?.negocio_id ?? null);
    }
  }, [listaSucursales, setSucursales, usuario?.negocio_id]);

  // Recalcula posición cada vez que se abre
  useEffect(() => {
    if (!abierto || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({
      top  : rect.bottom + 6,
      left : rect.right - 224,
    });
  }, [abierto]);

  // Cierra al hacer clic fuera — comprueba tanto el botón como el dropdown
  useEffect(() => {
    if (!abierto) return;
    const handleClick = (e) => {
      if (
        btnRef.current?.contains(e.target) ||
        dropdownRef.current?.contains(e.target)
      ) return;
      setAbierto(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [abierto]);

  if (!puedeSeleccionar || esUnicaSucursal()) return null;

  const handleSeleccionar = (sucursalId) => {
    if (sucursalId !== sucursalActiva) {
      setSucursal(sucursalId);
      limpiarCarrito();
      queryClient.invalidateQueries();
    }
    setAbierto(false);
  };

  const sucursalSeleccionada = sucursales.find((s) => s.id === sucursalActiva);
  const etiquetaActiva = sucursalSeleccionada?.nombre ?? 'Seleccionar sucursal';

  return (
    <>
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

      {abierto && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position : 'fixed',
            top      : pos.top,
            left     : Math.max(8, pos.left),
            width    : 224,
            zIndex   : 9999,
          }}
          className="bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden"
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
        </div>,
        document.body
      )}
    </>
  );
}