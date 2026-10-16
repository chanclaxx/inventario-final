import { useState } from 'react';
import { filtrarHojas, mereceBuscador } from '../utils/buscarVariantes';

// El estado del buscador de variantes de UN selector. Se le pasa la lista de
// hojas y devuelve las `visibles`; el cuadro lo pinta `BuscadorVariantes` con
// este mismo objeto.
//
// Por debajo del umbral `activo` es falso, no hay cuadro y `visibles` es la
// lista TAL CUAL llegó: el selector se comporta exactamente como antes.
//
// `consultaInicial`: el código de variante que se escaneó para llegar aquí; la
// lista arranca filtrada a esa variante (solo la primera vez que se monta).
export function useBuscadorVariantes(hojas, consultaInicial = '') {
  const [consulta, setConsulta] = useState(consultaInicial || '');
  const activo = mereceBuscador(hojas);
  return {
    activo,
    consulta,
    setConsulta,
    limpiar: () => setConsulta(''),
    // Sin cuadro no hay cómo borrar lo escrito, así que tampoco se filtra.
    visibles: activo ? filtrarHojas(hojas, consulta) : hojas,
    total: hojas.length,
  };
}
