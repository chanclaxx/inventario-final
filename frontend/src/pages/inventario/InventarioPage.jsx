import { useState } from 'react';
import {
  Package, ShoppingBag, Plus, Download,
  ShoppingCart, ChevronDown, ChevronUp, Upload, AlertCircle, X,
} from 'lucide-react';
import { useQueryClient }          from '@tanstack/react-query';
import { ProductosSerial }         from './ProductosSerial';
import { ProductosCantidad }       from './ProductosCantidad';
import { Carrito }                 from './Carrito';
import { ModalFactura }            from '../facturas/ModalFactura';
import { ModalPrestamo }           from '../prestamos/ModalPrestamo';
import { ModalAgregarProducto }    from './ModalAgregarProducto';
import { Button }                  from '../../components/ui/Button';
import { exportarInventarioExcel } from '../../utils/exportarInventarioExcel';
import useCarritoStore             from '../../store/carritoStore';
import useSucursalStore            from '../../store/sucursalStore';
import { useAuth }                 from '../../context/useAuth';
import api                         from '../../api/axios.config';
import { ModalImportarInventario } from './ModalImportarInventario';
import { formatCOP }               from '../../utils/formatters';

const TABS = [
  { id: 'serial',   label: 'Con Serial',   icon: Package    },
  { id: 'cantidad', label: 'Por Cantidad', icon: ShoppingBag },
];

export default function InventarioPage() {
  const queryClient = useQueryClient();

  const [tabActiva,      setTabActiva]      = useState('serial');
  const [modalFactura,   setModalFactura]   = useState(false);
  const [modalPrestamo,  setModalPrestamo]  = useState(false);
  const [modalAgregar,   setModalAgregar]   = useState(false);
  const [exportando,     setExportando]     = useState(false);
  const [carritoAbierto, setCarritoAbierto] = useState(false);
  const [modalImportar,  setModalImportar]  = useState(false);

  const { esSupervisor } = useAuth();

  const { items, totalCarrito } = useCarritoStore();
  const totalItems = items.length;
  const total      = totalCarrito();

  const esVistaGlobal   = useSucursalStore((s) => s.esVistaGlobal());
  const esUnicaSucursal = useSucursalStore((s) => s.esUnicaSucursal());

  const bloquearCreacion = esVistaGlobal && !esUnicaSucursal;
  const puedeExportar    = esSupervisor();

  const handleExportar = async () => {
    setExportando(true);
    try {
      const { data } = await api.get('/inventario/exportar');
      const { porProducto, cantidad } = data.data;
      exportarInventarioExcel(porProducto, cantidad);
    } catch (err) {
      console.error('Error al exportar inventario:', err);
    } finally {
      setExportando(false);
    }
  };

  const handleCerrarModalAgregar = () => {
    setModalAgregar(false);
    queryClient.invalidateQueries({ queryKey: ['productos-serial'],   exact: false });
    queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
    queryClient.invalidateQueries({ queryKey: ['seriales'],           exact: false });
  };

  const handleCerrarModalImportar = () => {
    setModalImportar(false);
    queryClient.invalidateQueries({ queryKey: ['productos-serial'],   exact: false });
    queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
    queryClient.invalidateQueries({ queryKey: ['seriales'],           exact: false });
  };

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">

      {/* ── Contenido principal ── */}
      <div className="flex-1 min-w-0">

        {bloquearCreacion && (
          <div className="flex items-start gap-2 px-3 py-2.5 mb-3 bg-purple-50
            border border-purple-200 rounded-xl text-sm text-purple-700">
            <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
            <span>
              Estás viendo todas las sucursales. Selecciona una sucursal específica
              para agregar o importar productos.
            </span>
          </div>
        )}

        {/* ── Barra de tabs + acciones ── */}
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
            {TABS.map((tab) => {
              const TabIcon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setTabActiva(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                    transition-all duration-150
                    ${tabActiva === tab.id
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'}`}
                >
                  <TabIcon size={16} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            {puedeExportar && (
              <Button size="sm" variant="secondary" onClick={handleExportar} loading={exportando}
                title="Descargar inventario completo en Excel">
                <Download size={16} />
                <span className="hidden sm:inline">
                  {exportando ? 'Generando...' : 'Exportar Excel'}
                </span>
              </Button>
            )}

            <Button size="sm" variant="secondary" onClick={() => setModalImportar(true)}
              disabled={bloquearCreacion}
              title={bloquearCreacion ? 'Selecciona una sucursal para importar' : 'Importar desde Excel'}>
              <Upload size={16} />
              <span className="hidden sm:inline">Importar</span>
            </Button>

            <Button size="sm" onClick={() => setModalAgregar(true)}
              disabled={bloquearCreacion}
              title={bloquearCreacion ? 'Selecciona una sucursal para agregar productos' : 'Agregar producto'}>
              <Plus size={16} />
              <span className="hidden sm:inline">Agregar</span>
            </Button>
          </div>
        </div>

        {tabActiva === 'serial'   && <ProductosSerial />}
        {tabActiva === 'cantidad' && <ProductosCantidad />}
      </div>

      {/* ── Carrito desktop: columna fija derecha ── */}
      <div className="hidden lg:block w-72 flex-shrink-0">
        <div className="sticky top-28 bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
          <Carrito
            onFacturar={() => setModalFactura(true)}
            onPrestar={() => setModalPrestamo(true)}
          />
        </div>
      </div>

      {/* ── Carrito móvil: botón flotante + panel desplegable ── */}
      <div className="lg:hidden">
        {/* Botón colapsador */}
        <button
          onClick={() => setCarritoAbierto((v) => !v)}
          className={`w-full flex items-center justify-between px-4 py-3
            border rounded-2xl shadow-sm transition-all active:scale-[0.99]
            ${totalItems > 0
              ? 'bg-blue-600 border-blue-600 text-white'
              : 'bg-white border-gray-200 text-gray-700'}`}
        >
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <ShoppingCart size={20} className={totalItems > 0 ? 'text-white' : 'text-blue-600'} />
              {totalItems > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-white
                  text-blue-600 text-[10px] font-bold rounded-full flex items-center justify-center">
                  {totalItems}
                </span>
              )}
            </div>
            <span className="text-sm font-semibold">
              {totalItems > 0 ? `Carrito (${totalItems})` : 'Carrito vacío'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {totalItems > 0 && (
              <span className="text-sm font-bold">
                {formatCOP(total)}
              </span>
            )}
            {carritoAbierto
              ? <ChevronUp  size={18} className="opacity-70" />
              : <ChevronDown size={18} className="opacity-70" />}
          </div>
        </button>

        {/* Panel desplegable del carrito */}
        {carritoAbierto && (
          <div className="mt-2 bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Carrito</p>
              <button
                onClick={() => setCarritoAbierto(false)}
                className="p-1 rounded-lg hover:bg-gray-100 transition-colors text-gray-400">
                <X size={15} />
              </button>
            </div>
            <div className="p-4 pt-2">
              <Carrito
                onFacturar={() => { setModalFactura(true);  setCarritoAbierto(false); }}
                onPrestar={() =>  { setModalPrestamo(true); setCarritoAbierto(false); }}
              />
            </div>
          </div>
        )}
      </div>

      <ModalFactura  open={modalFactura}  onClose={() => setModalFactura(false)}  />
      <ModalPrestamo open={modalPrestamo} onClose={() => setModalPrestamo(false)} />

      {modalAgregar && !bloquearCreacion && (
        <ModalAgregarProducto onClose={handleCerrarModalAgregar} />
      )}
      {modalImportar && !bloquearCreacion && (
        <ModalImportarInventario onClose={handleCerrarModalImportar} />
      )}
    </div>
  );
}
