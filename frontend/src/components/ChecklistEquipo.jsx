import { useState } from 'react';
import { CheckCircle, AlertTriangle, XCircle, ChevronDown, ChevronUp } from 'lucide-react';

// ─── Componentes por tipo de equipo ───────────────────────────────────────────

const COMPONENTES_POR_TIPO = {
  Celular: [
    'Pantalla', 'Touch / táctil', 'Botones físicos',
    'Cámara frontal', 'Cámara trasera', 'Audio / parlante',
    'Micrófono', 'Puerto de carga', 'Batería',
    'WiFi / Bluetooth', 'Carcasa / chasis',
  ],
  Tablet: [
    'Pantalla', 'Touch / táctil', 'Botones físicos',
    'Cámara frontal', 'Cámara trasera', 'Audio / parlante',
    'Puerto de carga', 'Batería', 'WiFi / Bluetooth',
    'Carcasa / chasis',
  ],
  Computador: [
    'Pantalla / Monitor', 'Teclado', 'Mouse / Trackpad',
    'Puertos USB', 'Disco duro', 'Ventilador',
    'Encendido', 'WiFi', 'Carcasa / chasis',
  ],
  'Portátil': [
    'Pantalla', 'Teclado', 'Trackpad',
    'Cámara', 'Audio / parlante', 'Micrófono',
    'Puertos USB', 'Puerto de carga', 'Batería',
    'WiFi / Bluetooth', 'Bisagras', 'Carcasa / chasis',
  ],
  Consola: [
    'Encendido', 'Lector de disco', 'Puerto HDMI',
    'Puertos USB', 'Controles / mandos', 'Ventilador',
    'WiFi / Bluetooth', 'Carcasa / chasis',
  ],
  Otro: [
    'Encendido', 'Pantalla', 'Botones',
    'Puertos', 'Carcasa / chasis',
  ],
};

// ─── Constantes de estados ────────────────────────────────────────────────────

const ESTADOS = [
  { id: 'bien',   label: 'Bien',    Icn: CheckCircle,    color: 'text-green-600', bg: 'bg-green-50',  border: 'border-green-200'  },
  { id: 'detalle', label: 'Detalle', Icn: AlertTriangle,  color: 'text-amber-500', bg: 'bg-amber-50',  border: 'border-amber-200'  },
  { id: 'dañado', label: 'Dañado',  Icn: XCircle,        color: 'text-red-500',   bg: 'bg-red-50',    border: 'border-red-200'    },
];

// ─── Fila de un componente ────────────────────────────────────────────────────

function FilaComponente({ componente, estado, nota, onEstado, onNota }) {
  const [expandida, setExpandida] = useState(false);
  const tieneNota = nota && nota.trim().length > 0;

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 py-2">
        {/* Nombre del componente */}
        <span className="text-sm text-gray-700 flex-1 min-w-0 truncate">{componente}</span>

        {/* Botones de estado */}
        <div className="flex gap-1 flex-shrink-0">
          {ESTADOS.map((est) => {
            const EstIcon    = est.Icn;
            const seleccionado = estado === est.id;
            return (
              <button
                key={est.id}
                type="button"
                onClick={() => {
                  onEstado(seleccionado ? null : est.id);
                  if (est.id !== 'bien' && !seleccionado) setExpandida(true);
                }}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all
                  border
                  ${seleccionado
                    ? `${est.bg} ${est.border} ${est.color}`
                    : 'bg-gray-50 border-gray-100 text-gray-300 hover:border-gray-200'}`}
                title={est.label}
              >
                <EstIcon size={14} />
              </button>
            );
          })}
        </div>

        {/* Botón expandir nota */}
        {(estado === 'detalle' || estado === 'dañado' || tieneNota) && (
          <button
            type="button"
            onClick={() => setExpandida((v) => !v)}
            className="p-1 rounded-lg text-gray-300 hover:text-gray-500 flex-shrink-0"
          >
            {expandida ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        )}
      </div>

      {/* Campo de nota expandido */}
      {expandida && (
        <div className="pb-2 pl-1">
          <input
            type="text"
            placeholder={`Detalle de ${componente.toLowerCase()}...`}
            value={nota || ''}
            onChange={(e) => onNota(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg
              text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400
              placeholder-gray-400 transition-all"
          />
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function ChecklistEquipo({ tipoEquipo, value = [], onChange }) {
  const componentes = COMPONENTES_POR_TIPO[tipoEquipo] || COMPONENTES_POR_TIPO.Otro;

  // value es un array de { componente, estado, nota }
  // Construir un map para acceso rápido
  const valueMap = {};
  value.forEach((item) => {
    valueMap[item.componente] = item;
  });

  const handleEstado = (componente, estado) => {
    const nuevo = componentes.map((comp) => {
      if (comp === componente) {
        return { componente: comp, estado, nota: valueMap[comp]?.nota || '' };
      }
      return valueMap[comp] || { componente: comp, estado: null, nota: '' };
    });
    onChange(nuevo.filter((item) => item.estado !== null));
  };

  const handleNota = (componente, nota) => {
    const nuevo = componentes.map((comp) => {
      if (comp === componente) {
        return { componente: comp, estado: valueMap[comp]?.estado || 'detalle', nota };
      }
      return valueMap[comp] || { componente: comp, estado: null, nota: '' };
    });
    onChange(nuevo.filter((item) => item.estado !== null));
  };

  // Resumen
  const totalMarcados = value.length;
  const totalBien     = value.filter((v) => v.estado === 'bien').length;
  const totalDetalle  = value.filter((v) => v.estado === 'detalle').length;
  const totalDañado   = value.filter((v) => v.estado === 'dañado').length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">
          Estado del equipo
        </label>
        {totalMarcados > 0 && (
          <div className="flex items-center gap-2 text-xs">
            {totalBien > 0 && (
              <span className="flex items-center gap-0.5 text-green-600">
                <CheckCircle size={11} /> {totalBien}
              </span>
            )}
            {totalDetalle > 0 && (
              <span className="flex items-center gap-0.5 text-amber-500">
                <AlertTriangle size={11} /> {totalDetalle}
              </span>
            )}
            {totalDañado > 0 && (
              <span className="flex items-center gap-0.5 text-red-500">
                <XCircle size={11} /> {totalDañado}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="bg-gray-50 rounded-xl border border-gray-100 px-3 divide-y divide-gray-100">
        {componentes.map((comp) => {
          const item = valueMap[comp];
          return (
            <FilaComponente
              key={comp}
              componente={comp}
              estado={item?.estado || null}
              nota={item?.nota || ''}
              onEstado={(est) => handleEstado(comp, est)}
              onNota={(nota) => handleNota(comp, nota)}
            />
          );
        })}
      </div>

      {totalMarcados === 0 && (
        <p className="text-xs text-gray-400 text-center">
          Marca el estado de cada componente antes de recibir el equipo
        </p>
      )}
    </div>
  );
}

// Exportar para uso externo (ej: mostrar en detalle de orden)
export { COMPONENTES_POR_TIPO };