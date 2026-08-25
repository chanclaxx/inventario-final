import { useState, useRef } from 'react';

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Normaliza lo que llega en `value` a un entero de pesos.
 *
 * Ojo con los decimales: una columna NUMERIC de Postgres llega al frontend como
 * STRING con decimales ("7000.00"), porque node-postgres no la castea a number
 * para no perder precisión. Quitarle los símbolos a ciegas —que es lo que hacía
 * este componente— convertía "7000.00" en 700000: el precio ×100. Y no era solo
 * cosmético: al tocar el campo, el display corrupto se volvía el valor real y
 * ESE se guardaba en la base de datos.
 *
 * Se resuelve por orden, del formato más específico al más laxo:
 *   1. number    → se redondea (el peso colombiano no usa centavos)
 *   2. "7000.00" → Number() lo entiende bien
 *   3. "1.500.000" o "$ 1.500" → Number() da NaN; ahí sí, solo los dígitos
 */
const aEntero = (valor) => {
  if (valor === '' || valor === null || valor === undefined) return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? Math.round(valor) : null;

  const texto = String(valor).trim();
  if (texto === '') return null;

  // SOLO la forma exacta de un numeric de Postgres: "7000", "7000.00", "-1500.5".
  // Deliberadamente estrecho: cualquier otra cosa (un string ya formateado como
  // "1.500.000", uno con $, con comas o con basura) cae al camino de siempre, así
  // que los campos que hoy funcionan no cambian ni un peso.
  if (/^-?\d+(\.\d+)?$/.test(texto)) return Math.round(Number(texto));

  const soloDigitos = texto.replace(/\D/g, '');
  return soloDigitos === '' ? null : parseInt(soloDigitos, 10);
};

/** Convierte un valor a string con puntos de miles. Ej: 1500000 → "1.500.000" */
const formatearMiles = (valor) => {
  const numero = aEntero(valor);
  if (numero === null) return '';
  // Formateo manual: evita depender del locale del navegador
  return numero.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

/** Extrae el número entero limpio de un string formateado. Ej: "1.500.000" → 1500000 */
const parsearEntero = (valorFormateado) => {
  const limpio = String(valorFormateado).replace(/\D/g, '');
  if (limpio === '') return '';
  return parseInt(limpio, 10);
};

// ─────────────────────────────────────────────
// COMPONENTE
// ─────────────────────────────────────────────

/**
 * InputMoneda
 *
 * Input de precio con formato de miles colombiano (puntos de miles, sin decimales).
 * Ejemplo: el usuario escribe 1500000 y ve "1.500.000"
 *
 * Props:
 *   value         {number|string}  — valor numérico controlado (número entero)
 *   onChange      {function}       — recibe el número entero puro: onChange(1500000)
 *   placeholder   {string}         — placeholder del input (default: "0")
 *   className     {string}         — clases Tailwind del input; sin ella usa el estilo estándar
 *   disabled      {boolean}
 *   autoFocus     {boolean}
 *   name          {string}         — atributo name del input
 *   id            {string}         — atributo id del input
 *   onBlur        {function}       — callback al salir del campo
 *   onKeyDown     {function}       — callback de teclas
 */
// Estilo estándar de campo del sistema. Existe porque `className` REEMPLAZA (no
// suma): un `<InputMoneda />` sin clases renderizaba un input del navegador,
// sin borde ni padding, al lado de campos con estilo — que es exactamente cómo
// se veían los precios del módulo de pedidos.
const CLASES_BASE = 'w-full px-3 py-2 bg-gray-100 border-0 rounded-xl text-sm text-gray-900 '
  + 'placeholder-gray-400 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500 '
  + 'focus:bg-white transition-all disabled:opacity-50 disabled:cursor-not-allowed';

export function InputMoneda({
  value,
  onChange,
  placeholder = '0',
  className = '',
  disabled = false,
  autoFocus = false,
  name,
  id,
  onBlur,
  onKeyDown,
}) {
  const [enfocado, setEnfocado] = useState(false);
  const [displayInterno, setDisplayInterno] = useState('');
  const inputRef = useRef(null);

  // Cuando no está enfocado, el display se deriva directamente del value externo.
  // Cuando está enfocado, se usa el estado interno para no interrumpir la escritura.
  const display = enfocado ? displayInterno : formatearMiles(value);

  const handleFocus = () => {
    setDisplayInterno(formatearMiles(value));
    setEnfocado(true);
  };

  const handleChange = (e) => {
    const raw = e.target.value;
    const soloDigitos = raw.replace(/\D/g, '');

    if (soloDigitos === '') {
      setDisplayInterno('');
      onChange('');
      return;
    }

    const entero = parseInt(soloDigitos, 10);
    const formateado = entero.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

    // Preservar posición del cursor después del formateo
    const cursorAntes = e.target.selectionStart;
    const puntosAntes = (raw.slice(0, cursorAntes).match(/\./g) || []).length;

    setDisplayInterno(formateado);
    onChange(entero);

    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      const puntosDespues = (formateado.slice(0, cursorAntes).match(/\./g) || []).length;
      const nuevoCursor = cursorAntes + (puntosDespues - puntosAntes);
      inputRef.current.setSelectionRange(nuevoCursor, nuevoCursor);
    });
  };

  const handleBlur = (e) => {
    setEnfocado(false);
    const entero = parsearEntero(displayInterno);
    setDisplayInterno(entero !== '' ? formatearMiles(entero) : '');
    onBlur?.(e);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      name={name}
      id={id}
      value={display}
      onFocus={handleFocus}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      className={className || CLASES_BASE}
    />
  );
}