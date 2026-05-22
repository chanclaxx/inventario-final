import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { retomaDirecta as retomaDirectaApi } from '../../api/prestamos.api';
import { getProductosSerial, getProductosCantidad } from '../../api/productos.api';
import { formatCOP } from '../../utils/formatters';
import { Button }     from '../../components/ui/Button';
import { Modal }      from '../../components/ui/Modal';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { ArrowLeftRight, Package, ShoppingBag } from 'lucide-react';
import api from '../../api/axios.config';

function normalizarProductos(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return Object.values(data).flat();
}

export function ModalRetomaDirecta({ persona, sucursalId, onClose, onSuccess }) {
  const queryClient = useQueryClient();

  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
  });
  const coloresActivo          = configData?.colores_serial_activo === '1';
  const coloresLista           = (() => {
    try { return JSON.parse(configData?.colores_serial_lista || '[]'); } catch { return []; }
  })();
  const caracteristicasActivo  = configData?.caracteristicas_serial_activo === '1';
  const caracteristicasLista   = (() => {
    try { return JSON.parse(configData?.caracteristicas_serial_lista || '[]'); } catch { return []; }
  })();

  const [tipoRetoma,            setTipoRetoma]            = useState('serial');
  const [imeiRetoma,            setImeiRetoma]             = useState('');
  const [busquedaSerial,        setBusquedaSerial]         = useState('');
  const [productoSerialSel,     setProductoSerialSel]      = useState(null);
  const [colorRetoma,           setColorRetoma]            = useState('');
  const [caracteristicasRetoma, setCaracteristicasRetoma]  = useState({});
  const [busquedaCantidad,      setBusquedaCantidad]       = useState('');
  const [productoCantidadSel,   setProductoCantidadSel]    = useState(null);
  const [cantidadRetoma,        setCantidadRetoma]         = useState('1');
  const [valorRetoma,           setValorRetoma]            = useState('');
  const [ingresoInventario,     setIngresoInventario]      = useState(true);
  const [error,                 setError]                  = useState('');

  const { data: rawSerial   } = useQuery({
    queryKey: ['productos-serial'],
    queryFn:  () => getProductosSerial().then((r) => r.data.data),
  });
  const { data: rawCantidad } = useQuery({
    queryKey: ['productos-cantidad'],
    queryFn:  () => getProductosCantidad().then((r) => r.data.data),
  });

  const productosSerial   = normalizarProductos(rawSerial);
  const productosCantidad = normalizarProductos(rawCantidad);

  const filtradosSerial   = productosSerial.filter((p) =>
    (p.nombre ?? '').toLowerCase().includes(busquedaSerial.toLowerCase())
  );
  const filtradosCantidad = productosCantidad.filter((p) =>
    (p.nombre ?? '').toLowerCase().includes(busquedaCantidad.toLowerCase())
  );

  const resetCamposProducto = () => {
    setImeiRetoma(''); setBusquedaSerial(''); setProductoSerialSel(null); setColorRetoma('');
    setCaracteristicasRetoma({});
    setBusquedaCantidad(''); setProductoCantidadSel(null); setCantidadRetoma('1');
  };

  const retoma = Number(valorRetoma) || 0;

  const tipoApi = persona.tipo === 'companero' ? 'prestatario' : persona.tipo;

  const mutation = useMutation({
    mutationFn: () => retomaDirectaApi({
      tipo:                 tipoApi,
      persona_id:           persona.id,
      sucursal_id:          sucursalId || undefined,
      tipo_retoma:          tipoRetoma,
      imei_retoma:            tipoRetoma === 'serial' ? (imeiRetoma.trim() || null) : null,
      producto_serial_id:     tipoRetoma === 'serial' ? (productoSerialSel?.id || null) : null,
      color_retoma:           tipoRetoma === 'serial' ? (colorRetoma.trim() || null) : null,
      caracteristicas_retoma: tipoRetoma === 'serial' && caracteristicasActivo && caracteristicasLista.length > 0
        ? Object.fromEntries(Object.entries(caracteristicasRetoma).filter(([, v]) => v.trim()))
        : null,
      producto_cantidad_id: tipoRetoma === 'cantidad' ? (productoCantidadSel?.id || null) : null,
      cantidad_retoma:      tipoRetoma === 'cantidad' ? Number(cantidadRetoma || 1) : 1,
      valor_retoma:         retoma,
      ingreso_inventario:   ingresoInventario,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['prestamos'],                   exact: false });
      queryClient.invalidateQueries({ queryKey: ['inventario'],                  exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-serial'],            exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'],          exact: false });
      queryClient.invalidateQueries({ queryKey: ['saldo-sucursal'],              exact: false });
      queryClient.invalidateQueries({ queryKey: ['historial-saldo-sucursal'],    exact: false });
      onSuccess(res.data?.data);
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar la compra'),
  });

  const handleConfirmar = () => {
    setError('');
    if (!retoma || retoma <= 0) return setError('Ingresa el valor del artículo');
    if (ingresoInventario) {
      if (tipoRetoma === 'serial' && !productoSerialSel)
        return setError('Selecciona la línea de producto del artículo');
      if (tipoRetoma === 'serial' && !imeiRetoma.trim())
        return setError('Ingresa el IMEI del artículo');
      if (tipoRetoma === 'cantidad' && !productoCantidadSel)
        return setError('Selecciona el artículo');
    }
    mutation.mutate();
  };

  return (
    <Modal open onClose={onClose} title="Compra de artículo — generar saldo a favor" size="md">
      <div className="flex flex-col gap-4">

        {/* Persona */}
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-xs text-gray-400">Comprando artículo a</p>
          <p className="text-sm font-semibold text-gray-800">{persona.nombre}</p>
          <p className="text-xs text-emerald-600 mt-1">
            El valor del artículo se acreditará como saldo a favor
          </p>
        </div>

        {/* Producto que entrega */}
        <div className="flex flex-col gap-3 p-3 bg-purple-50 rounded-xl border border-purple-100">
          <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide">Producto que entrega</p>

          {/* Toggle serial / cantidad */}
          <div className="flex gap-2">
            {[
              { id: 'serial',   label: 'Con serial / IMEI', Icn: Package     },
              { id: 'cantidad', label: 'Por cantidad',       Icn: ShoppingBag },
            ].map((opt) => {
              const Icn = opt.Icn;
              return (
                <button key={opt.id} onClick={() => { setTipoRetoma(opt.id); resetCamposProducto(); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl
                    text-xs font-medium border transition-all
                    ${tipoRetoma === opt.id
                      ? 'bg-purple-100 border-purple-400 text-purple-800'
                      : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  <Icn size={13} /> {opt.label}
                </button>
              );
            })}
          </div>

          {/* Campos serial */}
          {tipoRetoma === 'serial' && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">IMEI del equipo retomado {ingresoInventario ? '*' : ''}</label>
                <input type="text" placeholder="Ej: 356789012345678" value={imeiRetoma}
                  onChange={(e) => setImeiRetoma(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
                    text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 transition-all" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">Línea de producto {ingresoInventario ? '*' : ''}</label>
                <input type="text" placeholder="Buscar modelo..." value={busquedaSerial}
                  onChange={(e) => { setBusquedaSerial(e.target.value); setProductoSerialSel(null); }}
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
                    text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 transition-all" />
                {busquedaSerial.length > 0 && !productoSerialSel && (
                  <div className="flex flex-col max-h-28 overflow-y-auto rounded-xl border border-gray-100 bg-white">
                    {filtradosSerial.length === 0
                      ? <p className="text-xs text-gray-400 px-3 py-2">Sin resultados</p>
                      : filtradosSerial.map((p) => (
                          <button key={p.id}
                            onClick={() => { setProductoSerialSel(p); setBusquedaSerial(p.nombre); }}
                            className="text-left px-3 py-2 text-sm hover:bg-purple-50 text-gray-700 border-b border-gray-50 last:border-0">
                            {p.nombre}
                          </button>
                        ))
                    }
                  </div>
                )}
                {productoSerialSel && <p className="text-xs text-purple-600">✓ {productoSerialSel.nombre}</p>}
              </div>
              {coloresActivo && coloresLista.length > 0 && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-600">Color (opcional)</label>
                  <div className="flex flex-wrap gap-2">
                    {coloresLista.map((c) => (
                      <button key={c} type="button"
                        onClick={() => setColorRetoma(colorRetoma === c ? '' : c)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
                          ${colorRetoma === c
                            ? 'bg-purple-100 border-purple-400 text-purple-800'
                            : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {caracteristicasActivo && caracteristicasLista.length > 0 && (
                <div className="flex flex-col gap-2">
                  {caracteristicasLista.map((campo) => (
                    <div key={campo} className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-gray-600">{campo} (opcional)</label>
                      <input type="text" placeholder={campo}
                        value={caracteristicasRetoma[campo] || ''}
                        onChange={(e) => setCaracteristicasRetoma((prev) => ({ ...prev, [campo]: e.target.value }))}
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
                          text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 transition-all" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Campos cantidad */}
          {tipoRetoma === 'cantidad' && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">Producto {ingresoInventario ? '*' : ''}</label>
                <input type="text" placeholder="Buscar producto..." value={busquedaCantidad}
                  onChange={(e) => { setBusquedaCantidad(e.target.value); setProductoCantidadSel(null); }}
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
                    text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 transition-all" />
                {busquedaCantidad.length > 0 && !productoCantidadSel && (
                  <div className="flex flex-col max-h-28 overflow-y-auto rounded-xl border border-gray-100 bg-white">
                    {filtradosCantidad.length === 0
                      ? <p className="text-xs text-gray-400 px-3 py-2">Sin resultados</p>
                      : filtradosCantidad.map((p) => (
                          <button key={p.id}
                            onClick={() => { setProductoCantidadSel(p); setBusquedaCantidad(p.nombre); }}
                            className="text-left px-3 py-2 text-sm hover:bg-purple-50 text-gray-700 border-b border-gray-50 last:border-0">
                            {p.nombre}
                            <span className="text-xs text-gray-400 ml-2">Stock: {p.stock}</span>
                          </button>
                        ))
                    }
                  </div>
                )}
                {productoCantidadSel && <p className="text-xs text-purple-600">✓ {productoCantidadSel.nombre}</p>}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">Cantidad</label>
                <input type="number" min="1" placeholder="1" value={cantidadRetoma}
                  onChange={(e) => setCantidadRetoma(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
                    text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 transition-all" />
              </div>
            </div>
          )}

          {/* Toggle ingreso inventario */}
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={ingresoInventario}
              onChange={(e) => setIngresoInventario(e.target.checked)}
              className="rounded accent-purple-600" />
            Ingresar al inventario
          </label>
        </div>

        {/* Valor */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Valor del artículo *</label>
          <InputMoneda value={valorRetoma} onChange={setValorRetoma} placeholder="0" autoFocus
            className="w-full px-3 py-2 bg-gray-100 rounded-xl text-sm
              focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white transition-all" />
        </div>

        {/* Resumen */}
        {retoma > 0 && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex flex-col gap-1.5">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Valor del artículo:</span>
              <span className="font-medium text-purple-700">{formatCOP(retoma)}</span>
            </div>
            <div className="flex justify-between text-sm font-semibold text-emerald-700 mt-1 pt-1 border-t border-emerald-200">
              <span>Saldo a favor a acreditar:</span>
              <span>{formatCOP(retoma)}</span>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutation.isPending} onClick={handleConfirmar}>
            <ArrowLeftRight size={14} /> Registrar compra
          </Button>
        </div>
      </div>
    </Modal>
  );
}
