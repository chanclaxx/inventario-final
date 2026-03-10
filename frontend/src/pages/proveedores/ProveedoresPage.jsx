import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getProveedores, crearProveedor, actualizarProveedor } from '../../api/proveedores.api';
import { getComprasByProveedor, getCompraById } from '../../api/compras.api';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { Spinner } from '../../components/ui/Spinner';
import { EmptyState } from '../../components/ui/EmptyState';
import { SearchInput } from '../../components/ui/SearchInput';
import { ModalCompra } from './ModalCompra';
import {
  Truck, Plus, ShoppingCart, ChevronRight,
  ChevronLeft, Package, Hash
} from 'lucide-react';

// ── Modal detalle de compra ───────────────────────────────────
function ModalDetalleCompra({ compraId, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['compra-detalle', compraId],
    queryFn: () => getCompraById(compraId).then((r) => r.data.data),
    enabled: !!compraId,
  });

  return (
    <Modal open onClose={onClose} title={`Compra #${String(compraId).padStart(5, '0')}`} size="lg">
      {isLoading ? <Spinner className="py-10" /> : (
        <div className="flex flex-col gap-4">

          {/* Info general */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-400 mb-0.5">Fecha</p>
              <p className="text-sm font-medium text-gray-800">{formatFechaHora(data?.fecha)}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-400 mb-0.5">Estado</p>
              <Badge variant={data?.estado === 'Completada' ? 'green' : data?.estado === 'Pendiente' ? 'yellow' : 'red'}>
                {data?.estado}
              </Badge>
            </div>
            {data?.numero_factura && (
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400 mb-0.5">N° Factura</p>
                <p className="text-sm font-medium text-gray-800">{data.numero_factura}</p>
              </div>
            )}
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-400 mb-0.5">Registrado por</p>
              <p className="text-sm font-medium text-gray-800">{data?.usuario_nombre || '—'}</p>
            </div>
          </div>

          {/* Productos */}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-gray-700">Productos recibidos</p>
            {(data?.lineas || []).length === 0 ? (
              <p className="text-sm text-gray-400 italic">Sin líneas registradas</p>
            ) : (
              <div className="flex flex-col gap-2">
                {(data?.lineas || []).map((l) => (
                  <div key={l.id} className="bg-gray-50 rounded-xl p-3 flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-800">{l.nombre_producto}</p>
                      {l.imei && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Hash size={10} className="text-gray-400" />
                          <p className="text-xs text-gray-400 font-mono">{l.imei}</p>
                        </div>
                      )}
                      {!l.imei && (
                        <p className="text-xs text-gray-400">Cantidad: {l.cantidad}</p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-gray-400">
                        {l.cantidad} × {formatCOP(l.precio_unitario)}
                      </p>
                      <p className="text-sm font-semibold text-gray-900">
                        {formatCOP(l.cantidad * l.precio_unitario)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Total */}
          <div className="flex justify-between items-center bg-blue-50 rounded-xl px-4 py-3">
            <span className="text-sm font-semibold text-gray-700">Total de la compra</span>
            <span className="text-base font-bold text-blue-700">{formatCOP(data?.total)}</span>
          </div>

          {data?.notas && (
            <p className="text-xs text-gray-400 italic">Notas: {data.notas}</p>
          )}

          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        </div>
      )}
    </Modal>
  );
}

// ── Vista historial de un proveedor ──────────────────────────
function HistorialProveedor({ proveedor, onVolver, onNuevaCompra }) {
  const [compraDetalle, setCompraDetalle] = useState(null);

  const { data: comprasData, isLoading } = useQuery({
    queryKey: ['compras-proveedor', proveedor.id],
    queryFn: () => getComprasByProveedor(proveedor.id).then((r) => r.data.data),
  });

  const compras = comprasData || [];
  const totalComprado = compras.reduce((s, c) => s + Number(c.total || 0), 0);

  return (
    <div className="flex flex-col gap-4">

      {/* Header con back */}
      <div className="flex items-center gap-3">
        <button
          onClick={onVolver}
          className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1">
          <h2 className="text-base font-bold text-gray-900">{proveedor.nombre}</h2>
          <p className="text-xs text-gray-400">Historial de compras</p>
        </div>
        <Button size="sm" onClick={onNuevaCompra}>
          <ShoppingCart size={14} /> Nueva compra
        </Button>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-blue-50 rounded-xl p-3">
          <p className="text-xs text-blue-400 mb-0.5">Total comprado</p>
          <p className="text-base font-bold text-blue-700">{formatCOP(totalComprado)}</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-xs text-gray-400 mb-0.5">N° compras</p>
          <p className="text-base font-bold text-gray-800">{compras.length}</p>
        </div>
      </div>

      {/* Lista compras */}
      {isLoading ? <Spinner className="py-20" /> : compras.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          titulo="Sin compras"
          descripcion="Aún no hay compras registradas a este proveedor"
        />
      ) : (
        <div className="flex flex-col gap-2">
          {compras.map((c) => (
            <button
              key={c.id}
              onClick={() => setCompraDetalle(c.id)}
              className="bg-white border border-gray-100 rounded-xl p-3 flex items-center
                justify-between hover:border-blue-200 hover:bg-blue-50 transition-all text-left"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-800">
                    #{String(c.id).padStart(5, '0')}
                  </span>
                  <Badge variant={
                    c.estado === 'Completada' ? 'green' :
                    c.estado === 'Pendiente'  ? 'yellow' : 'red'
                  }>
                    {c.estado}
                  </Badge>
                </div>
                {c.numero_factura && (
                  <p className="text-xs text-gray-400 mt-0.5">Factura: {c.numero_factura}</p>
                )}
                <p className="text-xs text-gray-400">{formatFechaHora(c.fecha)}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-sm font-bold text-gray-900">{formatCOP(c.total)}</span>
                <ChevronRight size={14} className="text-gray-400" />
              </div>
            </button>
          ))}
        </div>
      )}

      {compraDetalle && (
        <ModalDetalleCompra
          compraId={compraDetalle}
          onClose={() => setCompraDetalle(null)}
        />
      )}
    </div>
  );
}

// ── Modal proveedor ───────────────────────────────────────────
function ModalProveedor({ proveedor, onClose }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    nombre:    proveedor?.nombre    || '',
    nit:       proveedor?.nit       || '',
    telefono:  proveedor?.telefono  || '',
    email:     proveedor?.email     || '',
    contacto:  proveedor?.contacto  || '',
    direccion: proveedor?.direccion || '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => proveedor
      ? actualizarProveedor(proveedor.id, form)
      : crearProveedor(form),
    onSuccess: () => {
      queryClient.invalidateQueries(['proveedores']);
      onClose();
    },
    onError: (e) => setError(e.response?.data?.error || 'Error'),
  });

  const handleKeyDown = (e, siguienteId) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (siguienteId) document.getElementById(siguienteId)?.focus();
      else mutation.mutate();
    }
  };

  return (
    <Modal open onClose={onClose} title={proveedor ? 'Editar Proveedor' : 'Nuevo Proveedor'} size="md">
      <div className="flex flex-col gap-3">
        <Input id="prov-nombre"   label="Nombre *"  value={form.nombre}   onChange={(e) => setForm({ ...form, nombre: e.target.value })}   onKeyDown={(e) => handleKeyDown(e, 'prov-nit')} />
        <Input id="prov-nit"      label="NIT"       value={form.nit}      onChange={(e) => setForm({ ...form, nit: e.target.value })}      onKeyDown={(e) => handleKeyDown(e, 'prov-tel')} />
        <Input id="prov-tel"      label="Teléfono"  value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} onKeyDown={(e) => handleKeyDown(e, 'prov-email')} />
        <Input id="prov-email"    label="Email"     value={form.email}    onChange={(e) => setForm({ ...form, email: e.target.value })}    onKeyDown={(e) => handleKeyDown(e, 'prov-contacto')} />
        <Input id="prov-contacto" label="Contacto"  value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })} onKeyDown={(e) => handleKeyDown(e, null)} />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2 mt-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            {proveedor ? 'Guardar' : 'Crear'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Página principal ──────────────────────────────────────────
export default function ProveedoresPage() {
  const [busqueda,        setBusqueda]        = useState('');
  const [modalProveedor,  setModalProveedor]  = useState(null);
  const [proveedorEditar, setProveedorEditar] = useState(null);
  const [proveedorVer,    setProveedorVer]    = useState(null); // historial
  const [modalCompra,     setModalCompra]     = useState(null);

  const { data: proveedoresData, isLoading } = useQuery({
    queryKey: ['proveedores'],
    queryFn: () => getProveedores().then((r) => r.data.data),
  });

  const proveedores = (proveedoresData || []).filter((p) =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  // Vista historial de proveedor seleccionado
  if (proveedorVer) {
    return (
      <>
        <HistorialProveedor
          proveedor={proveedorVer}
          onVolver={() => setProveedorVer(null)}
          onNuevaCompra={() => setModalCompra(proveedorVer)}
        />
        {modalCompra && (
          <ModalCompra
            proveedor={modalCompra}
            onClose={() => setModalCompra(null)}
          />
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Proveedores</h1>
          <p className="text-sm text-gray-400 mt-0.5">{proveedores.length} proveedor(es)</p>
        </div>
        <Button size="sm" onClick={() => setModalProveedor(true)}>
          <Plus size={16} /> Nuevo
        </Button>
      </div>

      <SearchInput value={busqueda} onChange={setBusqueda} placeholder="Buscar proveedor..." />

      {/* Lista */}
      {isLoading ? <Spinner className="py-20" /> : proveedores.length === 0 ? (
        <EmptyState icon={Truck} titulo="Sin proveedores" />
      ) : (
        proveedores.map((p) => (
          <div key={p.id} className="bg-white border border-gray-100 rounded-2xl p-4
            flex items-center justify-between gap-3">
            <button
              onClick={() => setProveedorVer(p)}
              className="flex-1 text-left min-w-0"
            >
              <p className="font-semibold text-gray-900">{p.nombre}</p>
              <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                {p.nit      && <span className="text-xs text-gray-400">NIT: {p.nit}</span>}
                {p.telefono && <span className="text-xs text-gray-400">Tel: {p.telefono}</span>}
                {p.contacto && <span className="text-xs text-gray-400">{p.contacto}</span>}
              </div>
            </button>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button size="sm" onClick={() => { setModalCompra(p); }}>
                <ShoppingCart size={14} /> Compra
              </Button>
              <button
                onClick={() => setProveedorEditar(p)}
                className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <Package size={16} />
              </button>
            </div>
          </div>
        ))
      )}

      {/* Modales */}
      {modalProveedor && (
        <ModalProveedor onClose={() => setModalProveedor(null)} />
      )}
      {proveedorEditar && (
        <ModalProveedor proveedor={proveedorEditar} onClose={() => setProveedorEditar(null)} />
      )}
      {modalCompra && (
        <ModalCompra proveedor={modalCompra} onClose={() => setModalCompra(null)} />
      )}
    </div>
  );
}