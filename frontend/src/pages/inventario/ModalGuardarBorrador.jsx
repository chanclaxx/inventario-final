import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bookmark, FileText, Handshake, HelpCircle, User } from 'lucide-react';
import { Modal }  from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input }  from '../../components/ui/Input';
import { buscarClientes } from '../../api/clientes.api';
import { formatCOP } from '../../utils/formatters';

// ─────────────────────────────────────────────────────────────────────────────
// Guardar el carrito como borrador.
//
// El destino (factura / préstamo) es una INTENCIÓN, no un compromiso: al cargar
// el borrador el vendedor puede facturar o prestar igual, decida lo que decida
// aquí. Solo sirve para que la tarjeta diga de qué va y para ordenar la lista.
// Por eso existe "Sin definir" y es una opción de primera, no un castigo.
// ─────────────────────────────────────────────────────────────────────────────

const DESTINOS = [
  { id: 'factura',    label: 'Factura',     icon: FileText   },
  { id: 'prestamo',   label: 'Préstamo',    icon: Handshake  },
  { id: 'indefinido', label: 'Sin definir', icon: HelpCircle },
];

export function ModalGuardarBorrador({
  open, onClose, items, total, onGuardar, guardando, error, origen = null,
}) {
  // `origen` es el borrador del que salió este carrito, si salió de alguno.
  // Guardar entonces no crea otro: actualiza ese. Por eso el formulario arranca
  // con sus datos y no en blanco — si no, el vendedor reescribiría el nombre
  // del cliente cada vez que retoca un borrador.
  const editando = !!origen;
  const [titulo,  setTitulo]  = useState(origen?.titulo  ?? '');
  const [destino, setDestino] = useState(origen?.destino ?? 'indefinido');
  const [nota,    setNota]    = useState(origen?.nota    ?? '');
  const [sugerenciasAbiertas, setSugerenciasAbiertas] = useState(false);
  const [busqueda, setBusqueda] = useState('');

  // No hay efecto que limpie el formulario al cerrar: Carrito monta este modal
  // solo mientras está abierto, así que se desmonta y el estado se va con él.
  // El siguiente cliente no hereda el nombre del anterior.

  // Debounce del texto para no consultar en cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setBusqueda(titulo.trim()), 250);
    return () => clearTimeout(t);
  }, [titulo]);

  const { data: sugerencias = [] } = useQuery({
    queryKey: ['clientes-buscar', busqueda],
    queryFn:  () => buscarClientes(busqueda).then((r) => r.data.data),
    enabled:  open && sugerenciasAbiertas && busqueda.length >= 3,
    staleTime: 30_000,
  });

  const puedeGuardar = titulo.trim().length > 0 && items.length > 0 && !guardando;

  const handleGuardar = () => {
    if (!puedeGuardar) return;
    onGuardar({ titulo: titulo.trim(), destino, nota: nota.trim() || null });
  };

  return (
    <Modal open={open} onClose={onClose}
      title={editando ? 'Actualizar borrador' : 'Guardar como borrador'}>
      <div className="flex flex-col gap-4">

        {/* Resumen de lo que se va a guardar */}
        <div className="flex items-center justify-between px-3.5 py-3 bg-blue-50
          border border-blue-100 rounded-xl">
          <div className="flex items-center gap-2 text-sm text-blue-800">
            <Bookmark size={16} className="flex-shrink-0" />
            <span>{items.length} producto{items.length !== 1 ? 's' : ''}</span>
          </div>
          <span className="text-sm font-bold text-blue-900">{formatCOP(total)}</span>
        </div>

        {/* Título — con autocompletado de clientes ya registrados */}
        <div className="relative">
          <Input
            label="¿De quién es?"
            placeholder="Nombre del cliente, o una referencia"
            value={titulo}
            autoFocus
            onChange={(e) => { setTitulo(e.target.value); setSugerenciasAbiertas(true); }}
            onFocus={() => setSugerenciasAbiertas(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { setSugerenciasAbiertas(false); handleGuardar(); }
              if (e.key === 'Escape') setSugerenciasAbiertas(false);
            }}
          />
          {sugerenciasAbiertas && sugerencias.length > 0 && (
            <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white
              border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
              {sugerencias.slice(0, 6).map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setTitulo(c.nombre); setSugerenciasAbiertas(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left
                    hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                >
                  <User size={14} className="text-gray-300 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-800 truncate">{c.nombre}</p>
                    {c.cedula && <p className="text-xs text-gray-400">{c.cedula}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Destino probable */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700">¿Cómo va a terminar?</label>
          <div className="grid grid-cols-3 gap-2">
            {DESTINOS.map((d) => {
              const DestinoIcon = d.icon;
              return (
                <button
                  key={d.id}
                  onClick={() => setDestino(d.id)}
                  className={`flex flex-col items-center gap-1.5 py-2.5 rounded-xl border
                    text-xs font-medium transition-all duration-150
                    ${destino === d.id
                      ? 'border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-500'
                      : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'}`}
                >
                  <DestinoIcon size={16} />
                  {d.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-gray-400">
            Es solo una nota: al cargarlo podrás facturar o prestar igual.
          </p>
        </div>

        {/* Nota */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">
            Nota <span className="text-gray-400 font-normal">(opcional)</span>
          </label>
          <textarea
            rows={2}
            value={nota}
            maxLength={500}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Vuelve el sábado, va a traer la cédula…"
            className="w-full px-3 py-2.5 bg-gray-100 border-0 rounded-xl text-gray-900
              placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500
              focus:bg-white transition-all duration-150 text-sm resize-none"
          />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-2 pt-1">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button className="flex-1" onClick={handleGuardar}
            loading={guardando} disabled={!puedeGuardar}>
            <Bookmark size={16} /> {editando ? 'Actualizar' : 'Guardar'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
