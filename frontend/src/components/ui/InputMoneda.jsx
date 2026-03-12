import { useState, useRef } from 'react';

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/** Convierte un número entero a string con puntos de miles. Ej: 1500000 → "1.500.000" */
const formatearMiles = (valor) => {
  if (valor === '' || valor === null || valor === undefined) return '';
  const numero = parseInt(String(valor).replace(/\D/g, ''), 10);
  if (isNaN(numero)) return '';
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
 *   className     {string}         — clases Tailwind adicionales para el input
 *   disabled      {boolean}
 *   autoFocus     {boolean}
 *   name          {string}         — atributo name del input
 *   id            {string}         — atributo id del input
 *   onBlur        {function}       — callback al salir del campo
 *   onKeyDown     {function}       — callback de teclas
 */
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
      className={className}
    />
  );
}