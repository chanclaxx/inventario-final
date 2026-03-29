import { useState, useCallback, useEffect } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Modal }                    from '../../components/ui/Modal';
import { Button }                   from '../../components/ui/Button';
import { Input }                    from '../../components/ui/Input';
import { Badge }                    from '../../components/ui/Badge';
import { InputMoneda }              from '../../components/ui/InputMoneda';
import { formatCOP }                from '../../utils/formatters';
import { ModalConflictoCedula }     from '../../components/ui/ModalConflictoCedula';
import { useCedulaCliente }         from '../../hooks/useCedulaCliente';
import { crearFactura, getFacturaById } from '../../api/facturas.api';
import { getGarantiasPorFactura }   from '../../api/garantias.api';
import { buscarPorCedula }          from '../../api/clientes.api';
import {
  getProductosSerial,
  getProductosCantidad,
  verificarImei as verificarImeiApi,
} from '../../api/productos.api';
import { getDomiciliarios, crearDomiciliario } from '../../api/domiciliarios.api';
import { FacturaTermica }    from '../../components/FacturaTermica';
import { useSucursalKey }    from '../../hooks/useSucursalKey';
import api                   from '../../api/axios.config';
import useCarritoStore       from '../../store/carritoStore';
import { SeccionCredito, CREDITO_VACIO } from './SeccionCredito';
import {
  User, Users, Package, ShoppingBag,
  Loader2, CheckCircle, XCircle, AlertCircle,
  AlertTriangle, X, Plus, Trash2, RefreshCw,
  Bike, ChevronLeft,
} from 'lucide-react';

// ─── Constantes ───────────────────────────────────────────────────────────────

const METODOS_PAGO = [
  { id: 'Efectivo',      label: 'Efectivo'      },
  { id: 'Nequi',         label: 'Nequi'         },
  { id: 'Daviplata',     label: 'Daviplata'     },
  { id: 'Transferencia', label: 'Transferencia' },
  { id: 'Tarjeta',       label: 'Tarjeta'       },
];

const RETOMA_VACIA = () => ({
  _key:                 crypto.randomUUID(),
  tipo_retoma:          'serial',
  descripcion:          '',
  valor_retoma:         '',
  cantidad_retoma:      '1',
  ingreso_inventario:   false,
  imei:                 '',
  producto_serial_id:   null,
  nombre_producto:      '',
  producto_cantidad_id: null,
  reactivar_serial_id:  null,
});

const DOMICILIO_VACIO = () => ({
  activo:            false,
  domiciliario_id:   null,
  direccion_entrega: '',
  notas:             '',
});

const IMEI_MIN_LENGTH = 8;

// ─── Utilidades ───────────────────────────────────────────────────────────────

function normalizarProductos(data) {
  if (Array.isArray(data)) return data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  return [];
}

function calcularValorRetoma(retoma) {
  if (retoma.tipo_retoma === 'cantidad') {
    return Number(retoma.valor_retoma || 0) * Number(retoma.cantidad_retoma || 1);
  }
  return Number(retoma.valor_retoma || 0);
}

function buildPayloadFactura({ tipoCliente, form, items, totalNeto, metodosSeleccionados, montos, retomas, domicilio, credito }) {
  const pagosPorDefecto = totalNeto <= 0
    ? [{ metodo: metodosSeleccionados[0] || 'Efectivo', valor: totalNeto }]
    : null;

  const pagos = pagosPorDefecto ?? (
    metodosSeleccionados.length === 1
      ? [{ metodo: metodosSeleccionados[0], valor: credito.activo ? Number(credito.cuota_inicial || 0) : totalNeto }]
      : metodosSeleccionados
          .filter((id) => Number(montos[id] || 0) > 0)
          .map((id) => ({ metodo: id, valor: Number(montos[id]) }))
  );

  const lineas = items.map((item) => ({
    nombre_producto: item.nombre,
    imei:            item.imei        || null,
    producto_id:     item.imei ? null : (item.producto_id || null),
    cantidad:        item.cantidad    || 1,
    precio:          item.precioFinal,
  }));

  const retomasPayload = retomas.map((r) => ({
    tipo_retoma:          r.tipo_retoma,
    descripcion:          r.descripcion,
    valor_retoma:         calcularValorRetoma(r),
    ingreso_inventario:   r.ingreso_inventario,
    imei:                 r.tipo_retoma === 'serial'   ? r.imei                               : null,
    nombre_producto:      r.tipo_retoma === 'serial'   ? (r.nombre_producto || r.descripcion) : r.nombre_producto,
    producto_serial_id:   r.tipo_retoma === 'serial'   ? r.producto_serial_id                 : null,
    producto_cantidad_id: r.tipo_retoma === 'cantidad' ? r.producto_cantidad_id               : null,
    cantidad_retoma:      r.tipo_retoma === 'cantidad' ? Number(r.cantidad_retoma || 1)        : 1,
    reactivar_serial_id:  r.reactivar_serial_id || null,
  }));

  const domicilioPayload = (domicilio.activo && domicilio.domiciliario_id)
    ? {
        domiciliario_id:   domicilio.domiciliario_id,
        direccion_entrega: domicilio.direccion_entrega || null,
        notas:             domicilio.notas             || null,
      }
    : undefined;

  return {
    nombre_cliente: form.nombre,
    cedula:         tipoCliente === 'cliente' ? form.cedula  : 'COMPANERO',
    celular:        tipoCliente === 'cliente' ? form.celular : '0000000000',
    email:          tipoCliente === 'cliente' ? (form.email     || null) : null,
    direccion:      tipoCliente === 'cliente' ? (form.direccion || null) : null,
    notas:          form.notas || null,
    lineas,
    pagos,
    retomas:        retomasPayload,
    domicilio:      domicilioPayload,
    es_credito:     credito.activo || false,
    cuota_inicial:  credito.activo ? Number(credito.cuota_inicial || 0) : 0,
  };
}

// ─── Hook verificar IMEI ──────────────────────────────────────────────────────

function useVerificarImei() {
  const [estado, setEstado] = useState({ tipo: 'idle' });

  const verificar = useCallback(async (imei) => {
    const imeiLimpio = imei?.trim() ?? '';
    if (imeiLimpio.length < IMEI_MIN_LENGTH) { setEstado({ tipo: 'idle' }); return null; }
    setEstado({ tipo: 'cargando' });
    try {
      const { data } = await verificarImeiApi(imeiLimpio);
      if (data.data.existe) {
        setEstado({ tipo: 'encontrado', serial: data.data.serial });
        return data.data.serial;
      }
      setEstado({ tipo: 'libre' });
      return null;
    } catch (err) {
      setEstado({ tipo: 'error', mensaje: err.response?.data?.error || 'Error al verificar IMEI' });
      return null;
    }
  }, []);

  const limpiar = useCallback(() => setEstado({ tipo: 'idle' }), []);
  return { estado, verificar, limpiar };
}

// ─── Indicadores IMEI ─────────────────────────────────────────────────────────

function ImeiEstadoIcono({ estado }) {
  if (estado.tipo === 'cargando')   return <Loader2     size={15} className="text-gray-400 animate-spin" />;
  if (estado.tipo === 'libre')      return <CheckCircle size={15} className="text-green-500" />;
  if (estado.tipo === 'encontrado') return <AlertCircle size={15} className="text-amber-500" />;
  if (estado.tipo === 'error')      return <XCircle     size={15} className="text-red-400" />;
  return null;
}

function AvisoImeiRetoma({ estado, nombreCliente }) {
  if (estado.tipo === 'cargando') return <p className="text-xs text-gray-400">Verificando IMEI...</p>;
  if (estado.tipo === 'libre')    return <p className="text-xs text-green-600">✓ IMEI disponible — se creará en el inventario</p>;
  if (estado.tipo === 'error')    return <p className="text-xs text-red-500">{estado.mensaje}</p>;

  if (estado.tipo === 'encontrado') {
    const serial = estado.serial;
    const estaDisponible = !serial.vendido && !serial.prestado;
    if (estaDisponible) {
      return (
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
          <Package size={13} className="text-blue-500 flex-shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <p className="text-xs font-medium text-blue-700">Ya está en inventario como disponible</p>
            <p className="text-xs text-blue-500">
              Se actualizará el cliente origen a <span className="font-semibold">{nombreCliente || 'el cliente de la retoma'}</span>.
            </p>
          </div>
        </div>
      );
    }
    const estadoLabel = serial.vendido ? 'vendido' : 'prestado';
    return (
      <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
        <RefreshCw size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="flex flex-col gap-0.5">
          <p className="text-xs font-medium text-amber-700">IMEI {estadoLabel} — se reactivará automáticamente</p>
          <p className="text-xs text-amber-600">
            Producto: <span className="font-medium">{serial.producto_nombre}</span>
            {serial.marca ? ` · ${serial.marca}` : ''}
          </p>
          <p className="text-xs text-amber-500">
            Se registrará a nombre de <span className="font-semibold">{nombreCliente || 'el cliente de la retoma'}</span>.
          </p>
        </div>
      </div>
    );
  }
  return null;
}

// ─── Sección domicilio ────────────────────────────────────────────────────────

function SeccionDomicilio({ domicilio, onChange }) {
  const [modoCrear, setModoCrear] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [telefonoNuevo, setTelefonoNuevo] = useState('');
  const queryClient = useQueryClient();

  const { data: domiciliariosData, isLoading } = useQuery({
    queryKey: ['domiciliarios'],
    queryFn:  () => getDomiciliarios().then((r) => r.data.data),
    enabled:  domicilio.activo,
  });

  const mutCrear = useMutation({
    mutationFn: (datos) => crearDomiciliario(datos),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['domiciliarios'], exact: false });
      onChange({ ...domicilio, domiciliario_id: res.data.data.id });
      setModoCrear(false);
      setNombreNuevo('');
      setTelefonoNuevo('');
    },
  });

  const domiciliarios = domiciliariosData || [];
  const seleccionado  = domiciliarios.find((d) => d.id === domicilio.domiciliario_id) || null;

  const set = (campo, valor) => onChange({ ...domicilio, [campo]: valor });

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => onChange({ ...DOMICILIO_VACIO(), activo: !domicilio.activo })}
        className={`w-full flex items-center gap-2 py-2.5 rounded-xl text-sm font-medium
          border transition-all
          ${domicilio.activo
            ? 'bg-orange-50 border-orange-300 text-orange-700'
            : 'bg-gray-50 border-gray-200 text-gray-600'}`}
      >
        <Bike size={15} className="ml-3" />
        {domicilio.activo ? '✓ Pedido a domicilio' : '+ Es domicilio'}
      </button>

      {domicilio.activo && (
        <div className="flex flex-col gap-3 p-3 bg-orange-50 rounded-xl border border-orange-100">

          <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">
            Domiciliario
          </p>

          {seleccionado ? (
            <div className="flex items-center justify-between bg-white border border-orange-200 rounded-xl px-3 py-2">
              <div>
                <p className="text-sm font-medium text-orange-800">{seleccionado.nombre}</p>
                {seleccionado.telefono && (
                  <p className="text-xs text-orange-500">{seleccionado.telefono}</p>
                )}
              </div>
              <button
                onClick={() => set('domiciliario_id', null)}
                className="text-xs text-orange-400 hover:text-orange-600"
              >
                Cambiar
              </button>
            </div>
          ) : modoCrear ? (
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { setModoCrear(false); setNombreNuevo(''); setTelefonoNuevo(''); }}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 w-fit"
              >
                <ChevronLeft size={13} /> Volver
              </button>
              <Input
                label="Nombre del domiciliario"
                placeholder="Nombre..."
                value={nombreNuevo}
                onChange={(e) => setNombreNuevo(e.target.value)}
                autoFocus
              />
              <Input
                label="Teléfono (opcional)"
                placeholder="3001234567"
                value={telefonoNuevo}
                onChange={(e) => setTelefonoNuevo(e.target.value)}
              />
              <Button
                size="sm"
                loading={mutCrear.isPending}
                disabled={!nombreNuevo.trim()}
                onClick={() => mutCrear.mutate({ nombre: nombreNuevo.trim(), telefono: telefonoNuevo || null })}
              >
                Guardar domiciliario
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {isLoading ? (
                <p className="text-xs text-gray-400 py-2">Cargando...</p>
              ) : domiciliarios.length === 0 ? (
                <p className="text-xs text-gray-400 px-1">Sin domiciliarios registrados</p>
              ) : (
                <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
                  {domiciliarios.filter((d) => d.activo).map((d) => {
                    const domId = d.id;
                    return (
                      <button
                        key={domId}
                        onClick={() => set('domiciliario_id', domId)}
                        className="text-left px-3 py-2 rounded-xl border border-orange-100
                          bg-white hover:border-orange-300 hover:bg-orange-50/40
                          transition-colors text-sm text-gray-800"
                      >
                        <span className="font-medium">{d.nombre}</span>
                        {d.telefono && (
                          <span className="text-xs text-gray-400 ml-2">{d.telefono}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              <button
                onClick={() => setModoCrear(true)}
                className="flex items-center gap-1 text-xs text-orange-500 hover:text-orange-700 w-fit mt-1"
              >
                <Plus size={13} /> Agregar domiciliario
              </button>
            </div>
          )}

          {seleccionado && (
            <>
              <Input
                label="Dirección de entrega"
                placeholder="Calle 10 # 5-20 (opcional)"
                value={domicilio.direccion_entrega}
                onChange={(e) => set('direccion_entrega', e.target.value)}
              />
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">
                  Notas para el domiciliario <span className="text-gray-400 font-normal">(opcional)</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="Instrucciones de entrega..."
                  value={domicilio.notas}
                  onChange={(e) => set('notas', e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-orange-200 rounded-xl
                    text-sm placeholder-gray-400 focus:outline-none focus:ring-2
                    focus:ring-orange-400 focus:bg-white transition-all resize-none"
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ItemRetoma ───────────────────────────────────────────────────────────────

function ItemRetoma({ retoma, index, total, productosSerial, productosCantidad,
  onChange, onRemove, nombreCliente }) {

  const [busqueda, setBusqueda]        = useState('');
  const { estado, verificar, limpiar } = useVerificarImei();

  const listaSerial   = normalizarProductos(productosSerial);
  const listaCantidad = normalizarProductos(productosCantidad);

  const filtradosSerial   = listaSerial.filter((p) =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );
  const filtradosCantidad = listaCantidad.filter((p) =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );

  const set = (campo, valor) => onChange(retoma._key, campo, valor);
  const valorTotal = calcularValorRetoma(retoma);

  const handleImeiChange = (e) => {
    set('imei', e.target.value);
    set('reactivar_serial_id', null);
    set('producto_serial_id', retoma.producto_serial_id);
    limpiar();
  };

  const handleCheckboxInventario = async (marcado) => {
    set('ingreso_inventario', marcado);
    if (!marcado) { set('reactivar_serial_id', null); limpiar(); return; }
    const imeiActual = retoma.imei?.trim() ?? '';
    if (retoma.tipo_retoma !== 'serial' || imeiActual.length < IMEI_MIN_LENGTH) return;
    const serial = await verificar(imeiActual);
    if (!serial) return;
    set('reactivar_serial_id', serial.id);
    if (serial.producto_id) {
      set('producto_serial_id', serial.producto_id);
      set('nombre_producto', serial.producto_nombre || '');
    }
  };

  useEffect(() => {
    if (!retoma.ingreso_inventario) return;
    const imeiActual = retoma.imei?.trim() ?? '';
    if (retoma.tipo_retoma !== 'serial' || imeiActual.length < IMEI_MIN_LENGTH) {
      limpiar(); set('reactivar_serial_id', null); return;
    }
    let activo = true;
    verificar(imeiActual).then((serial) => {
      if (!activo) return;
      if (serial) {
        set('reactivar_serial_id', serial.id);
        if (serial.producto_id) {
          set('producto_serial_id', serial.producto_id);
          set('nombre_producto', serial.producto_nombre || '');
        }
      } else {
        set('reactivar_serial_id', null);
      }
    });
    return () => { activo = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retoma.imei, retoma.ingreso_inventario]);

  return (
    <div className="flex flex-col gap-3 p-3 bg-purple-50 rounded-xl border border-purple-100">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-purple-700">Retoma {index + 1}</span>
        {total > 1 && (
          <button onClick={() => onRemove(retoma._key)}
            className="p-1 rounded-lg hover:bg-red-50 text-purple-300 hover:text-red-400 transition-colors">
            <Trash2 size={13} />
          </button>
        )}
      </div>

      <div className="flex gap-2">
        {[
          { id: 'serial',   label: 'Con serial / IMEI', Icn: Package     },
          { id: 'cantidad', label: 'Por cantidad',       Icn: ShoppingBag },
        ].map((opt) => {
          const OptIcon = opt.Icn;
          return (
            <button key={opt.id}
              onClick={() => {
                set('tipo_retoma', opt.id);
                set('imei', '');
                set('producto_serial_id', null);
                set('producto_cantidad_id', null);
                set('nombre_producto', '');
                set('ingreso_inventario', false);
                set('reactivar_serial_id', null);
                setBusqueda('');
                limpiar();
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl
                text-xs font-medium border transition-all
                ${retoma.tipo_retoma === opt.id
                  ? 'bg-purple-100 border-purple-400 text-purple-800'
                  : 'bg-white border-gray-200 text-gray-500'}`}>
              <OptIcon size={13} /> {opt.label}
            </button>
          );
        })}
      </div>

      {retoma.tipo_retoma === 'serial' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">IMEI del equipo retomado</label>
            <div className="relative">
              <input type="text" placeholder="Ej: 356789012345678"
                value={retoma.imei} onChange={handleImeiChange}
                className="w-full px-3 py-2 pr-9 bg-white border border-gray-200 rounded-xl
                  text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 transition-all" />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
                <ImeiEstadoIcono estado={estado} />
              </span>
            </div>
            {retoma.ingreso_inventario && (
              <AvisoImeiRetoma estado={estado} nombreCliente={nombreCliente} />
            )}
          </div>

          <div>
            <p className="text-xs font-medium text-gray-600 mb-1">
              Línea de producto <span className="text-gray-400 font-normal">(opcional)</span>
            </p>
            <input type="text" placeholder="Buscar modelo..."
              value={busqueda}
              onChange={(e) => {
                setBusqueda(e.target.value);
                set('producto_serial_id', null);
                set('nombre_producto', '');
              }}
              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
                text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 mb-1" />
            {busqueda.length > 0 && (
              <div className="flex flex-col gap-1 max-h-28 overflow-y-auto rounded-xl border border-gray-100 bg-white">
                {filtradosSerial.length === 0
                  ? <p className="text-xs text-gray-400 px-3 py-2">Sin resultados</p>
                  : filtradosSerial.map((p) => {
                      const pid = p.id;
                      return (
                        <button key={pid}
                          onClick={() => {
                            set('producto_serial_id', pid);
                            set('nombre_producto', p.nombre);
                            setBusqueda(p.nombre);
                          }}
                          className={`text-left px-3 py-2 text-sm transition-all
                            ${retoma.producto_serial_id === pid
                              ? 'bg-purple-100 text-purple-800'
                              : 'hover:bg-gray-50 text-gray-700'}`}>
                          {p.nombre}
                          <span className="text-xs text-gray-400 ml-2">{p.disponibles} disp.</span>
                        </button>
                      );
                    })
                }
              </div>
            )}
            {retoma.producto_serial_id && (
              <p className="text-xs text-purple-600 mt-1">✓ {retoma.nombre_producto}</p>
            )}
          </div>
        </div>
      )}

      {retoma.tipo_retoma === 'cantidad' && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-gray-600">Producto en inventario</p>
          <input type="text" placeholder="Buscar producto..."
            value={busqueda}
            onChange={(e) => {
              setBusqueda(e.target.value);
              set('producto_cantidad_id', null);
              set('nombre_producto', '');
            }}
            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
              text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 mb-1" />
          {busqueda.length > 0 && (
            <div className="flex flex-col gap-1 max-h-28 overflow-y-auto rounded-xl border border-gray-100 bg-white">
              {filtradosCantidad.length === 0
                ? <p className="text-xs text-gray-400 px-3 py-2">Sin resultados</p>
                : filtradosCantidad.map((p) => {
                    const pid = p.id;
                    return (
                      <button key={pid}
                        onClick={() => {
                          set('producto_cantidad_id', pid);
                          set('nombre_producto', p.nombre);
                          setBusqueda(p.nombre);
                        }}
                        className={`text-left px-3 py-2 text-sm transition-all
                          ${retoma.producto_cantidad_id === pid
                            ? 'bg-purple-100 text-purple-800'
                            : 'hover:bg-gray-50 text-gray-700'}`}>
                        {p.nombre}
                        <span className="text-xs text-gray-400 ml-2">Stock: {p.stock}</span>
                      </button>
                    );
                  })
              }
            </div>
          )}
          {retoma.producto_cantidad_id && (
            <p className="text-xs text-purple-600">✓ {retoma.nombre_producto}</p>
          )}
          <Input label="Cantidad retomada" type="number" min="1" placeholder="1"
            value={retoma.cantidad_retoma}
            onChange={(e) => set('cantidad_retoma', e.target.value)} />
        </div>
      )}

      <Input label="Descripción" placeholder="Ej: iPhone 12 Pro en buen estado"
        value={retoma.descripcion}
        onChange={(e) => set('descripcion', e.target.value)} />

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-600">
          {retoma.tipo_retoma === 'cantidad' ? 'Precio unitario' : 'Valor retoma'}
        </label>
        <InputMoneda value={retoma.valor_retoma}
          onChange={(val) => set('valor_retoma', val)} placeholder="0"
          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl
            text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
      </div>

      {retoma.tipo_retoma === 'cantidad' && Number(retoma.cantidad_retoma) > 1 && Number(retoma.valor_retoma) > 0 && (
        <div className="flex justify-between text-xs text-purple-700 bg-purple-100 rounded-lg px-3 py-1.5">
          <span>{retoma.cantidad_retoma} × {formatCOP(Number(retoma.valor_retoma))}</span>
          <span className="font-semibold">{formatCOP(valorTotal)}</span>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
        <input type="checkbox" checked={retoma.ingreso_inventario}
          onChange={(e) => handleCheckboxInventario(e.target.checked)}
          className="rounded accent-purple-600" />
        Ingresa al inventario
      </label>
    </div>
  );
}

// ─── SelectorPagos ────────────────────────────────────────────────────────────

function SelectorPagos({ metodosSeleccionados, montos, totalNeto, onToggleMetodo, onCambioMonto }) {
  const cantidadSeleccionada = metodosSeleccionados.length;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium text-gray-700">Método de pago</p>
      <div className="flex flex-wrap gap-2">
        {METODOS_PAGO.map((metodo) => {
          const metodoId     = metodo.id;
          const metodoLabel  = metodo.label;
          const seleccionado = metodosSeleccionados.includes(metodoId);
          return (
            <button key={metodoId} type="button" onClick={() => onToggleMetodo(metodoId)}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-all
                ${seleccionado
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300'}`}>
              {metodoLabel}
            </button>
          );
        })}
      </div>
      {cantidadSeleccionada >= 2 && (
        <div className="flex flex-col gap-2 pt-1">
          {metodosSeleccionados.map((metodoId) => {
            const metodo      = METODOS_PAGO.find((m) => m.id === metodoId);
            const metodoLabel = metodo ? metodo.label : metodoId;
            return (
              <div key={metodoId} className="flex items-center gap-3">
                <span className="text-sm text-gray-600 w-28 flex-shrink-0">{metodoLabel}</span>
                <InputMoneda value={montos[metodoId] || ''} onChange={(val) => onCambioMonto(metodoId, val)} placeholder="0"
                  className="flex-1 px-3 py-2 bg-gray-100 rounded-xl text-sm
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all" />
              </div>
            );
          })}
        </div>
      )}
      {cantidadSeleccionada === 1 && (
        <p className="text-xs text-gray-400">
          Pago completo de <span className="font-semibold text-gray-600">{formatCOP(totalNeto)}</span> en {metodosSeleccionados[0]}
        </p>
      )}
      {cantidadSeleccionada === 0 && (
        <p className="text-xs text-gray-400">Selecciona al menos un método de pago</p>
      )}
    </div>
  );
}

// ─── Modal principal ──────────────────────────────────────────────────────────

export function ModalFactura({ open, onClose }) {
  const queryClient = useQueryClient();
  const { sucursalKey, sucursalLista } = useSucursalKey();
  const { items, totalCarrito, limpiarCarrito, actualizarPrecio } = useCarritoStore();
  const total = totalCarrito();

  const [facturaCreada,        setFacturaCreada]        = useState(null);
  const [mostrarImpresion,     setMostrarImpresion]     = useState(false);
  const [tipoCliente,          setTipoCliente]          = useState('cliente');
  const [form,                 setForm]                 = useState({ nombre: '', cedula: '', celular: '', email: '', direccion: '', notas: '' });
  const [metodosSeleccionados, setMetodosSeleccionados] = useState([]);
  const [montos,               setMontos]               = useState({});
  const [conRetoma,            setConRetoma]            = useState(false);
  const [retomas,              setRetomas]              = useState([RETOMA_VACIA()]);
  const [domicilio,            setDomicilio]            = useState(DOMICILIO_VACIO());
  const [credito,              setCredito]              = useState(CREDITO_VACIO());
  const [error,                setError]                = useState('');
  const [verificandoCedula,    setVerificandoCedula]    = useState(false);
  const [buscandoCedula,       setBuscandoCedula]       = useState(false);

  const { conflictoCliente, verificarCedula, reescribirCliente, cancelarConflicto } = useCedulaCliente();

  const { data: garantiasFactura } = useQuery({
    queryKey: ['garantias-factura', facturaCreada?.id],
    queryFn:  () => getGarantiasPorFactura(facturaCreada.id).then((r) => r.data.data),
    enabled:  !!facturaCreada?.id,
    staleTime: 0,
  });

  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn:  () => api.get('/config').then((r) => r.data.data),
  });

  const conRetomaTieneSerial   = conRetoma && retomas.some((r) => r.tipo_retoma === 'serial');
  const conRetomaTieneCantidad = conRetoma && retomas.some((r) => r.tipo_retoma === 'cantidad');

  const { data: productosSerialRaw } = useQuery({
    queryKey: ['productos-serial', ...sucursalKey],
    queryFn:  () => getProductosSerial().then((r) => normalizarProductos(r.data.data)),
    enabled:  sucursalLista && conRetomaTieneSerial,
  });
  const { data: productosCantidadRaw } = useQuery({
    queryKey: ['productos-cantidad', ...sucursalKey],
    queryFn:  () => getProductosCantidad().then((r) => normalizarProductos(r.data.data)),
    enabled:  conRetomaTieneCantidad,
  });

  const productosSerial   = normalizarProductos(productosSerialRaw);
  const productosCantidad = normalizarProductos(productosCantidadRaw);
  const mostrarEmail      = configData?.campo_email_cliente     === '1';
  const mostrarDireccion  = configData?.campo_direccion_cliente === '1';

  const totalRetomas = conRetoma ? retomas.reduce((s, r) => s + calcularValorRetoma(r), 0) : 0;
  const totalNeto    = total - totalRetomas;
  const totalPagado  = metodosSeleccionados.length === 1
    ? (credito.activo ? Number(credito.cuota_inicial || 0) : totalNeto)
    : metodosSeleccionados.reduce((s, id) => s + Number(montos[id] || 0), 0);
  const diferencia   = totalPagado - (credito.activo ? Number(credito.cuota_inicial || 0) : totalNeto);
  const nombreClienteRetoma = form.nombre.trim() || '';

  const handleBlurCedula = useCallback(async () => {
    const cedula = form.cedula?.trim();
    if (!cedula || tipoCliente !== 'cliente') return;
    const camposVacios = !form.nombre.trim() && !form.celular.trim();
    if (!camposVacios) return;
    setBuscandoCedula(true);
    try {
      const { data } = await buscarPorCedula(cedula);
      const encontrado = data.data;
      if (encontrado) {
        setForm((f) => ({
          ...f,
          nombre:    encontrado.nombre    || f.nombre,
          celular:   encontrado.celular   || f.celular,
          email:     encontrado.email     || f.email,
          direccion: encontrado.direccion || f.direccion,
        }));
      }
    } catch { /* usuario llena manual */ }
    finally { setBuscandoCedula(false); }
  }, [form.cedula, form.nombre, form.celular, tipoCliente]);

  const handleChangeRetoma = useCallback((key, campo, valor) => {
    setRetomas((prev) => prev.map((r) => r._key === key ? { ...r, [campo]: valor } : r));
  }, []);

  const handleAddRetoma    = () => setRetomas((prev) => [...prev, RETOMA_VACIA()]);
  const handleRemoveRetoma = (key) => setRetomas((prev) => prev.filter((r) => r._key !== key));

  const mutation = useMutation({
    mutationFn: crearFactura,
    onSuccess: async (res) => {
      queryClient.invalidateQueries({ queryKey: ['productos-serial'],   exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'],  exact: false });
      queryClient.invalidateQueries({ queryKey: ['seriales'],            exact: false });
      queryClient.invalidateQueries({ queryKey: ['facturas'],            exact: false });
      queryClient.invalidateQueries({ queryKey: ['ventas-rango'],        exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-top'],       exact: false });
      queryClient.invalidateQueries({ queryKey: ['dashboard'],           exact: false });
      queryClient.invalidateQueries({ queryKey: ['clientes'],            exact: false });
      queryClient.invalidateQueries({ queryKey: ['domiciliarios'],       exact: false });
      queryClient.invalidateQueries({ queryKey: ['creditos'],            exact: false });
      try {
        const { data } = await getFacturaById(res.data.data.id);
        setFacturaCreada({ ...data.data, config: configData });
        setMostrarImpresion(true);
      } catch {
        limpiarCarrito(); onClose(); resetForm();
      }
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al crear la factura'),
  });

  const resetForm = () => {
    setForm({ nombre: '', cedula: '', celular: '', email: '', direccion: '', notas: '' });
    setMetodosSeleccionados([]); setMontos({});
    setConRetoma(false); setRetomas([RETOMA_VACIA()]);
    setDomicilio(DOMICILIO_VACIO());
    setCredito(CREDITO_VACIO());
    setError(''); setTipoCliente('cliente');
    setVerificandoCedula(false);
  };

  const handleToggleMetodo = (metodoId) => {
    setMetodosSeleccionados((prev) => {
      if (prev.includes(metodoId)) {
        setMontos((m) => { const c = { ...m }; delete c[metodoId]; return c; });
        return prev.filter((id) => id !== metodoId);
      }
      return [...prev, metodoId];
    });
  };

  const handleCambioMonto = (metodoId, valor) =>
    setMontos((m) => ({ ...m, [metodoId]: valor }));

  const handleKeyDown = (e, siguienteId) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (siguienteId) document.getElementById(siguienteId)?.focus();
      else handleSubmit();
    }
  };

  const ejecutarMutacion = () => {
    mutation.mutate(buildPayloadFactura({
      tipoCliente, form, items, totalNeto,
      metodosSeleccionados, montos,
      retomas: conRetoma ? retomas : [],
      domicilio,
      credito,
    }));
  };

  const handleSubmit = async () => {
    setError('');
    if (!form.nombre.trim())                                return setError('El nombre es requerido');
    if (tipoCliente === 'cliente' && !form.cedula.trim())   return setError('La cédula es requerida');
    if (tipoCliente === 'cliente' && !form.celular.trim())  return setError('El celular es requerido');

    // Validaciones de crédito
    if (credito.activo) {
      const cuotaInicial = Number(credito.cuota_inicial || 0);
      if (cuotaInicial > totalNeto && totalNeto > 0) {
        return setError('La cuota inicial no puede superar el total de la venta');
      }
      if (cuotaInicial > 0 && metodosSeleccionados.length === 0) {
        return setError('Selecciona un método de pago para la cuota inicial');
      }
    } else {
      if (metodosSeleccionados.length === 0 && totalNeto > 0) {
        return setError('Selecciona al menos un método de pago');
      }
    }

    if (domicilio.activo && !domicilio.domiciliario_id) {
      return setError('Selecciona o crea un domiciliario para el pedido');
    }

    if (conRetoma) {
      for (const r of retomas) {
        if (r.ingreso_inventario) {
          if (r.tipo_retoma === 'serial' && !r.imei.trim())
            return setError('El IMEI es requerido para ingresar al inventario');
          if (r.tipo_retoma === 'cantidad' && !r.producto_cantidad_id)
            return setError('Selecciona el producto para ingresar al inventario');
        }
      }
    }

    if (tipoCliente === 'cliente') {
      setVerificandoCedula(true);
      const puedeContin = await verificarCedula(form);
      setVerificandoCedula(false);
      if (!puedeContin) return;
    }

    ejecutarMutacion();
  };

  const handleReescribir = async () => {
    await reescribirCliente();
    ejecutarMutacion();
  };

  const handleCancelarConflicto = () => cancelarConflicto(setForm);

  return (
    <>
      <Modal open={open} onClose={onClose} title="Nueva Factura" size="lg">
        <div className="flex flex-col gap-5">

          {/* Tipo de cliente */}
          <div className="flex gap-2">
            {[
              { id: 'companero', label: 'Compañero', Icn: User  },
              { id: 'cliente',   label: 'Cliente',   Icn: Users },
            ].map((item) => {
              const itemId    = item.id;
              const itemLabel = item.label;
              const ItemIcon  = item.Icn;
              return (
                <button key={itemId} onClick={() => {
                  setTipoCliente(itemId);
                  // Si cambia a compañero, desactivar crédito
                  if (itemId === 'companero') setCredito(CREDITO_VACIO());
                }}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl
                    text-sm font-medium border transition-all
                    ${tipoCliente === itemId
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                  <ItemIcon size={16} /> {itemLabel}
                </button>
              );
            })}
          </div>

          {/* Datos del cliente */}
          <div className="flex flex-col gap-3">
            {tipoCliente === 'cliente' && (
              <div className="relative">
                <Input id="cedula" label="Cédula" placeholder="123456789"
                  value={form.cedula}
                  onChange={(e) => setForm({ ...form, cedula: e.target.value })}
                  onBlur={handleBlurCedula}
                  onKeyDown={(e) => handleKeyDown(e, 'nombre')} />
                {buscandoCedula && (
                  <Loader2 size={14} className="absolute right-3 top-9 text-gray-400 animate-spin" />
                )}
              </div>
            )}
            <Input id="nombre" label="Nombre"
              placeholder={tipoCliente === 'companero' ? 'Nombre del compañero' : 'Nombre completo'}
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              onKeyDown={(e) => handleKeyDown(e, tipoCliente === 'cliente' ? 'celular' : null)} />
            {tipoCliente === 'cliente' && (
              <Input id="celular" label="Celular" placeholder="3001234567"
                value={form.celular}
                onChange={(e) => setForm({ ...form, celular: e.target.value })} />
            )}
            {tipoCliente === 'cliente' && mostrarEmail && (
              <Input id="email" label="Email" type="email" placeholder="correo@ejemplo.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} />
            )}
            {tipoCliente === 'cliente' && mostrarDireccion && (
              <Input id="direccion" label="Dirección" placeholder="Calle 10 # 5-20"
                value={form.direccion}
                onChange={(e) => setForm({ ...form, direccion: e.target.value })} />
            )}
          </div>

          {/* Notas */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">
              Descripción <span className="text-gray-400 font-normal text-xs">(opcional)</span>
            </label>
            <textarea rows={2} placeholder="Observaciones de la venta..."
              value={form.notas}
              onChange={(e) => setForm({ ...form, notas: e.target.value })}
              className="w-full px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm text-gray-900
                placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500
                focus:bg-white transition-all resize-none" />
          </div>

          {/* Resumen de productos */}
          <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-1.5">
            <p className="text-xs font-medium text-gray-500 mb-1">Productos ({items.length})</p>
            {items.map((item) => (
              <div key={item.key} className="flex items-center justify-between text-sm gap-2">
                <span className="text-gray-700 truncate flex-1">{item.nombre}</span>
                {item.imei && <span className="text-xs text-gray-400 font-mono">{item.imei}</span>}
                <InputMoneda value={item.precioFinal}
                  onChange={(val) => actualizarPrecio(item.key, val)}
                  className="w-28 text-right text-sm font-semibold text-gray-900 bg-white
                    border border-gray-200 rounded-lg px-2 py-1 focus:outline-none
                    focus:ring-2 focus:ring-blue-500" />
              </div>
            ))}
            <div className="border-t border-gray-200 mt-2 pt-2 flex justify-between">
              <span className="text-sm font-medium text-gray-700">Subtotal</span>
              <span className="text-sm font-bold text-gray-900">{formatCOP(total)}</span>
            </div>
          </div>

          {/* Retomas */}
          <div className="flex flex-col gap-2">
            <button
              disabled={domicilio.activo || credito.activo}
              onClick={() => {
                if (domicilio.activo || credito.activo) return;
                setConRetoma(!conRetoma);
                setRetomas([RETOMA_VACIA()]);
              }}
              className={`w-full py-2.5 rounded-xl text-sm font-medium border transition-all
                ${domicilio.activo || credito.activo
                  ? 'bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed'
                  : conRetoma
                    ? 'bg-purple-50 border-purple-300 text-purple-700'
                    : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
              {domicilio.activo
                ? 'Retoma no disponible con domicilio'
                : credito.activo
                  ? 'Retoma no disponible con crédito'
                  : conRetoma ? '✓ Con retoma' : '+ Agregar retoma'}
            </button>

            {conRetoma && (
              <div className="flex flex-col gap-3">
                {retomas.map((retoma, index) => (
                  <ItemRetoma
                    key={retoma._key}
                    retoma={retoma}
                    index={index}
                    total={retomas.length}
                    productosSerial={productosSerial}
                    productosCantidad={productosCantidad}
                    onChange={handleChangeRetoma}
                    onRemove={handleRemoveRetoma}
                    nombreCliente={nombreClienteRetoma}
                  />
                ))}
                <button onClick={handleAddRetoma}
                  className="flex items-center justify-center gap-2 py-2 rounded-xl
                    text-sm text-purple-600 border border-dashed border-purple-300
                    hover:bg-purple-50 transition-colors">
                  <Plus size={14} /> Agregar otra retoma
                </button>
                {retomas.length > 1 && totalRetomas > 0 && (
                  <div className="flex justify-between text-sm font-medium text-purple-700
                    bg-purple-50 rounded-xl px-3 py-2">
                    <span>Total retomas ({retomas.length})</span>
                    <span>{formatCOP(totalRetomas)}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Domicilio */}
          <SeccionDomicilio
            domicilio={domicilio}
            onChange={(nuevoDomicilio) => {
              setDomicilio(nuevoDomicilio);
              if (nuevoDomicilio.activo && !domicilio.activo) {
                setConRetoma(false);
                setRetomas([RETOMA_VACIA()]);
                setCredito(CREDITO_VACIO());
              }
            }}
          />

          {/* Venta a crédito */}
          <SeccionCredito
            credito={credito}
            totalNeto={totalNeto}
            onChange={(nuevoCredito) => {
              setCredito(nuevoCredito);
              if (nuevoCredito.activo && !credito.activo) {
                setMetodosSeleccionados([]);
                setMontos({});
                setConRetoma(false);
                setRetomas([RETOMA_VACIA()]);
                setDomicilio(DOMICILIO_VACIO());
              }
            }}
            disabled={domicilio.activo || tipoCliente === 'companero'}
          />

          {/* Métodos de pago */}
          {(!credito.activo || Number(credito.cuota_inicial || 0) > 0) && (
            <SelectorPagos
              metodosSeleccionados={metodosSeleccionados}
              montos={montos}
              totalNeto={credito.activo ? Number(credito.cuota_inicial || 0) : totalNeto}
              onToggleMetodo={handleToggleMetodo}
              onCambioMonto={handleCambioMonto}
            />
          )}

          {credito.activo && Number(credito.cuota_inicial || 0) === 0 && (
            <p className="text-xs text-yellow-600 bg-yellow-50 rounded-xl px-3 py-2 text-center">
              Sin cuota inicial — el total queda como saldo a crédito.
            </p>
          )}

          {/* Resumen financiero */}
          <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-1.5">
            {conRetoma && totalRetomas > 0 && retomas.map((r, i) => {
              const vr = calcularValorRetoma(r);
              if (!vr) return null;
              return (
                <div key={r._key} className="flex justify-between text-sm">
                  <span className="text-purple-600">
                    Retoma {retomas.length > 1 ? i + 1 : ''}
                    {r.descripcion ? ` — ${r.descripcion}` : ''}
                  </span>
                  <span className="text-purple-600">- {formatCOP(vr)}</span>
                </div>
              );
            })}
            {conRetoma && retomas.length > 1 && totalRetomas > 0 && (
              <div className="flex justify-between text-sm font-medium text-purple-700
                border-t border-purple-100 pt-1">
                <span>Total retomas</span>
                <span>- {formatCOP(totalRetomas)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm border-t border-gray-200 mt-1 pt-1.5">
              <span className="text-gray-600">Total a pagar</span>
              <span className={`font-bold ${totalNeto < 0 ? 'text-green-700' : 'text-gray-900'}`}>
                {totalNeto < 0 ? `+ ${formatCOP(Math.abs(totalNeto))}` : formatCOP(totalNeto)}
              </span>
            </div>
            {totalNeto < 0 && (
              <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mt-1">
                <span className="text-green-600 text-xs font-medium">
                  La retoma supera el valor de los productos. El negocio debe devolver{' '}
                  <span className="font-bold">{formatCOP(Math.abs(totalNeto))}</span> al cliente.
                </span>
              </div>
            )}
            {totalNeto === 0 && totalRetomas > 0 && (
              <p className="text-xs text-gray-400 text-center mt-1">
                La retoma cubre exactamente el valor — sin cobro al cliente.
              </p>
            )}
            {!credito.activo && metodosSeleccionados.length >= 2 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Total pagado</span>
                <span className="font-medium">{formatCOP(totalPagado)}</span>
              </div>
            )}
            {!credito.activo && diferencia !== 0 && metodosSeleccionados.length >= 2 && (
              <div className="flex justify-between text-sm border-t border-gray-200 pt-1.5 mt-1">
                <span className={diferencia > 0 ? 'text-green-600' : 'text-red-500'}>
                  {diferencia > 0 ? 'Cambio' : 'Falta'}
                </span>
                <Badge variant={diferencia > 0 ? 'green' : 'red'}>
                  {formatCOP(Math.abs(diferencia))}
                </Badge>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
            <Button className="flex-1"
              loading={mutation.isPending || verificandoCedula || buscandoCedula}
              onClick={handleSubmit}>
              {credito.activo ? 'Confirmar Venta a Crédito' : 'Confirmar Factura'}
            </Button>
          </div>
        </div>
      </Modal>

      <ModalConflictoCedula
        open={!!conflictoCliente}
        conflicto={conflictoCliente}
        onReescribir={handleReescribir}
        onCancelar={handleCancelarConflicto}
        guardando={mutation.isPending}
      />

      {mostrarImpresion && facturaCreada && garantiasFactura !== undefined && (
        <FacturaTermica
          factura={facturaCreada}
          garantias={garantiasFactura}
          onClose={() => { setMostrarImpresion(false); limpiarCarrito(); onClose(); resetForm(); }}
        />
      )}
    </>
  );
}