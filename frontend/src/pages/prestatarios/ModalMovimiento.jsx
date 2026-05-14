import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { registrarMovimiento } from '../../api/prestatarios.api';
import { getProductosSerial, getProductosCantidad } from '../../api/productos.api';
import { useMetodosPago } from '../../hooks/useMetodosPago';
import { formatCOP } from '../../utils/formatters';
import { Modal }       from '../../components/ui/Modal';
import { Button }      from '../../components/ui/Button';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { Package, ShoppingBag } from 'lucide-react';

// ─── Metadata por tipo ────────────────────────────────────────────────────────

const TIPOS_CFG = {
  entrega_producto: {
    titulo:        'Entregar producto',
    info:          'Registra un producto que tú le das al prestatario.',
    colorBg:       'bg-blue-50 border-blue-100',
    colorText:     'text-blue-700',
    colorFocus:    'focus:ring-blue-400',
    esProducto:    true,
    mostrarIngreso: false,
  },
  recibo_producto: {
    titulo:        'Recibir producto',
    info:          'Registra un producto que el prestatario te entrega.',
    colorBg:       'bg-purple-50 border-purple-100',
    colorText:     'text-purple-700',
    colorFocus:    'focus:ring-purple-400',
    esProducto:    true,
    mostrarIngreso: true,
  },
  pago_recibido: {
    titulo:        'Pago recibido',
    info:          'El prestatario te pagó efectivo — su deuda disminuye.',
    colorBg:       'bg-green-50 border-green-100',
    colorText:     'text-green-700',
    colorFocus:    'focus:ring-green-400',
    esProducto:    false,
    esEfectivo:    true,
  },
  pago_enviado: {
    titulo:        'Pago enviado',
    info:          'Tú le pagaste efectivo al prestatario — su deuda disminuye.',
    colorBg:       'bg-orange-50 border-orange-100',
    colorText:     'text-orange-700',
    colorFocus:    'focus:ring-orange-400',
    esProducto:    false,
    esEfectivo:    true,
  },
  ajuste_manual: {
    titulo:        'Ajuste manual',
    info:          'Corrección de saldo. Indica si suma (+) o resta (−) la deuda.',
    colorBg:       'bg-gray-50 border-gray-200',
    colorText:     'text-gray-700',
    colorFocus:    'focus:ring-gray-400',
    esProducto:    false,
    esAjuste:      true,
  },
};

function normalizarProductos(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return Object.values(data).flat();
}

// ─── Selector de producto ─────────────────────────────────────────────────────

function SelectorProducto({ cfg, tipoProducto, onTipo, campos, onCampo }) {
  const { data: rawSerial   } = useQuery({ queryKey: ['productos-serial'],   queryFn: () => getProductosSerial().then((r) => r.data.data) });
  const { data: rawCantidad } = useQuery({ queryKey: ['productos-cantidad'], queryFn: () => getProductosCantidad().then((r) => r.data.data) });

  const productosSerial   = normalizarProductos(rawSerial);
  const productosCantidad = normalizarProductos(rawCantidad);
  const filtSerial = productosSerial.filter((p) => (p.nombre ?? '').toLowerCase().includes((campos.busquedaSerial ?? '').toLowerCase()));
  const filtCant   = productosCantidad.filter((p)  => (p.nombre ?? '').toLowerCase().includes((campos.busquedaCant ?? '').toLowerCase()));

  const ring = cfg.colorFocus;

  return (
    <div className={`flex flex-col gap-3 p-3 rounded-xl border ${cfg.colorBg}`}>
      {/* Toggle */}
      <div className="flex gap-2">
        {[
          { id: 'serial',   label: 'Con IMEI',     Icn: Package },
          { id: 'cantidad', label: 'Por cantidad',  Icn: ShoppingBag },
        ].map(({ id, label, Icn }) => (
          <button key={id} type="button" onClick={() => onTipo(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl
              text-xs font-medium border transition-all
              ${tipoProducto === id
                ? `bg-white border-current ${cfg.colorText}`
                : 'bg-white/60 border-gray-200 text-gray-500 hover:border-gray-300'}`}>
            <Icn size={13} />{label}
          </button>
        ))}
      </div>

      {/* Serial */}
      {tipoProducto === 'serial' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">IMEI</label>
            <input value={campos.imei ?? ''} onChange={(e) => onCampo('imei', e.target.value)}
              placeholder="Ej: 356789012345678"
              className={`w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 ${ring} transition-all`} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Línea de producto</label>
            <input value={campos.busquedaSerial ?? ''}
              onChange={(e) => { onCampo('busquedaSerial', e.target.value); onCampo('productoSerialSel', null); }}
              placeholder="Buscar modelo..."
              className={`w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 ${ring} transition-all`} />
            {(campos.busquedaSerial ?? '').length > 0 && !campos.productoSerialSel && (
              <div className="flex flex-col max-h-28 overflow-y-auto rounded-xl border border-gray-100 bg-white shadow-sm">
                {filtSerial.length === 0
                  ? <p className="text-xs text-gray-400 px-3 py-2">Sin resultados</p>
                  : filtSerial.map((p) => (
                      <button key={p.id} type="button"
                        onClick={() => { onCampo('productoSerialSel', p); onCampo('busquedaSerial', p.nombre); }}
                        className="text-left px-3 py-2 text-sm hover:bg-gray-50 text-gray-700 border-b border-gray-50 last:border-0">
                        {p.nombre}
                      </button>
                    ))
                }
              </div>
            )}
            {campos.productoSerialSel && <p className={`text-xs ${cfg.colorText}`}>✓ {campos.productoSerialSel.nombre}</p>}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Color (opcional)</label>
            <input value={campos.color ?? ''} onChange={(e) => onCampo('color', e.target.value)}
              placeholder="Ej: Negro"
              className={`w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 ${ring} transition-all`} />
          </div>
        </div>
      )}

      {/* Cantidad */}
      {tipoProducto === 'cantidad' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Producto</label>
            <input value={campos.busquedaCant ?? ''}
              onChange={(e) => { onCampo('busquedaCant', e.target.value); onCampo('productoCantSel', null); }}
              placeholder="Buscar producto..."
              className={`w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 ${ring} transition-all`} />
            {(campos.busquedaCant ?? '').length > 0 && !campos.productoCantSel && (
              <div className="flex flex-col max-h-28 overflow-y-auto rounded-xl border border-gray-100 bg-white shadow-sm">
                {filtCant.length === 0
                  ? <p className="text-xs text-gray-400 px-3 py-2">Sin resultados</p>
                  : filtCant.map((p) => (
                      <button key={p.id} type="button"
                        onClick={() => { onCampo('productoCantSel', p); onCampo('busquedaCant', p.nombre); }}
                        className="text-left px-3 py-2 text-sm hover:bg-gray-50 text-gray-700 border-b border-gray-50 last:border-0">
                        {p.nombre}
                        <span className="text-xs text-gray-400 ml-2">Stock: {p.stock}</span>
                      </button>
                    ))
                }
              </div>
            )}
            {campos.productoCantSel && <p className={`text-xs ${cfg.colorText}`}>✓ {campos.productoCantSel.nombre}</p>}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Cantidad</label>
            <input type="number" min="1" value={campos.cantidad ?? 1}
              onChange={(e) => onCampo('cantidad', e.target.value)}
              className={`w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 ${ring} transition-all`} />
          </div>
        </div>
      )}

      {/* Ingreso inventario */}
      {cfg.mostrarIngreso && (
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={campos.ingreso ?? true}
            onChange={(e) => onCampo('ingreso', e.target.checked)}
            className="rounded accent-purple-600 w-4 h-4" />
          Ingresar al inventario
        </label>
      )}
    </div>
  );
}

// ─── Modal principal ──────────────────────────────────────────────────────────

export function ModalMovimiento({ prestatario, tipo, sucursalId, onClose, onSuccess }) {
  const queryClient = useQueryClient();
  const metodosPago = useMetodosPago();
  const cfg = TIPOS_CFG[tipo];

  // Estado efectivo / ajuste
  const [valor,         setValor]         = useState('');
  const [descripcion,   setDescripcion]   = useState('');
  const [metodo,        setMetodo]        = useState(() => metodosPago[0]?.id ?? 'Efectivo');
  const [registrarCaja, setRegistrarCaja] = useState(true);
  const [signoManual,   setSignoManual]   = useState(1);
  const [error,         setError]         = useState('');

  // Estado producto (elevado aquí para poder leerlo al submit)
  const [tipoProducto, setTipoProducto] = useState('serial');
  const [campos, setCampos] = useState({
    imei: '', busquedaSerial: '', productoSerialSel: null, color: '',
    busquedaCant: '', productoCantSel: null, cantidad: 1, ingreso: true,
  });

  const onCampo = (key, value) => setCampos((prev) => ({ ...prev, [key]: value }));
  const onTipo  = (t) => {
    setTipoProducto(t);
    setCampos({ imei: '', busquedaSerial: '', productoSerialSel: null, color: '', busquedaCant: '', productoCantSel: null, cantidad: 1, ingreso: true });
  };

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        tipo,
        valor:       Number(valor),
        descripcion: descripcion.trim() || undefined,
        sucursal_id: sucursalId,
      };

      if (cfg.esProducto) {
        const esSerial = tipoProducto === 'serial';
        Object.assign(body, {
          nombre_producto:      esSerial ? (campos.productoSerialSel?.nombre || campos.imei || null) : (campos.productoCantSel?.nombre || null),
          imei:                 esSerial ? (campos.imei.trim() || null) : null,
          producto_serial_id:   esSerial ? (campos.productoSerialSel?.id || null) : null,
          producto_cantidad_id: !esSerial ? (campos.productoCantSel?.id || null) : null,
          cantidad:             !esSerial ? (Number(campos.cantidad) || 1) : 1,
          color:                esSerial  ? (campos.color.trim() || null) : null,
          ingreso_inventario:   cfg.mostrarIngreso ? campos.ingreso : true,
        });
      } else if (cfg.esEfectivo) {
        Object.assign(body, { metodo, registrar_en_caja: registrarCaja });
      } else if (cfg.esAjuste) {
        Object.assign(body, { signo: signoManual });
      }

      return registrarMovimiento(prestatario.id, body);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['movimientos-prestatario', prestatario.id], exact: false });
      queryClient.invalidateQueries({ queryKey: ['prestatarios'],       exact: false });
      queryClient.invalidateQueries({ queryKey: ['inventario'],         exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-serial'],   exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
      if (onSuccess) onSuccess(res.data?.data);
      onClose();
    },
    onError: (err) => setError(err.response?.data?.error || 'Error al registrar'),
  });

  const handleSubmit = () => {
    setError('');
    if (!valor || Number(valor) <= 0) return setError('Ingresa un valor mayor a cero');

    if (cfg.esProducto) {
      const esSerial = tipoProducto === 'serial';
      const necesitaInventario = !cfg.mostrarIngreso || campos.ingreso;
      if (esSerial && !campos.imei.trim()) return setError('Ingresa el IMEI');
      if (necesitaInventario && esSerial && !campos.productoSerialSel) return setError('Selecciona la línea de producto');
      if (necesitaInventario && !esSerial && !campos.productoCantSel)  return setError('Selecciona el producto');
    }

    if (cfg.esAjuste && !descripcion.trim()) return setError('La descripción es requerida para ajustes manuales');

    mutation.mutate();
  };

  const valorNum = Number(valor) || 0;

  return (
    <Modal open onClose={onClose} title={cfg.titulo} size="md">
      <div className="flex flex-col gap-4">

        {/* Info persona */}
        <div className={`rounded-xl px-3 py-2.5 border ${cfg.colorBg}`}>
          <p className="text-xs text-gray-400">Prestatario</p>
          <p className={`text-sm font-semibold ${cfg.colorText}`}>{prestatario.nombre}</p>
          <p className="text-xs text-gray-500 mt-0.5">{cfg.info}</p>
        </div>

        {/* Selector de producto */}
        {cfg.esProducto && (
          <SelectorProducto
            cfg={cfg}
            tipoProducto={tipoProducto}
            onTipo={onTipo}
            campos={campos}
            onCampo={onCampo}
          />
        )}

        {/* Valor */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">
            Valor <span className="text-red-400 text-xs">*</span>
          </label>
          <InputMoneda
            value={valor}
            onChange={setValor}
            placeholder="0"
            autoFocus={!cfg.esProducto}
            className={`w-full px-3 py-2 bg-gray-100 rounded-xl text-sm
              focus:outline-none focus:ring-2 ${cfg.colorFocus} focus:bg-white transition-all`}
          />
        </div>

        {/* Descripción */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">
            Descripción {cfg.esAjuste && <span className="text-red-400 text-xs">*</span>}
          </label>
          <input
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder={cfg.esAjuste ? 'Motivo del ajuste...' : 'Opcional...'}
            className={`w-full px-3 py-2 bg-gray-100 rounded-xl text-sm
              focus:outline-none focus:ring-2 ${cfg.colorFocus} focus:bg-white transition-all`}
          />
        </div>

        {/* Ajuste: selector de signo */}
        {cfg.esAjuste && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700">Tipo de ajuste</label>
            <div className="flex gap-2">
              {[
                { s: 1,  label: 'Cargo (+)',  desc: 'Te debe más',   cls: 'border-red-300 bg-red-50 text-red-700'     },
                { s: -1, label: 'Abono (−)',  desc: 'Te debe menos', cls: 'border-green-300 bg-green-50 text-green-700' },
              ].map(({ s, label, desc, cls }) => (
                <button key={s} type="button" onClick={() => setSignoManual(s)}
                  className={`flex-1 flex flex-col items-center py-2.5 rounded-xl border text-xs font-medium transition-all
                    ${signoManual === s ? cls : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  <span className="font-bold text-sm leading-tight">{label}</span>
                  <span className="opacity-70">{desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Efectivo: método + caja */}
        {cfg.esEfectivo && (
          <>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700">Método de pago</label>
              <div className="flex gap-2 flex-wrap">
                {metodosPago.map((m) => (
                  <button key={m.id} type="button" onClick={() => setMetodo(m.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all
                      ${metodo === m.id
                        ? 'bg-blue-50 border-blue-300 text-blue-700'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={`rounded-xl p-3 border transition-all
              ${registrarCaja ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={registrarCaja}
                  onChange={(e) => setRegistrarCaja(e.target.checked)}
                  className="rounded accent-blue-600 w-4 h-4 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-700">Registrar en caja</p>
                  <p className="text-xs text-gray-400">Aparecerá en el resumen de caja del día</p>
                </div>
              </label>
            </div>
          </>
        )}

        {/* Mini resumen */}
        {valorNum > 0 && (
          <div className={`rounded-xl px-4 py-2.5 border ${cfg.colorBg} flex justify-between items-center`}>
            <span className={`text-sm font-medium ${cfg.colorText}`}>{cfg.titulo}</span>
            <span className={`text-base font-bold ${cfg.colorText}`}>{formatCOP(valorNum)}</span>
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" loading={mutation.isPending} onClick={handleSubmit}>
            Registrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
