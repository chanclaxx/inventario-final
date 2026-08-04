import { useState } from 'react';
import {
  Package, ShoppingBag, Plus, Download,
  ShoppingCart, ChevronUp, Upload, AlertCircle, X, Globe,
} from 'lucide-react';
import { useQueryClient }          from '@tanstack/react-query';
import { ProductosSerial }         from './ProductosSerial';
import { ProductosCantidad }       from './ProductosCantidad';
import { Carrito }                 from './Carrito';
import { ModalFactura }            from '../facturas/ModalFactura';
import { ModalPrestamo }           from '../prestamos/ModalPrestamo';
import { ModalAgregarProducto }    from './ModalAgregarProducto';
import { Button }                  from '../../components/ui/Button';
import { ModalExportarInventario }  from './ModalExportarInventario';
import useCarritoStore             from '../../store/carritoStore';
import useSucursalStore            from '../../store/sucursalStore';
import { useAuth }                 from '../../context/useAuth';
import { ModalImportarInventario } from './ModalImportarInventario';
import { TabCatalogo }             from './TabCatalogo';
import { formatCOP }               from '../../utils/formatters';

const TABS = [
  { id: 'serial',   label: 'Con Serial',   icon: Package    },
  { id: 'cantidad', label: 'Por Cantidad', icon: ShoppingBag },
  // El catálogo web vive aquí, y no en su propio módulo, a propósito: publicar
  // es una decisión sobre el inventario y hereda su permiso. Así no cambia el
  // acceso de ningún usuario existente.
  { id: 'catalogo', label: 'Catálogo web', icon: Globe      },
];

export default function InventarioPage() {
  const queryClient = useQueryClient();

  const [tabActiva,      setTabActiva]      = useState('serial');
  const [modalFactura,   setModalFactura]   = useState(false);
  const [modalPrestamo,  setModalPrestamo]  = useState(false);
  const [modalAgregar,   setModalAgregar]   = useState(false);
  const [modalExportar,  setModalExportar]  = useState(false);
  const [carritoAbierto, setCarritoAbierto] = useState(false);
  const [modalImportar,  setModalImportar]  = useState(false);

  const { puedeExportarInventario, esSucursalVista } = useAuth();
  const sucursalActiva = useSucursalStore((s) => s.sucursalActiva);
  const soloLectura    = esSucursalVista(sucursalActiva);

  const { items, totalCarrito } = useCarritoStore();
  const totalItems = items.length;
  const total      = totalCarrito();

  const esVistaGlobal   = useSucursalStore((s) => s.esVistaGlobal());
  const esUnicaSucursal = useSucursalStore((s) => s.esUnicaSucursal());

  const bloquearCreacion = esVistaGlobal && !esUnicaSucursal;
  const puedeExportar    = puedeExportarInventario();


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
      {/* pb-28 en móvil para que la barra fija del carrito no tape el contenido */}
      <div className={`flex-1 min-w-0 ${soloLectura || tabActiva === 'catalogo' ? '' : 'pb-28 lg:pb-0'}`}>

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

          {!soloLectura && tabActiva !== 'catalogo' && (
            <div className="flex items-center gap-2">
              {puedeExportar && (
                <Button size="sm" variant="secondary" onClick={() => setModalExportar(true)}
                  title="Descargar inventario completo en Excel">
                  <Download size={16} />
                  <span className="hidden sm:inline">Exportar Excel</span>
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
          )}
        </div>

        {tabActiva === 'serial'   && <ProductosSerial />}
        {tabActiva === 'cantidad' && <ProductosCantidad />}
        {tabActiva === 'catalogo' && <TabCatalogo />}
      </div>

      {/* ── Carrito (oculto en modo lectura y en el catálogo, que no vende) ── */}
      {!soloLectura && tabActiva !== 'catalogo' && (
        <>
          {/* Desktop: columna fija derecha */}
          <div className="hidden lg:block w-72 flex-shrink-0">
            <div className="sticky top-28 bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
              <Carrito
                onFacturar={() => setModalFactura(true)}
                onPrestar={() => setModalPrestamo(true)}
              />
            </div>
          </div>

          {/* Móvil: barra fija inferior */}
          <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 px-4 pb-5 pt-2
            bg-gradient-to-t from-white via-white to-transparent pointer-events-none">
            <button
              onClick={() => setCarritoAbierto(true)}
              className={`w-full pointer-events-auto flex items-center justify-between px-4 py-3.5
                rounded-2xl shadow-xl transition-all active:scale-[0.98]
                ${totalItems > 0
                  ? 'bg-blue-600 text-white shadow-blue-300/50'
                  : 'bg-white border border-gray-200 text-gray-500 shadow-gray-200/80'}`}
            >
              <div className="flex items-center gap-3">
                <div className="relative">
                  <ShoppingCart size={20} className={totalItems > 0 ? 'text-white' : 'text-blue-500'} />
                  {totalItems > 0 && (
                    <span className="absolute -top-2 -right-2 w-5 h-5 bg-white text-blue-600
                      text-[10px] font-bold rounded-full flex items-center justify-center shadow-sm">
                      {totalItems > 9 ? '9+' : totalItems}
                    </span>
                  )}
                </div>
                <span className="text-sm font-semibold">
                  {totalItems > 0
                    ? `${totalItems} producto${totalItems !== 1 ? 's' : ''} en carrito`
                    : 'Carrito vacío'}
                </span>
              </div>
              {totalItems > 0 ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">{formatCOP(total)}</span>
                  <ChevronUp size={16} className="opacity-70" />
                </div>
              ) : (
                <ChevronUp size={16} className="opacity-40" />
              )}
            </button>
          </div>

          {/* Móvil: bottom sheet */}
          {carritoAbierto && (
            <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end">
              <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={() => setCarritoAbierto(false)}
              />
              <div
                className="relative bg-white rounded-t-3xl flex flex-col"
                style={{ maxHeight: '88dvh' }}
              >
                <div className="flex-shrink-0 px-5 pt-3 pb-4 border-b border-gray-100">
                  <div className="flex justify-center mb-3">
                    <div className="w-10 h-1 bg-gray-200 rounded-full" />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShoppingCart size={18} className="text-blue-600" />
                      <p className="text-base font-bold text-gray-900">Carrito</p>
                      {totalItems > 0 && (
                        <span className="bg-blue-100 text-blue-600 text-xs font-semibold
                          px-2 py-0.5 rounded-full">
                          {totalItems}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => setCarritoAbierto(false)}
                      className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-400"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>
                <div className="overflow-y-auto flex-1 px-5 py-4">
                  <Carrito
                    sinHeader
                    onFacturar={() => { setModalFactura(true);  setCarritoAbierto(false); }}
                    onPrestar={() =>  { setModalPrestamo(true); setCarritoAbierto(false); }}
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <ModalFactura  open={modalFactura}  onClose={() => setModalFactura(false)}  />
      <ModalPrestamo open={modalPrestamo} onClose={() => setModalPrestamo(false)} />
      <ModalExportarInventario open={modalExportar} onClose={() => setModalExportar(false)} />

      {modalAgregar && !bloquearCreacion && (
        <ModalAgregarProducto onClose={handleCerrarModalAgregar} />
      )}
      {modalImportar && !bloquearCreacion && (
        <ModalImportarInventario onClose={handleCerrarModalImportar} />
      )}
    </div>
  );
}
