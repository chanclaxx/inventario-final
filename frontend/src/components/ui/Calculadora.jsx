import { useEffect, useRef, useState } from 'react';
import { Delete } from 'lucide-react';
import { Button } from './Button';
import { formatCOP } from '../../utils/formatters';

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

const OPERADORES = {
  '+': (a, b) => a + b,
  '−': (a, b) => a - b,
  '×': (a, b) => a * b,
  '÷': (a, b) => (b === 0 ? NaN : a / b),
};

const redondear = (n) => Math.round(n * 100) / 100;

/** Recibe un número o el string interno de edición ("1500,5") y lo muestra con puntos de miles */
const formatearVisual = (valor) => {
  if (valor === 'Error') return 'Error';
  const str = typeof valor === 'number' ? String(valor).replace('.', ',') : String(valor);
  const [entero, decimal] = str.split(',');
  const enteroFormateado = (entero || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decimal !== undefined ? `${enteroFormateado},${decimal}` : enteroFormateado;
};

const numeroAString = (n) => String(redondear(n)).replace('.', ',');

// ─────────────────────────────────────────────
// TECLA
// ─────────────────────────────────────────────

function Tecla({ children, onClick, variant = 'numero', activo = false }) {
  const estilos = {
    numero:   'bg-white hover:bg-gray-100 text-gray-800 border border-gray-200',
    operador: activo
      ? 'bg-blue-600 text-white border border-blue-600'
      : 'bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-100',
    borrar:   'bg-red-50 hover:bg-red-100 text-red-500 border border-red-100',
    igual:    'bg-blue-600 hover:bg-blue-700 text-white border border-blue-600',
  };
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={onClick}
      className={`h-11 rounded-xl text-base font-semibold transition-all active:scale-95
        flex items-center justify-center ${estilos[variant]}`}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────
// CALCULADORA
// ─────────────────────────────────────────────

/**
 * Calculadora interactiva pensada para calcular abonos.
 * Soporta operaciones básicas, porcentaje, cinta de operaciones recientes
 * (para verificar sumas de efectivo) y entrada por teclado físico.
 *
 * Props:
 *   valorInicial {number|string} — precarga la pantalla con el valor ya escrito en el input
 *   onAplicar    {function}      — recibe el resultado entero redondeado: onAplicar(150000)
 *   onCerrar     {function}
 */
export function Calculadora({ valorInicial = '', onAplicar, onCerrar }) {
  const inicial = Number(valorInicial) > 0 ? numeroAString(Number(valorInicial)) : '0';

  const [actual,    setActual]    = useState(inicial);
  const [anterior,  setAnterior]  = useState(null);
  const [operador,  setOperador]  = useState(null);
  const [reiniciar, setReiniciar] = useState(false);
  const [tape,      setTape]      = useState([]);

  const contenedorRef = useRef(null);

  useEffect(() => {
    contenedorRef.current?.focus();
  }, []);

  const numeroActual = actual === 'Error' ? 0 : parseFloat(actual.replace(',', '.')) || 0;

  // ── Entrada de dígitos ──────────────────────────────────────────────────
  const ingresarDigito = (d) => {
    if (actual === 'Error' || reiniciar) {
      setActual(d === ',' ? '0,' : d === '00' ? '0' : d);
      setReiniciar(false);
      return;
    }
    if (d === ',') {
      if (!actual.includes(',')) setActual(actual + ',');
      return;
    }
    if (d === '00' && actual === '0') return;
    if (actual === '0') { setActual(d); return; }
    const soloDigitos = actual.replace(/[^\d]/g, '');
    if (soloDigitos.length >= 12) return; // límite razonable para pesos colombianos
    setActual(actual + d);
  };

  const borrarUltimo = () => {
    if (actual === 'Error') { limpiarTodo(); return; }
    if (reiniciar) return;
    const siguiente = actual.slice(0, -1);
    setActual(siguiente === '' || siguiente === '-' ? '0' : siguiente);
  };

  const limpiarTodo = () => {
    setActual('0');
    setAnterior(null);
    setOperador(null);
    setReiniciar(false);
  };

  const aplicarPorcentaje = () => {
    const resultado = operador && anterior !== null
      ? anterior * (numeroActual / 100)
      : numeroActual / 100;
    setActual(numeroAString(resultado));
    setReiniciar(false);
  };

  // ── Operadores y cálculo ────────────────────────────────────────────────
  const elegirOperador = (op) => {
    if (operador !== null && reiniciar) {
      setOperador(op); // el usuario cambió de opinión antes de escribir el 2º número
      return;
    }
    if (operador !== null && !reiniciar) {
      calcular(op);
      return;
    }
    setAnterior(numeroActual);
    setOperador(op);
    setReiniciar(true);
  };

  const calcular = (siguienteOperador = null) => {
    if (operador === null || anterior === null) {
      if (siguienteOperador) {
        setOperador(siguienteOperador);
        setAnterior(numeroActual);
        setReiniciar(true);
      }
      return;
    }
    const resultado = OPERADORES[operador](anterior, numeroActual);
    if (!isFinite(resultado)) {
      setActual('Error');
      setAnterior(null);
      setOperador(null);
      setReiniciar(true);
      return;
    }
    const resultadoFinal = redondear(resultado);
    setTape((prev) => [
      ...prev.slice(-4),
      {
        id: `${Date.now()}-${Math.random()}`,
        expresion: `${formatearVisual(anterior)} ${operador} ${formatearVisual(numeroActual)}`,
        resultado: resultadoFinal,
      },
    ]);
    setActual(numeroAString(resultadoFinal));
    setAnterior(siguienteOperador ? resultadoFinal : null);
    setOperador(siguienteOperador);
    setReiniciar(true);
  };

  const reutilizarResultado = (resultado) => {
    setActual(numeroAString(resultado));
    setAnterior(null);
    setOperador(null);
    setReiniciar(false);
  };

  // ── Teclado físico ──────────────────────────────────────────────────────
  const manejarTecla = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[0-9]$/.test(e.key)) return ingresarDigito(e.key);
    if (e.key === '.' || e.key === ',') return ingresarDigito(',');
    if (e.key === '+') return elegirOperador('+');
    if (e.key === '-') return elegirOperador('−');
    if (e.key === '*') return elegirOperador('×');
    if (e.key === '/') { e.preventDefault(); return elegirOperador('÷'); }
    if (e.key === '%') return aplicarPorcentaje();
    if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); return calcular(); }
    if (e.key === 'Backspace') return borrarUltimo();
    if (e.key === 'Delete' || e.key.toLowerCase() === 'c') return limpiarTodo();
    if (e.key === 'Escape') return onCerrar();
  };

  const pantallaSecundaria = operador
    ? `${formatearVisual(anterior)} ${operador}${reiniciar ? '' : ` ${formatearVisual(actual)}`}`
    : ' ';

  const puedeAplicar = actual !== 'Error' && numeroActual > 0;

  return (
    <div
      ref={contenedorRef}
      tabIndex={-1}
      onKeyDown={manejarTecla}
      className="rounded-2xl border border-gray-200 bg-gray-50 p-3 flex flex-col gap-2.5 outline-none"
    >
      {/* Cinta de operaciones recientes — útil para verificar sumas de efectivo */}
      {tape.length > 0 && (
        <div className="flex flex-col gap-0.5 max-h-20 overflow-y-auto pr-0.5">
          {tape.map((t) => (
            <button
              key={t.id}
              type="button"
              tabIndex={-1}
              onClick={() => reutilizarResultado(t.resultado)}
              title="Usar este resultado para seguir calculando"
              className="flex items-center justify-between text-xs text-gray-400 hover:text-blue-600
                hover:bg-white rounded-lg px-2 py-1 transition-colors text-left"
            >
              <span className="truncate">{t.expresion} =</span>
              <span className="font-semibold ml-2 flex-shrink-0">{formatearVisual(t.resultado)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Pantalla */}
      <div className="bg-white rounded-xl border border-gray-200 px-3 py-2 text-right overflow-hidden">
        <p className="text-xs text-gray-400 h-4 truncate">{pantallaSecundaria}</p>
        <p className={`text-2xl font-bold tabular-nums truncate ${actual === 'Error' ? 'text-red-500' : 'text-gray-800'}`}>
          {formatearVisual(actual)}
        </p>
      </div>

      {/* Teclado */}
      <div className="grid grid-cols-4 gap-1.5">
        <Tecla onClick={limpiarTodo} variant="borrar">C</Tecla>
        <Tecla onClick={borrarUltimo} variant="borrar"><Delete size={16} /></Tecla>
        <Tecla onClick={aplicarPorcentaje} variant="operador">%</Tecla>
        <Tecla onClick={() => elegirOperador('÷')} variant="operador" activo={operador === '÷' && reiniciar}>÷</Tecla>

        <Tecla onClick={() => ingresarDigito('7')}>7</Tecla>
        <Tecla onClick={() => ingresarDigito('8')}>8</Tecla>
        <Tecla onClick={() => ingresarDigito('9')}>9</Tecla>
        <Tecla onClick={() => elegirOperador('×')} variant="operador" activo={operador === '×' && reiniciar}>×</Tecla>

        <Tecla onClick={() => ingresarDigito('4')}>4</Tecla>
        <Tecla onClick={() => ingresarDigito('5')}>5</Tecla>
        <Tecla onClick={() => ingresarDigito('6')}>6</Tecla>
        <Tecla onClick={() => elegirOperador('−')} variant="operador" activo={operador === '−' && reiniciar}>−</Tecla>

        <Tecla onClick={() => ingresarDigito('1')}>1</Tecla>
        <Tecla onClick={() => ingresarDigito('2')}>2</Tecla>
        <Tecla onClick={() => ingresarDigito('3')}>3</Tecla>
        <Tecla onClick={() => elegirOperador('+')} variant="operador" activo={operador === '+' && reiniciar}>+</Tecla>

        <Tecla onClick={() => ingresarDigito('00')}>00</Tecla>
        <Tecla onClick={() => ingresarDigito('0')}>0</Tecla>
        <Tecla onClick={() => ingresarDigito(',')}>,</Tecla>
        <Tecla onClick={() => calcular()} variant="igual">=</Tecla>
      </div>

      {/* Acciones */}
      <div className="flex gap-2 pt-1.5 border-t border-gray-200">
        <Button type="button" variant="secondary" size="sm" className="flex-1" onClick={onCerrar}>
          Cerrar
        </Button>
        <Button
          type="button"
          size="sm"
          className="flex-1"
          disabled={!puedeAplicar}
          onClick={() => onAplicar(Math.round(numeroActual))}
        >
          Usar {puedeAplicar ? formatCOP(Math.round(numeroActual)) : 'valor'}
        </Button>
      </div>
    </div>
  );
}
