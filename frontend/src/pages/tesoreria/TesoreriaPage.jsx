import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Landmark, Banknote, Smartphone, Store, CircleDollarSign,
  Plus, Pencil, ArrowRightLeft, ClipboardCheck, FileText,
  AlertTriangle, HandCoins, Building2,
} from 'lucide-react';
import * as tesoreriaApi from '../../api/tesoreria.api';
import { useMetodosPago } from '../../hooks/useMetodosPago';
import { usePermisos } from '../../hooks/usePermisos';
import useSucursalStore from '../../store/sucursalStore';
import { formatCOP, formatFechaHora } from '../../utils/formatters';
import { Modal }   from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { InputMoneda } from '../../components/ui/InputMoneda';

// Colores validados (dataviz): identidad la lleva el texto de cada fila;
// el color codifica solo el estado del dinero.
const COLOR_DISPONIBLE = '#3b82f6'; // azul — dinero en cuentas
const COLOR_CARTERA    = '#8b5cf6'; // violeta — dinero en la calle

const TIPOS_CUENTA = [
  { value: 'efectivo',     label: 'Efectivo',     Icn: Banknote   },
  { value: 'banco',        label: 'Banco',        Icn: Landmark   },
  { value: 'billetera',    label: 'Billetera',    Icn: Smartphone },
  { value: 'corresponsal', label: 'Corresponsal', Icn: Store      },
  { value: 'otro',         label: 'Otro',         Icn: CircleDollarSign },
];

const defTipo = (tipo) =>
  TIPOS_CUENTA.find((t) => t.value === tipo) || TIPOS_CUENTA[4];

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
        <FilaDistribucion key={`c-${c.id}`} nombre={c.nombre} valor={c.saldo}
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
        {formatCOP(cuenta.saldo)}
      </p>

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
  { value: 'retiro',  label: 'Retiro',  tipo: 'salida'  },
  { value: 'gasto',   label: 'Gasto',   tipo: 'salida'  },
  { value: 'ingreso', label: 'Ingreso', tipo: 'entrada' },
  { value: 'ajuste',  label: 'Ajuste',  tipo: null      },
];

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
              <option key={c.id} value={c.id}>{c.nombre} — {formatCOP(c.saldo)}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500">Tipo de movimiento</label>
          <div className="grid grid-cols-4 gap-1.5 mt-1">
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
          <label className="text-xs font-semibold text-gray-500">Valor</label>
          <InputMoneda value={form.valor} onChange={(v) => setForm((f) => ({ ...f, valor: v }))}
            className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
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
    origen_id:  cuentas[0]?.id || '',
    destino_id: '',
    valor:      '',
    concepto:   '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => tesoreriaApi.trasladar({ ...form, clave_idempotencia: claveIdem }),
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
              <option key={c.id} value={c.id}>{c.nombre} — {formatCOP(c.saldo)}</option>
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

        <div>
          <label className="text-xs font-semibold text-gray-500">Valor</label>
          <InputMoneda value={form.valor} onChange={(v) => setForm((f) => ({ ...f, valor: v }))}
            className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
        </div>

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
          disabled={mutation.isPending || !form.valor || !form.origen_id || !form.destino_id}
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
  const [error, setError]     = useState('');

  const diferencia = contado === '' ? null : Number(contado) - cuenta.saldo;

  const mutation = useMutation({
    mutationFn: () => tesoreriaApi.arquear({ cuenta_id: cuenta.id, saldo_contado: Number(contado), notas }),
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
          <span className="font-semibold text-gray-800">{formatCOP(cuenta.saldo)}</span>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500">Saldo real contado</label>
          <InputMoneda value={contado} onChange={setContado} autoFocus
            className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
        </div>

        {diferencia !== null && diferencia !== 0 && (
          <p className={`text-sm font-medium ${diferencia > 0 ? 'text-green-600' : 'text-red-500'}`}>
            Diferencia: {diferencia > 0 ? '+' : ''}{formatCOP(diferencia)} — quedará registrada en el arqueo.
          </p>
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
              <span className="text-gray-500">Saldo inicial: <b className="text-gray-800">{formatCOP(data.saldo_inicial)}</b></span>
              <span className="text-gray-500">Saldo final: <b className="text-gray-800">{formatCOP(data.saldo_final)}</b></span>
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
                          {m.tipo === 'entrada' ? '+' : '−'}{formatCOP(m.valor)}
                        </td>
                        <td className="py-2 px-1 text-right text-gray-500 whitespace-nowrap">
                          {formatCOP(m.saldo)}
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
                <span className="font-medium text-gray-800">{formatCOP(c.saldo)}</span>
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
    </div>
  );
}
