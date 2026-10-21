// Los gastos del mes, agrupados por día. Editar y anular son del admin o de
// quien registró el gasto (el backend lo vuelve a exigir). Anular pide el
// motivo y el gasto queda tachado, nunca se borra.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Ban, Search, ListChecks, X, Repeat } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { editarGasto, anularGasto } from '../../../api/gastos.api';
import { invalidarReportes } from '../../../api/reportes.api';
import { formatCOP } from '../../../utils/formatters';
import { useAuth } from '../../../context/useAuth';
import { FormGasto } from './FormGasto';
import { ICONOS_GASTO, ICONO_POR_DEFECTO, fechaLarga, mensajeError } from './gastosUi';

const sinTildes = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function ModalAnular({ gasto, onClose }) {
  const queryClient = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const m = useMutation({
    mutationFn: () => anularGasto(gasto.id, motivo),
    onSuccess: () => { invalidarReportes(queryClient); onClose(); },
  });
  return (
    <Modal open onClose={onClose} title="Anular gasto" size="sm">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-gray-600">
          {gasto.nombre || gasto.categoria_nombre} · <strong>{formatCOP(gasto.valor_total)}</strong>. El gasto no se borra:
          queda tachado con el motivo y deja de sumar.
        </p>
        <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} maxLength={300} autoFocus
          placeholder="¿Por qué se anula? (ej. quedó repetido, el valor estaba mal)"
          className="w-full px-3 py-2 bg-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        {m.isError && <p className="text-sm text-red-600">{mensajeError(m.error)}</p>}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" className="flex-1" loading={m.isPending} disabled={motivo.trim().length < 3}
            onClick={() => m.mutate()}>Anular</Button>
        </div>
      </div>
    </Modal>
  );
}

function ModalEditar({ gasto, categorias, onClose }) {
  const queryClient = useQueryClient();
  const m = useMutation({
    mutationFn: (datos) => editarGasto(gasto.id, datos),
    onSuccess: () => { invalidarReportes(queryClient); onClose(); },
  });
  // Una categoría apagada después sigue apareciendo en el gasto que la usa.
  const lista = categorias.some((c) => c.id === gasto.categoria_id)
    ? categorias
    : [...categorias, { id: gasto.categoria_id, nombre: gasto.categoria_nombre, color: gasto.categoria_color, icono: gasto.categoria_icono, tipo: gasto.tipo, orden: 999 }];
  return (
    <Modal open onClose={onClose} title="Editar gasto" size="lg">
      <FormGasto categorias={lista} inicial={gasto} compacto guardando={m.isPending}
        error={m.isError ? mensajeError(m.error) : null} onGuardar={(d) => m.mutate(d)} />
    </Modal>
  );
}

export function ListaGastos({ gastos, categorias, filtroCategoria, onQuitarFiltro, verAnulados, onVerAnulados, puedeRegistrar }) {
  const { usuario, esAdminNegocio } = useAuth();
  const [busqueda, setBusqueda] = useState('');
  const [editando, setEditando] = useState(null);
  const [anulando, setAnulando] = useState(null);
  const esAdmin = esAdminNegocio();

  const q = sinTildes(busqueda.trim());
  const visibles = gastos.filter((g) => (!filtroCategoria || g.categoria_id === filtroCategoria)
    && (!q || sinTildes([g.nombre, g.categoria_nombre, g.tercero, g.numero_soporte, g.descripcion, g.medio_pago].join(' ')).includes(q)));

  const porDia = [];
  for (const g of visibles) {
    const ultimo = porDia[porDia.length - 1];
    if (ultimo && ultimo.fecha === g.fecha) ultimo.items.push(g);
    else porDia.push({ fecha: g.fecha, items: [g] });
  }
  const filtroNombre = filtroCategoria && categorias.find((c) => c.id === filtroCategoria)?.nombre;
  const puedeTocar = (g) => puedeRegistrar && !g.anulado && (esAdmin || Number(g.usuario_id) === Number(usuario?.id));

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <ListChecks size={15} className="text-gray-500" /> Movimientos del mes
          <span className="text-xs font-normal text-gray-400">({visibles.filter((g) => !g.anulado).length})</span>
        </h3>
        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
          <input type="checkbox" checked={verAnulados} onChange={(e) => onVerAnulados(e.target.checked)} />
          Ver anulados
        </label>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por concepto, tercero, factura…"
            className="w-full pl-8 pr-3 py-2 bg-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        {filtroNombre && (
          <button type="button" onClick={onQuitarFiltro}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-gray-900 text-white text-xs">
            {filtroNombre} <X size={12} />
          </button>
        )}
      </div>

      {porDia.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">
          {gastos.length ? 'Nada coincide con la búsqueda.' : 'Todavía no hay gastos en este mes.'}
        </p>
      ) : porDia.map((dia) => (
        <div key={dia.fecha} className="flex flex-col">
          <div className="flex items-center justify-between text-xs text-gray-400 px-1 pb-1 border-b border-gray-100">
            <span>{fechaLarga(dia.fecha).replace(/^./, (l) => l.toUpperCase())}</span>
            <span>{formatCOP(dia.items.filter((g) => !g.anulado).reduce((s, g) => s + g.valor_total, 0))}</span>
          </div>
          {dia.items.map((g) => {
            const Icono = ICONOS_GASTO[g.categoria_icono] ?? ICONO_POR_DEFECTO;
            const detalle = [g.nombre ? g.categoria_nombre : null, g.tercero, g.medio_pago,
              g.numero_soporte && `Fact. ${g.numero_soporte}`].filter(Boolean).join(' · ');
            return (
              <div key={g.id} className={`flex items-center gap-3 px-1 py-2.5 border-b border-gray-50 ${g.anulado ? 'opacity-50' : ''}`}>
                <span className="w-8 h-8 rounded-full flex items-center justify-center text-white flex-shrink-0"
                  style={{ backgroundColor: g.categoria_color || '#9CA3AF' }}>
                  <Icono size={14} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm text-gray-800 truncate ${g.anulado ? 'line-through' : ''}`}>
                    {g.nombre || g.categoria_nombre}
                    {g.recurrente_id && <Repeat size={11} className="inline ml-1.5 text-indigo-400" />}
                  </p>
                  <p className="text-[11px] text-gray-400 truncate">
                    {g.anulado ? `Anulado: ${g.anulado_motivo}` : detalle || g.usuario_nombre}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-semibold text-gray-900 ${g.anulado ? 'line-through' : ''}`}>{formatCOP(g.valor_total)}</p>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">{g.tipo}</p>
                </div>
                {puedeTocar(g) && (
                  <div className="flex flex-col gap-0.5 flex-shrink-0">
                    <button type="button" title="Editar" onClick={() => setEditando(g)}
                      className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"><Pencil size={13} /></button>
                    <button type="button" title="Anular" onClick={() => setAnulando(g)}
                      className="p-1 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"><Ban size={13} /></button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {editando && <ModalEditar key={editando.id} gasto={editando} categorias={categorias} onClose={() => setEditando(null)} />}
      {anulando && <ModalAnular key={anulando.id} gasto={anulando} onClose={() => setAnulando(null)} />}
    </div>
  );
}
