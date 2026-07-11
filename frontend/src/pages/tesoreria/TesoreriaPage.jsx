import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Landmark, Banknote, Smartphone, Store, CircleDollarSign,
  Plus, Pencil, ArrowRightLeft, ClipboardCheck, FileText,
  AlertTriangle, HandCoins, Building2, Coins, Package,
} from 'lucide-react';
import * as tesoreriaApi from '../../api/tesoreria.api';
import { useMetodosPago } from '../../hooks/useMetodosPago';
import { usePermisos } from '../../hooks/usePermisos';
import useSucursalStore from '../../store/sucursalStore';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { Modal }   from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { CambioDivisa } from '../../components/ui/CambioDivisa';
import { cambioInicial, cambioCompleto } from '../../utils/cambioDivisa';

// Colores validados (dataviz): identidad la lleva el texto de cada fila;
// el color codifica solo el estado del dinero.
const COLOR_DISPONIBLE = '#3b82f6'; // azul — dinero en cuentas
const COLOR_CARTERA    = '#8b5cf6'; // violeta — dinero en la calle

const TIPOS_CUENTA = [
  { value: 'efectivo',     label: 'Efectivo',     Icn: Banknote   },
  { value: 'banco',        label: 'Banco',        Icn: Landmark   },
  { value: 'billetera',    label: 'Billetera',    Icn: Smartphone },
  { value: 'corresponsal', label: 'Corresponsal', Icn: Store      },
  { value: 'divisa',       label: 'Divisa',       Icn: Coins      },
  { value: 'otro',         label: 'Otro',         Icn: CircleDollarSign },
];

const defTipo = (tipo) =>
  TIPOS_CUENTA.find((t) => t.value === tipo) || TIPOS_CUENTA[TIPOS_CUENTA.length - 1];

const esUSD = (cuenta) => (cuenta?.moneda || 'COP') === 'USD';

const formatUSD = (v) =>
  `US$ ${Number(v || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 })}`;

// Formatea un valor en la moneda de la cuenta
const formatMoneda = (valor, cuenta) =>
  esUSD(cuenta) ? formatUSD(valor) : formatCOP(valor);

const FUENTE_LABELS = {
  venta:                  'Venta',
  abono_credito:          'Abono crédito',
  abono_prestamo:         'Abono préstamo',
  servicio:               'Servicio técnico',
  domicilio:              'Domicilio',
  caja_manual:            'Mov. de caja',
  devolucion:             'Devolución',
  compra:                 'Compra',
  abono_acreedor:         'Pago acreedor',
  retoma:                 'Retoma',
  tesoreria_traslado:     'Traslado',
  tesoreria_retiro:       'Retiro',
  tesoreria_gasto:        'Gasto',
  tesoreria_mercancia:    'Pago mercancía',
  tesoreria_ingreso:      'Ingreso',
  tesoreria_ajuste:       'Ajuste',
};

const errMsg = (err, fallback) =>
  err?.response?.data?.error || err?.response?.data?.errors?.[0]?.msg || fallback;

const hoyISO = (diasAtras = 0) => {
  const d = new Date(Date.now() - diasAtras * 24 * 60 * 60 * 1000);
  return d.toLocaleDateString('sv-SE'); // YYYY-MM-DD en hora local
};

// ─── Tiles de totales ─────────────────────────────────────────────────────────

function StatTile({ label, valor, sub, color }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex flex-col gap-1">
      <p className="text-xs font-semibold text-gray-500">{label}</p>
      <p className="text-xl font-bold text-gray-900">{formatCOP(valor)}</p>
      {sub && (
        <p className="text-xs text-gray-400 flex items-center gap-1.5">
          {color && <span className="w-2 h-2 rounded-full inline-block" style={{ background: color }} />}
          {sub}
        </p>
      )}
    </div>
  );
}

// ─── Distribución (bar list) ─────────────────────────────────────────────────

function FilaDistribucion({ nombre, valor, porcentaje, color, detalle }) {
  const ancho = Math.max(0, Math.min(100, porcentaje));
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-gray-700 truncate">
            {nombre}
            {detalle && <span className="text-xs text-gray-400 font-normal ml-1.5">{detalle}</span>}
          </p>
          <p className="text-sm text-gray-900 font-semibold whitespace-nowrap">
            {formatCOP(valor)}
            <span className="text-xs text-gray-400 font-normal ml-1.5">{porcentaje.toFixed(1)}%</span>
          </p>
        </div>
        <div className="h-2 bg-gray-100 rounded-full mt-1 overflow-hidden">
          <div className="h-2 rounded-full" style={{ width: `${ancho}%`, background: color }} />
        </div>
      </div>
    </div>
  );
}

function Distribucion({ data }) {
  const { cuentas, cartera } = data;
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-700">¿Dónde está el dinero?</h3>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLOR_DISPONIBLE }} /> Disponible
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLOR_CARTERA }} /> En la calle
          </span>
        </div>
      </div>
      {cuentas.map((c) => (
        <FilaDistribucion key={`c-${c.id}`} nombre={c.nombre} valor={c.saldo_cop ?? 0}
          detalle={esUSD(c) ? formatUSD(c.saldo) : undefined}
          porcentaje={c.porcentaje} color={COLOR_DISPONIBLE} />
      ))}
      {cartera.creditos.total > 0 && (
        <FilaDistribucion nombre="Créditos por cobrar" detalle={`${cartera.creditos.cantidad} activos`}
          valor={cartera.creditos.total} porcentaje={cartera.creditos.porcentaje} color={COLOR_CARTERA} />
      )}
      {cartera.prestamos.total > 0 && (
        <FilaDistribucion nombre="Préstamos por cobrar" detalle={`${cartera.prestamos.cantidad} activos`}
          valor={cartera.prestamos.total} porcentaje={cartera.prestamos.porcentaje} color={COLOR_CARTERA} />
      )}
      {cartera.domicilios.total > 0 && (
        <FilaDistribucion nombre="Domicilios por rendir" detalle={`${cartera.domicilios.cantidad} pendientes`}
          valor={cartera.domicilios.total} porcentaje={cartera.domicilios.porcentaje} color={COLOR_CARTERA} />
      )}
    </div>
  );
}

// ─── Tarjeta de cuenta ────────────────────────────────────────────────────────

function TarjetaCuenta({ cuenta, onExtracto, onArqueo, onEditar }) {
  const TipoDef = defTipo(cuenta.tipo);
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
            <TipoDef.Icn size={16} className="text-blue-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">{cuenta.nombre}</p>
            <p className="text-xs text-gray-400 capitalize">
              {cuenta.tipo}
              {cuenta.porcentaje_comision > 0 && ` · comisión ${cuenta.porcentaje_comision}%`}
            </p>
          </div>
        </div>
        <button onClick={() => onEditar(cuenta)} title="Editar cuenta"
          className="p-1.5 rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-50 transition-colors">
          <Pencil size={14} />
        </button>
      </div>

      <p className={`text-2xl font-bold ${cuenta.saldo < 0 ? 'text-red-500' : 'text-gray-900'}`}>
        {formatMoneda(cuenta.saldo, cuenta)}
      </p>
      {esUSD(cuenta) && (
        <p className="text-xs text-gray-400 -mt-1">
          {cuenta.tasa_referencia
            ? `≈ ${formatCOP(cuenta.saldo_cop)} (tasa ${Number(cuenta.tasa_referencia).toLocaleString('es-CO')})`
            : 'Sin tasa aún — registra una compra de divisa para calcular el equivalente'}
        </p>
      )}

      {(cuenta.metodos_pago || []).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {cuenta.metodos_pago.map((m) => (
            <span key={m} className="text-xs bg-gray-50 border border-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
              {m}
            </span>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400">
        {cuenta.ultimo_arqueo
          ? `Último arqueo: ${formatFechaHora(cuenta.ultimo_arqueo.fecha)} (${formatCOP(cuenta.ultimo_arqueo.saldo)})`
          : 'Sin arqueo — el saldo se calcula desde cero'}
      </p>

      <div className="flex gap-2 mt-1">
        <button onClick={() => onExtracto(cuenta)}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium text-gray-600
            border border-gray-200 rounded-xl py-1.5 hover:bg-gray-50 transition-colors">
          <FileText size={13} /> Extracto
        </button>
        <button onClick={() => onArqueo(cuenta)}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium text-blue-600
            border border-blue-200 rounded-xl py-1.5 hover:bg-blue-50 transition-colors">
          <ClipboardCheck size={13} /> Arquear
        </button>
      </div>
    </div>
  );
}

// ─── Modal crear/editar cuenta ────────────────────────────────────────────────

function ModalCuenta({ cuenta, onClose }) {
  const queryClient = useQueryClient();
  const metodos     = useMetodosPago();
  const esEdicion   = !!cuenta?.id;

  const [form, setForm] = useState({
    nombre:              cuenta?.nombre || '',
    tipo:                cuenta?.tipo   || 'banco',
    metodos_pago:        cuenta?.metodos_pago || [],
    porcentaje_comision: cuenta?.porcentaje_comision ?? 0,
    moneda:              cuenta?.moneda || 'COP',
    activa:              cuenta?.activa ?? true,
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => esEdicion
      ? tesoreriaApi.actualizarCuenta(cuenta.id, form)
      : tesoreriaApi.crearCuenta(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tesoreria'] });
      onClose();
    },
    onError: (err) => setError(errMsg(err, 'Error al guardar la cuenta')),
  });

  const toggleMetodo = (m) => setForm((f) => ({
    ...f,
    metodos_pago: f.metodos_pago.includes(m)
      ? f.metodos_pago.filter((x) => x !== m)
      : [...f.metodos_pago, m],
  }));

  return (
    <Modal open onClose={onClose} title={esEdicion ? 'Editar cuenta' : 'Nueva cuenta'}>
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-xs font-semibold text-gray-500">Nombre</label>
          <input value={form.nombre}
            onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
            placeholder="Ej: Bancolombia, Corresponsal Éxito…"
            className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500">Tipo</label>
          <div className="grid grid-cols-5 gap-1.5 mt-1">
            {TIPOS_CUENTA.map((t) => (
              <button key={t.value} type="button"
                onClick={() => setForm((f) => ({ ...f, tipo: t.value }))}
                className={`flex flex-col items-center gap-1 py-2 rounded-xl border text-xs transition-colors
                  ${form.tipo === t.value
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                <t.Icn size={15} />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500">Moneda</label>
          <div className="grid grid-cols-2 gap-1.5 mt-1">
            {[['COP', 'Pesos ($)'], ['USD', 'Dólares (US$)']].map(([m, lbl]) => (
              <button key={m} type="button" disabled={esEdicion}
                onClick={() => setForm((f) => ({
                  ...f, moneda: m,
                  metodos_pago: m === 'USD' ? [] : f.metodos_pago,
                }))}
                className={`py-2 rounded-xl border text-xs transition-colors disabled:opacity-60
                  ${form.moneda === m
                    ? 'border-blue-300 bg-blue-50 text-blue-700 font-medium'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                {lbl}
              </button>
            ))}
          </div>
          {esEdicion && (
            <p className="text-xs text-gray-400 mt-1">La moneda no se puede cambiar después de crear la cuenta.</p>
          )}
        </div>

        {form.moneda === 'USD' ? (
          <p className="text-xs text-gray-400 bg-gray-50 rounded-xl p-3">
            Las cuentas en dólares no reciben métodos de pago: se mueven con
            los botones <b>Volví divisa</b> y <b>Pagué mercancía</b>, o con traslados.
          </p>
        ) : (
        <div>
          <label className="text-xs font-semibold text-gray-500">
            Métodos de pago que caen en esta cuenta
          </label>
          <p className="text-xs text-gray-400 mb-1">
            Las ventas y abonos con estos métodos suman aquí automáticamente.
          </p>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {metodos.map(({ id, label }) => (
              <button key={id} type="button" onClick={() => toggleMetodo(id)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors
                  ${form.metodos_pago.includes(id)
                    ? 'border-blue-300 bg-blue-50 text-blue-700 font-medium'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        )}

        <div>
          <label className="text-xs font-semibold text-gray-500">Comisión % (opcional)</label>
          <input type="number" min="0" max="100" step="0.1" value={form.porcentaje_comision}
            onChange={(e) => setForm((f) => ({ ...f, porcentaje_comision: e.target.value }))}
            className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
        </div>

        {esEdicion && (
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={form.activa}
              onChange={(e) => setForm((f) => ({ ...f, activa: e.target.checked }))} />
            Cuenta activa
          </label>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
          className="w-full bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold
            hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {mutation.isPending ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Crear cuenta'}
        </button>
      </div>
    </Modal>
  );
}

// ─── Modal movimiento (retiro / gasto / ingreso / ajuste) ────────────────────

const CATEGORIAS = [
  { value: 'retiro',    label: 'Retiro',    tipo: 'salida'  },
  { value: 'gasto',     label: 'Gasto',     tipo: 'salida'  },
  { value: 'mercancia', label: 'Mercancía', tipo: 'salida'  },
  { value: 'ingreso',   label: 'Ingreso',   tipo: 'entrada' },
  { value: 'ajuste',    label: 'Ajuste',    tipo: null      },
];

// Input de valor según la moneda de la cuenta: pesos con puntos de miles,
// dólares con decimales.
function InputValor({ cuenta, value, onChange, autoFocus }) {
  const clase = `w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm
    focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300`;
  if (esUSD(cuenta)) {
    return (
      <input type="number" min="0" step="0.01" inputMode="decimal"
        value={value} autoFocus={autoFocus} placeholder="0"
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        className={clase} />
    );
  }
  return <InputMoneda value={value} onChange={onChange} autoFocus={autoFocus} className={clase} />;
}

function ModalMovimiento({ cuentas, onClose }) {
  const queryClient = useQueryClient();
  const [claveIdem] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState({
    cuenta_id: cuentas[0]?.id || '',
    categoria: 'retiro',
    tipo:      'salida',
    valor:     '',
    concepto:  '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => tesoreriaApi.registrarMovimiento({ ...form, clave_idempotencia: claveIdem }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tesoreria'] });
      onClose();
    },
    onError: (err) => setError(errMsg(err, 'Error al registrar el movimiento')),
  });

  const setCategoria = (c) => setForm((f) => ({
    ...f, categoria: c.value, tipo: c.tipo ?? f.tipo,
  }));

  return (
    <Modal open onClose={onClose} title="Registrar movimiento">
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-xs font-semibold text-gray-500">Cuenta</label>
          <select value={form.cuenta_id}
            onChange={(e) => setForm((f) => ({ ...f, cuenta_id: Number(e.target.value) }))}
            className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre} — {formatMoneda(c.saldo, c)}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500">Tipo de movimiento</label>
          <div className="grid grid-cols-3 gap-1.5 mt-1">
            {CATEGORIAS.map((c) => (
              <button key={c.value} type="button" onClick={() => setCategoria(c)}
                className={`py-2 rounded-xl border text-xs transition-colors
                  ${form.categoria === c.value
                    ? 'border-blue-300 bg-blue-50 text-blue-700 font-medium'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {form.categoria === 'ajuste' && (
          <div className="grid grid-cols-2 gap-1.5">
            {[['entrada', '+ Suma'], ['salida', '− Resta']].map(([t, lbl]) => (
              <button key={t} type="button" onClick={() => setForm((f) => ({ ...f, tipo: t }))}
                className={`py-2 rounded-xl border text-xs transition-colors
                  ${form.tipo === t
                    ? t === 'entrada' ? 'border-green-300 bg-green-50 text-green-700' : 'border-red-300 bg-red-50 text-red-600'
                    : 'border-gray-200 text-gray-500'}`}>
                {lbl}
              </button>
            ))}
          </div>
        )}

        <div>
          <label className="text-xs font-semibold text-gray-500">
            Valor {esUSD(cuentas.find((c) => c.id === Number(form.cuenta_id))) ? '(en dólares)' : ''}
          </label>
          <InputValor cuenta={cuentas.find((c) => c.id === Number(form.cuenta_id))}
            value={form.valor} onChange={(v) => setForm((f) => ({ ...f, valor: v }))} />
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500">Concepto</label>
          <input value={form.concepto}
            onChange={(e) => setForm((f) => ({ ...f, concepto: e.target.value }))}
            placeholder="¿Para qué / de dónde? Ej: pago arriendo local"
            className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !form.valor || !form.cuenta_id}
          className="w-full bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold
            hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {mutation.isPending ? 'Registrando…' : 'Registrar'}
        </button>
      </div>
    </Modal>
  );
}

// ─── Acciones rápidas (modo simple) ──────────────────────────────────────────

function BotonRapido(props) {
  const { titulo, sub, onClick } = props;
  return (
    <button onClick={onClick}
      className="flex flex-col items-center gap-1 bg-white border border-gray-200 rounded-2xl
        px-2 py-3 shadow-sm hover:border-blue-300 hover:bg-blue-50/40 transition-colors">
      <props.Icn size={22} className="text-blue-600" />
      <span className="text-sm font-semibold text-gray-800 leading-tight">{titulo}</span>
      <span className="text-xs text-gray-400 leading-tight text-center">{sub}</span>
    </button>
  );
}

// "Volví divisa": cambié pesos en efectivo por dólares. Crea la cuenta
// Divisa (USD) automáticamente la primera vez.
function ModalVolviDivisa({ cuentas, onClose }) {
  const queryClient = useQueryClient();
  const [claveIdem] = useState(() => crypto.randomUUID());
  const [cambio, setCambio] = useState(() => cambioInicial());
  const [error, setError]   = useState('');

  const efectivo = cuentas.find((c) => c.tipo === 'efectivo')
    || cuentas.find((c) => (c.metodos_pago || []).includes('Efectivo'));
  const divisa = cuentas.find((c) => esUSD(c));
  const listo  = cambioCompleto(cambio);

  const mutation = useMutation({
    mutationFn: async () => {
      let destino = divisa;
      if (!destino) {
        const r = await tesoreriaApi.crearCuenta({
          nombre: 'Divisa (USD)', tipo: 'divisa', moneda: 'USD',
        });
        destino = r.data.data;
      }
      return tesoreriaApi.trasladar({
        origen_id:          efectivo.id,
        destino_id:         destino.id,
        valor:              cambio.pesos,     // pesos que salen del efectivo
        valor_destino:      cambio.dolares,   // dólares que entran a la Divisa
        tasa_cambio:        cambio.tasa || undefined,
        concepto:           'Compra de divisa',
        clave_idempotencia: claveIdem,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tesoreria'] });
      onClose();
    },
    onError: (err) => setError(errMsg(err, 'Error al registrar el cambio')),
  });

  return (
    <Modal open onClose={onClose} title="Volví divisa (compré dólares)">
      <div className="flex flex-col gap-4">
        <CambioDivisa
          estado={cambio}
          onChange={setCambio}
          labelDolares="¿Cuántos dólares compraste?"
          labelPesos="¿Cuántos pesos entregaste?"
          autoFocus
        />

        {listo && (
          <p className="text-sm text-gray-500 bg-gray-50 rounded-xl p-3">
            Saldrán {formatCOP(cambio.pesos)} del efectivo y entrarán {formatUSD(cambio.dolares)} a la Divisa.
          </p>
        )}

        {!efectivo && (
          <p className="text-sm text-red-500">No hay una cuenta de efectivo activa en esta sucursal.</p>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}

        <button onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !listo || !efectivo}
          className="w-full bg-blue-600 text-white rounded-xl py-3 text-base font-semibold
            hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {mutation.isPending ? 'Registrando…' : 'Registrar cambio'}
        </button>
      </div>
    </Modal>
  );
}

// "Pagué mercancía": salida directa de una cuenta (en su moneda).
// Dos modos: rápido (texto libre) o asignado a un proveedor y, opcionalmente,
// a una compra ya registrada (con bloqueo de dobles pagos en el backend).
function ModalPagueMercancia({ cuentas, onClose }) {
  const queryClient = useQueryClient();
  const [claveIdem] = useState(() => crypto.randomUUID());
  const [modo, setModo]           = useState('rapido'); // 'rapido' | 'proveedor'
  const [cuentaId, setCuentaId]   = useState(cuentas[0]?.id || '');
  const [valor, setValor]         = useState('');       // cuentas en pesos
  const [cambio, setCambio]       = useState(() => cambioInicial()); // cuentas USD
  const [concepto, setConcepto]   = useState('');
  const [proveedorId, setProveedorId] = useState('');
  const [compraId, setCompraId]   = useState('');
  const [error, setError]         = useState('');

  const cuenta = cuentas.find((c) => c.id === Number(cuentaId));
  const esUsdCuenta = esUSD(cuenta);
  // En cuentas USD el pago sale en dólares y la tasa fija cuántos pesos de la
  // deuda se saldan; en cuentas en pesos se paga directo el monto en pesos.
  const valorFinal = esUsdCuenta ? cambio.dolares : valor;
  const tasaFinal  = esUsdCuenta ? (cambio.tasa || undefined) : undefined;

  const { data: proveedores } = useQuery({
    queryKey: ['tesoreria', 'proveedores'],
    queryFn:  () => tesoreriaApi.getProveedoresTesoreria().then((r) => r.data.data),
    enabled:  modo === 'proveedor',
  });

  const { data: compras } = useQuery({
    queryKey: ['tesoreria', 'compras-proveedor', proveedorId],
    queryFn:  () => tesoreriaApi.getComprasProveedor(proveedorId).then((r) => r.data.data),
    enabled:  modo === 'proveedor' && !!proveedorId,
  });

  const compraSel = (compras || []).find((c) => c.id === Number(compraId));

  const seleccionarCompra = (c) => {
    if (c.bloqueada) return; // pagada o ya descontada por su pago en caja
    if (Number(compraId) === c.id) { setCompraId(''); return; }
    setCompraId(c.id);
    // Prellenar con el saldo por pagar (solo si la cuenta es en pesos —
    // en dólares el usuario digita lo que pagó en dólares)
    if (!esUSD(cuenta)) setValor(c.saldo_por_pagar);
  };

  const mutation = useMutation({
    mutationFn: () => tesoreriaApi.registrarMovimiento({
      cuenta_id:          cuenta.id,
      tipo:               'salida',
      categoria:          'mercancia',
      valor:              valorFinal,
      tasa_cambio:        tasaFinal,
      concepto:           concepto || (modo === 'proveedor' ? '' : 'Pago de mercancía'),
      proveedor_id:       modo === 'proveedor' && proveedorId ? Number(proveedorId) : undefined,
      compra_id:          modo === 'proveedor' && compraId    ? Number(compraId)    : undefined,
      clave_idempotencia: claveIdem,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tesoreria'] });
      onClose();
    },
    onError: (err) => setError(errMsg(err, 'Error al registrar el pago')),
  });

  return (
    <Modal open onClose={onClose} title="Pagué mercancía">
      <div className="flex flex-col gap-4">

        {/* Modo: rápido o asignado a proveedor */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {[['rapido', 'Pago rápido'], ['proveedor', 'A un proveedor']].map(([m, lbl]) => (
            <button key={m} type="button"
              onClick={() => { setModo(m); setError(''); }}
              className={`flex-1 text-xs font-medium px-3 py-2 rounded-lg transition-colors
                ${modo === m ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}>
              {lbl}
            </button>
          ))}
        </div>

        {modo === 'proveedor' && (
          <>
            <div>
              <label className="text-xs font-semibold text-gray-500">Proveedor</label>
              <select value={proveedorId}
                onChange={(e) => { setProveedorId(e.target.value); setCompraId(''); }}
                className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
                <option value="">Selecciona el proveedor…</option>
                {(proveedores || []).map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </select>
            </div>

            {proveedorId && (
              <div>
                <label className="text-xs font-semibold text-gray-500">
                  Compra (opcional — toca para asignar el pago)
                </label>
                {(compras || []).length === 0 ? (
                  <p className="text-xs text-gray-400 mt-1">
                    Este proveedor no tiene compras registradas en esta sucursal.
                    Puedes registrar el pago solo al proveedor.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5 mt-1 max-h-44 overflow-y-auto pr-1">
                    {compras.map((c) => (
                      <button key={c.id} type="button" onClick={() => seleccionarCompra(c)}
                        disabled={c.bloqueada}
                        className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-left transition-colors
                          ${c.bloqueada
                            ? 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed'
                            : Number(compraId) === c.id
                              ? 'border-blue-300 bg-blue-50'
                              : 'border-gray-200 hover:bg-gray-50'}`}>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-gray-800">
                            Compra #{c.id}{c.numero_factura ? ` · Fact. ${c.numero_factura}` : ''}
                          </span>
                          <span className="block text-xs text-gray-400">
                            {formatFechaHora(c.fecha)} · {formatCOP(c.total)}
                          </span>
                        </span>
                        <span className={`text-xs font-medium whitespace-nowrap
                          ${c.pagada ? 'text-green-600' : c.bloqueada ? 'text-gray-400' : 'text-amber-600'}`}>
                          {c.pagada
                            ? '✓ Pagada'
                            : c.ya_descuenta
                              ? 'Ya descontada'
                              : c.saldo_por_pagar < c.total
                                ? `Por pagar: ${formatCOP(c.saldo_por_pagar)}`
                                : 'Debe todo'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div>
          <label className="text-xs font-semibold text-gray-500">¿De dónde salió la plata?</label>
          <div className="grid grid-cols-2 gap-1.5 mt-1">
            {cuentas.map((c) => {
              const T = defTipo(c.tipo);
              return (
                <button key={c.id} type="button"
                  onClick={() => {
                    setCuentaId(c.id);
                    setValor('');
                    setCambio(cambioInicial(esUSD(c) && c.tasa_referencia
                      ? { tasa: Number(c.tasa_referencia) } : {}));
                  }}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-colors
                    ${Number(cuentaId) === c.id
                      ? 'border-blue-300 bg-blue-50'
                      : 'border-gray-200 hover:bg-gray-50'}`}>
                  <T.Icn size={16} className={Number(cuentaId) === c.id ? 'text-blue-600' : 'text-gray-400'} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-800 truncate">{c.nombre}</span>
                    <span className="block text-xs text-gray-400">{formatMoneda(c.saldo, c)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {esUsdCuenta ? (
          <CambioDivisa
            estado={cambio}
            onChange={setCambio}
            labelDolares="¿Cuántos dólares pagaste?"
            labelPesos="¿A cuántos pesos equivale?"
            tasaSugerida={cuenta?.tasa_referencia}
          />
        ) : (
          <div>
            <label className="text-xs font-semibold text-gray-500">¿Cuántos pesos pagaste?</label>
            <InputValor cuenta={cuenta} value={valor} onChange={setValor} />
          </div>
        )}

        <div>
          <label className="text-xs font-semibold text-gray-500">
            {modo === 'proveedor' ? 'Nota (opcional)' : '¿A quién? (opcional)'}
          </label>
          <input value={concepto} onChange={(e) => setConcepto(e.target.value)}
            placeholder={modo === 'proveedor'
              ? 'Ej: 10 cargadores tipo C'
              : 'Ej: proveedor Juan — 10 cargadores'}
            className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
        </div>

        {esUsdCuenta && compraSel && (
          <p className="text-xs text-gray-500 bg-gray-50 rounded-xl p-3">
            La compra vale {formatCOP(compraSel.total)}. Escribe cuántos <b>dólares</b> pagaste
            y a qué tasa; con eso el sistema salda esa parte de la deuda en pesos.
          </p>
        )}

        {modo === 'rapido' && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
            Ojo: si esta compra ya la registraste en Proveedores con método de pago
            y "registrar en caja", <b>no la pagues también aquí</b> — se descontaría dos veces.
          </p>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !cuenta
            || (esUsdCuenta ? !cambioCompleto(cambio) : !valor)
            || (modo === 'proveedor' && !proveedorId)}
          className="w-full bg-blue-600 text-white rounded-xl py-3 text-base font-semibold
            hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {mutation.isPending ? 'Registrando…' : 'Registrar pago'}
        </button>
      </div>
    </Modal>
  );
}

// ─── Modal traslado ───────────────────────────────────────────────────────────

function ModalTraslado({ cuentas, esAdmin, onClose }) {
  const queryClient = useQueryClient();
  const [claveIdem] = useState(() => crypto.randomUUID());

  // Para el admin, el destino puede ser una cuenta de otra sucursal
  const { data: resumen } = useQuery({
    queryKey: ['tesoreria', 'resumen'],
    queryFn:  () => tesoreriaApi.getResumenNegocio().then((r) => r.data.data),
    enabled:  esAdmin,
  });

  const destinos = esAdmin && resumen
    ? resumen.sucursales.flatMap((s) =>
        s.cuentas.map((c) => ({ ...c, etiqueta: `${c.nombre} (${s.sucursal_nombre})` })))
    : cuentas.map((c) => ({ ...c, etiqueta: c.nombre }));

  const [form, setForm] = useState({
    origen_id:     cuentas[0]?.id || '',
    destino_id:    '',
    valor:         '',
    concepto:      '',
  });
  const [cambio, setCambio] = useState(() => cambioInicial()); // traslado que cruza moneda
  const [error, setError] = useState('');

  const origen  = cuentas.find((c) => c.id === Number(form.origen_id));
  const destino = destinos.find((c) => c.id === Number(form.destino_id));
  const cruzaMoneda = origen && destino && (origen.moneda || 'COP') !== (destino.moneda || 'COP');
  const origenEsUsd = esUSD(origen);

  // Al cruzar moneda, mapear dólares/pesos del panel a los dos lados del traslado
  const valorOrigen  = origenEsUsd ? cambio.dolares : cambio.pesos;
  const valorDestino = origenEsUsd ? cambio.pesos   : cambio.dolares;

  const mutation = useMutation({
    mutationFn: () => tesoreriaApi.trasladar({
      origen_id:          form.origen_id,
      destino_id:         form.destino_id,
      concepto:           form.concepto,
      valor:              cruzaMoneda ? valorOrigen  : form.valor,
      valor_destino:      cruzaMoneda ? valorDestino : undefined,
      tasa_cambio:        cruzaMoneda ? (cambio.tasa || undefined) : undefined,
      clave_idempotencia: claveIdem,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tesoreria'] });
      onClose();
    },
    onError: (err) => setError(errMsg(err, 'Error al registrar el traslado')),
  });

  return (
    <Modal open onClose={onClose} title="Trasladar dinero">
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-xs font-semibold text-gray-500">Desde</label>
          <select value={form.origen_id}
            onChange={(e) => setForm((f) => ({ ...f, origen_id: Number(e.target.value) }))}
            className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre} — {formatMoneda(c.saldo, c)}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500">Hacia</label>
          <select value={form.destino_id}
            onChange={(e) => setForm((f) => ({ ...f, destino_id: Number(e.target.value) }))}
            className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
            <option value="">Selecciona la cuenta destino…</option>
            {destinos
              .filter((c) => c.id !== Number(form.origen_id))
              .map((c) => (
                <option key={c.id} value={c.id}>{c.etiqueta}</option>
              ))}
          </select>
        </div>

        {cruzaMoneda ? (
          <CambioDivisa
            estado={cambio}
            onChange={setCambio}
            labelDolares={origenEsUsd ? 'Dólares que salen' : 'Dólares que llegan'}
            labelPesos={origenEsUsd ? 'Pesos que llegan' : 'Pesos que salen'}
          />
        ) : (
          <div>
            <label className="text-xs font-semibold text-gray-500">
              Valor que sale {esUSD(origen) ? '(en dólares)' : ''}
            </label>
            <InputValor cuenta={origen} value={form.valor}
              onChange={(v) => setForm((f) => ({ ...f, valor: v }))} />
          </div>
        )}

        <div>
          <label className="text-xs font-semibold text-gray-500">Concepto (opcional)</label>
          <input value={form.concepto}
            onChange={(e) => setForm((f) => ({ ...f, concepto: e.target.value }))}
            placeholder="Ej: consignación efectivo del día"
            className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !form.origen_id || !form.destino_id
            || (cruzaMoneda ? !cambioCompleto(cambio) : !form.valor)}
          className="w-full bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold
            hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {mutation.isPending ? 'Trasladando…' : 'Registrar traslado'}
        </button>
      </div>
    </Modal>
  );
}

// ─── Modal arqueo ─────────────────────────────────────────────────────────────

function ModalArqueo({ cuenta, onClose }) {
  const queryClient = useQueryClient();
  const [contado, setContado] = useState('');
  const [notas, setNotas]     = useState('');
  // Cuando falta plata: ¿en qué se fue? 'mercancia' | 'gasto' | 'ajuste'
  const [clasificacion, setClasificacion] = useState('mercancia');
  const [error, setError]     = useState('');

  const diferencia = contado === '' ? null : Number(contado) - cuenta.saldo;
  const hayFaltante = diferencia !== null && diferencia < 0;

  const mutation = useMutation({
    mutationFn: async () => {
      // Si el faltante fue mercancía o gasto, se registra como salida con su
      // categoría ANTES de anclar: el arqueo queda con diferencia ≈ 0 y el
      // gasto queda clasificado en el histórico.
      if (hayFaltante && clasificacion !== 'ajuste') {
        await tesoreriaApi.registrarMovimiento({
          cuenta_id: cuenta.id,
          tipo:      'salida',
          categoria: clasificacion,
          valor:     Math.abs(diferencia),
          concepto:  clasificacion === 'mercancia'
            ? 'Pago de mercancía detectado en arqueo'
            : 'Gasto detectado en arqueo',
          clave_idempotencia: crypto.randomUUID(),
        });
      }
      return tesoreriaApi.arquear({ cuenta_id: cuenta.id, saldo_contado: Number(contado), notas });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tesoreria'] });
      onClose();
    },
    onError: (err) => setError(errMsg(err, 'Error al registrar el arqueo')),
  });

  return (
    <Modal open onClose={onClose} title={`Arqueo — ${cuenta.nombre}`}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-500">
          El arqueo confirma cuánto dinero hay realmente en la cuenta y fija ese
          valor como punto de partida del saldo.
        </p>

        <div className="bg-gray-50 rounded-xl p-3 text-sm flex justify-between">
          <span className="text-gray-500">Saldo según el sistema</span>
          <span className="font-semibold text-gray-800">{formatMoneda(cuenta.saldo, cuenta)}</span>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500">
            Saldo real contado {esUSD(cuenta) ? '(en dólares)' : ''}
          </label>
          <InputValor cuenta={cuenta} value={contado} onChange={setContado} autoFocus />
        </div>

        {diferencia !== null && diferencia > 0 && (
          <p className="text-sm font-medium text-green-600">
            Sobran {formatMoneda(diferencia, cuenta)} — quedarán registrados en el arqueo.
          </p>
        )}

        {hayFaltante && (
          <div>
            <p className="text-sm font-medium text-red-500 mb-2">
              Faltan {formatMoneda(Math.abs(diferencia), cuenta)}. ¿Esa plata fue para…?
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                ['mercancia', '📦 Mercancía'],
                ['gasto',     '🏠 Un gasto'],
                ['ajuste',    '🤷 No sé'],
              ].map(([v, lbl]) => (
                <button key={v} type="button" onClick={() => setClasificacion(v)}
                  className={`py-2.5 rounded-xl border text-xs font-medium transition-colors
                    ${clasificacion === v
                      ? 'border-blue-300 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="text-xs font-semibold text-gray-500">Notas (opcional)</label>
          <input value={notas} onChange={(e) => setNotas(e.target.value)}
            placeholder="Ej: arqueo de cierre de mes"
            className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button onClick={() => mutation.mutate()} disabled={mutation.isPending || contado === ''}
          className="w-full bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold
            hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {mutation.isPending ? 'Registrando…' : 'Confirmar arqueo'}
        </button>
      </div>
    </Modal>
  );
}

// ─── Modal extracto ───────────────────────────────────────────────────────────

function ModalExtracto({ cuenta, onClose }) {
  const queryClient = useQueryClient();
  const [desde, setDesde] = useState(hoyISO(7));
  const [hasta, setHasta] = useState(hoyISO(0));

  const { data, isLoading } = useQuery({
    queryKey: ['tesoreria', 'extracto', cuenta.id, desde, hasta],
    queryFn:  () => tesoreriaApi.getExtracto(cuenta.id, { desde, hasta }).then((r) => r.data.data),
  });

  const toggleMut = useMutation({
    mutationFn: (id) => tesoreriaApi.toggleMovimiento(id),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['tesoreria'] }),
  });

  const inputFecha = "border border-gray-200 rounded-xl px-2 py-1.5 text-xs bg-white";

  return (
    <Modal open onClose={onClose} title={`Extracto — ${cuenta.nombre}`} size="xl">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inputFecha} />
          <span className="text-xs text-gray-400">a</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inputFecha} />
        </div>

        {isLoading ? (
          <div className="py-10 flex justify-center"><Spinner /></div>
        ) : !data ? (
          <p className="text-sm text-gray-400 py-6 text-center">No se pudo cargar el extracto</p>
        ) : (
          <>
            <div className="flex justify-between text-sm bg-gray-50 rounded-xl p-3">
              <span className="text-gray-500">Saldo inicial: <b className="text-gray-800">{formatMoneda(data.saldo_inicial, cuenta)}</b></span>
              <span className="text-gray-500">Saldo final: <b className="text-gray-800">{formatMoneda(data.saldo_final, cuenta)}</b></span>
            </div>

            {data.movimientos.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">Sin movimientos en este rango</p>
            ) : (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-100">
                      <th className="text-left  py-2 px-1 font-medium">Fecha</th>
                      <th className="text-left  py-2 px-1 font-medium">Detalle</th>
                      <th className="text-right py-2 px-1 font-medium">Valor</th>
                      <th className="text-right py-2 px-1 font-medium">Saldo</th>
                      <th className="py-2 px-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.movimientos.map((m, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="py-2 px-1 text-xs text-gray-400 whitespace-nowrap">
                          {formatFechaHora(m.fecha)}
                        </td>
                        <td className="py-2 px-1 text-gray-700">
                          <span className="text-xs text-gray-400 block">
                            {FUENTE_LABELS[m.fuente] || m.fuente}{m.metodo ? ` · ${m.metodo}` : ''}
                          </span>
                          {m.detalle}
                        </td>
                        <td className={`py-2 px-1 text-right font-medium whitespace-nowrap
                          ${m.tipo === 'entrada' ? 'text-green-600' : 'text-red-500'}`}>
                          {m.tipo === 'entrada' ? '+' : '−'}{formatMoneda(m.valor, cuenta)}
                        </td>
                        <td className="py-2 px-1 text-right text-gray-500 whitespace-nowrap">
                          {formatMoneda(m.saldo, cuenta)}
                        </td>
                        <td className="py-2 px-1 text-right">
                          {m.mov_id && (
                            <button onClick={() => toggleMut.mutate(m.mov_id)}
                              title="Anular movimiento de tesorería"
                              className="text-xs text-red-400 hover:text-red-600 underline">
                              Anular
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

// ─── Consolidado del negocio (solo admin) ─────────────────────────────────────

function Consolidado() {
  const { data, isLoading } = useQuery({
    queryKey: ['tesoreria', 'resumen'],
    queryFn:  () => tesoreriaApi.getResumenNegocio().then((r) => r.data.data),
  });

  if (isLoading) return <div className="py-8 flex justify-center"><Spinner /></div>;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Disponible (negocio)" valor={data.totales.disponible} color={COLOR_DISPONIBLE} sub="En cuentas" />
        <StatTile label="En la calle (negocio)" valor={data.totales.cartera} color={COLOR_CARTERA} sub="Créditos y préstamos" />
        <StatTile label="Total negocio" valor={data.totales.general} />
      </div>
      {data.sucursales.map((s) => (
        <div key={s.sucursal_id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <Building2 size={15} className="text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-700">{s.sucursal_nombre}</h3>
            <span className="ml-auto text-sm font-bold text-gray-900">{formatCOP(s.totales.general)}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            {s.cuentas.map((c) => (
              <div key={c.id} className="flex justify-between py-1 text-sm border-b border-gray-50">
                <span className="text-gray-500 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: COLOR_DISPONIBLE }} />
                  {c.nombre}
                </span>
                <span className="font-medium text-gray-800">{formatMoneda(c.saldo, c)}</span>
              </div>
            ))}
            {s.totales.cartera > 0 && (
              <div className="flex justify-between py-1 text-sm border-b border-gray-50">
                <span className="text-gray-500 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: COLOR_CARTERA }} />
                  En la calle
                </span>
                <span className="font-medium text-gray-800">{formatCOP(s.totales.cartera)}</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function TesoreriaPage() {
  const sucursalActiva = useSucursalStore((s) => s.sucursalActiva);
  const { esAdmin }    = usePermisos();

  const [modal, setModal] = useState(null); // { tipo, cuenta? }
  const [tab,   setTab]   = useState('sucursal');

  const { data, isLoading, error } = useQuery({
    queryKey: ['tesoreria', 'saldos', sucursalActiva],
    queryFn:  () => tesoreriaApi.getSaldos().then((r) => r.data.data),
  });

  const cuentas = data?.cuentas || [];

  return (
    <div className="max-w-screen-xl mx-auto px-4 py-4 flex flex-col gap-4">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <HandCoins size={20} className="text-blue-600" /> Tesorería
          </h1>
          <p className="text-xs text-gray-400">Dónde está el dinero y cómo se mueve</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setModal({ tipo: 'movimiento' })}
            className="flex items-center gap-1.5 text-xs font-medium border border-gray-200
              text-gray-600 rounded-xl px-3 py-2 hover:bg-gray-50 transition-colors">
            <Banknote size={14} /> Movimiento
          </button>
          <button onClick={() => setModal({ tipo: 'traslado' })}
            className="flex items-center gap-1.5 text-xs font-medium border border-gray-200
              text-gray-600 rounded-xl px-3 py-2 hover:bg-gray-50 transition-colors">
            <ArrowRightLeft size={14} /> Traslado
          </button>
          <button onClick={() => setModal({ tipo: 'cuenta' })}
            className="flex items-center gap-1.5 text-xs font-semibold bg-blue-600 text-white
              rounded-xl px-3 py-2 hover:bg-blue-700 transition-colors">
            <Plus size={14} /> Cuenta
          </button>
        </div>
      </div>

      {/* Tabs sucursal / consolidado */}
      {esAdmin && (
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {[['sucursal', 'Esta sucursal'], ['negocio', 'Todo el negocio']].map(([t, lbl]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors
                ${tab === t ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}>
              {lbl}
            </button>
          ))}
        </div>
      )}

      {tab === 'negocio' && esAdmin ? (
        <Consolidado />
      ) : isLoading ? (
        <div className="py-16 flex justify-center"><Spinner /></div>
      ) : error ? (
        <p className="text-sm text-red-500 py-8 text-center">
          {errMsg(error, 'No se pudo cargar la tesorería. ¿Está aplicada la migración?')}
        </p>
      ) : data && (
        <>
          {/* Acciones rápidas — modo simple */}
          <div className="grid grid-cols-3 gap-2">
            <BotonRapido Icn={Coins} titulo="Volví divisa" sub="Cambié pesos a dólares"
              onClick={() => setModal({ tipo: 'volvi-divisa' })} />
            <BotonRapido Icn={Package} titulo="Pagué mercancía" sub="Le pagué a un proveedor"
              onClick={() => setModal({ tipo: 'pague-mercancia' })} />
            <BotonRapido Icn={Landmark} titulo="Consigné" sub="Llevé plata al banco"
              onClick={() => setModal({ tipo: 'traslado' })} />
          </div>
          {/* Alerta de métodos sin cuenta */}
          {data.metodos_sin_asignar.length > 0 && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-2xl p-3">
              <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-700">
                Los métodos <b>{data.metodos_sin_asignar.join(', ')}</b> se han usado
                recientemente pero no están asignados a ninguna cuenta: ese dinero no
                aparece en ningún saldo. Crea o edita una cuenta y asígnalos.
              </p>
            </div>
          )}

          {/* Totales */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatTile label="Disponible" valor={data.totales.disponible}
              color={COLOR_DISPONIBLE} sub="En cuentas y efectivo" />
            <StatTile label="En la calle" valor={data.totales.cartera}
              color={COLOR_CARTERA} sub="Créditos, préstamos y domicilios" />
            <StatTile label="Total" valor={data.totales.general} sub="Disponible + en la calle" />
          </div>

          {/* Distribución */}
          <Distribucion data={data} />

          {/* Cuentas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {cuentas.map((c) => (
              <TarjetaCuenta key={c.id} cuenta={c}
                onExtracto={(cta) => setModal({ tipo: 'extracto', cuenta: cta })}
                onArqueo={(cta)   => setModal({ tipo: 'arqueo',   cuenta: cta })}
                onEditar={(cta)   => setModal({ tipo: 'cuenta',   cuenta: cta })} />
            ))}
          </div>
        </>
      )}

      {/* Modales */}
      {modal?.tipo === 'cuenta'     && <ModalCuenta cuenta={modal.cuenta} onClose={() => setModal(null)} />}
      {modal?.tipo === 'movimiento' && cuentas.length > 0 &&
        <ModalMovimiento cuentas={cuentas} onClose={() => setModal(null)} />}
      {modal?.tipo === 'traslado'   && cuentas.length > 0 &&
        <ModalTraslado cuentas={cuentas} esAdmin={esAdmin} onClose={() => setModal(null)} />}
      {modal?.tipo === 'arqueo'     && <ModalArqueo   cuenta={modal.cuenta} onClose={() => setModal(null)} />}
      {modal?.tipo === 'extracto'   && <ModalExtracto cuenta={modal.cuenta} onClose={() => setModal(null)} />}
      {modal?.tipo === 'volvi-divisa' && cuentas.length > 0 &&
        <ModalVolviDivisa cuentas={cuentas} onClose={() => setModal(null)} />}
      {modal?.tipo === 'pague-mercancia' && cuentas.length > 0 &&
        <ModalPagueMercancia cuentas={cuentas} onClose={() => setModal(null)} />}
    </div>
  );
}
