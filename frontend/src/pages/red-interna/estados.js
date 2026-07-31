// Estados de una unidad, agrupados como los piensa el local.
//
// El motor de la red interna distingue nueve estados; el local piensa en
// cinco ideas. Este archivo es la traducción, en un solo lugar, para que la
// página del local y el estado de cuenta usen exactamente los mismos filtros.
//
// El backend acepta varios estados separados por coma, así que "Vendidos"
// —que por dentro son dos— viaja como un solo filtro.

export const VENDIDOS = 'Por liquidar,En recaudo';

export const CHIPS = [
  { valor: '',                clave: null,               label: 'Todo'       },
  { valor: VENDIDOS,          clave: 'vendidos',         label: 'Vendidos'   },
  { valor: 'En prestamo',     clave: 'En prestamo',      label: 'Prestados'  },
  { valor: 'En consignacion', clave: 'En consignacion',  label: 'En vitrina' },
  { valor: 'Devuelta',        clave: 'Devuelta',         label: 'Devueltos'  },
  { valor: 'Sin ubicar',      clave: 'Sin ubicar',       label: 'Sin ubicar' },
];

// Cuántas unidades hay en cada chip, a partir del conteo por estado.
export const contar = (conteos = {}, clave) => {
  if (clave === null) return null;
  if (clave === 'vendidos') {
    return (conteos['Por liquidar'] || 0) + (conteos['En recaudo'] || 0);
  }
  return conteos[clave] || 0;
};
