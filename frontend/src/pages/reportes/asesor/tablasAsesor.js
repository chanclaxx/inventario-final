// ─────────────────────────────────────────────────────────────────────────────
// LAS TABLAS PARA ASESORÍA — una sola definición para la pantalla y el Excel
//
// Cada tabla dice qué PREGUNTA responde, de dónde salen sus filas en la
// respuesta de `GET /reportes/analisis/asesor` y qué columnas tiene. La pantalla
// (`PanelAsesor.jsx`) y el Excel (`utils/exportarAnalisisAsesorExcel.js`) leen
// ESTE archivo: si cada uno tuviera su lista, el Excel acabaría con una columna
// que la pantalla no tiene (o al revés) y el asesor estaría mirando dos
// reportes distintos.
//
// `soloExcel: true` = la columna va al Excel y no a la pantalla. En pantalla
// caben unas doce columnas; el Excel es para cruzar y filtrar, y ahí van todas.
//
// Este archivo es JavaScript puro (sin JSX) a propósito: lo importa también la
// prueba en node.
// ─────────────────────────────────────────────────────────────────────────────

// Las señales. El texto y la explicación viven aquí; QUÉ fila lleva cuál lo
// decide el backend con los umbrales que manda en `umbrales`.
export const SENALES = {
  // Productos
  sin_rotacion:    { texto: 'No rota',          tono: 'rojo',  ayuda: () => 'Tiene stock y no vendió ni una unidad en el período.' },
  recien_comprado: { texto: 'Recién comprado',  tono: 'gris',  ayuda: (u) => `No ha vendido, pero se compró hace menos de ${u.recien_comprado_dias} días.` },
  agotado:         { texto: 'Agotado',          tono: 'rojo',  ayuda: () => 'Se vendió en el período y hoy no hay ninguna unidad.' },
  por_agotarse:    { texto: 'Por agotarse',     tono: 'ambar', ayuda: (u) => `Al ritmo del período, el stock alcanza para menos de ${u.por_agotarse_dias} días.` },
  sobrestock:      { texto: 'Sobrestock',       tono: 'ambar', ayuda: (u) => `Al ritmo del período, hay stock para más de ${u.sobrestock_dias} días.` },
  perdida:         { texto: 'Pérdida',          tono: 'rojo',  ayuda: () => 'Lo vendido dejó menos de lo que costó.' },
  margen_bajo:     { texto: 'Margen bajo',      tono: 'ambar', ayuda: (u) => `Deja menos del ${u.margen_bajo_vs_linea_pct} % de lo que deja su línea (o menos de ${u.margen_bajo_pct} % si la línea no da para comparar).` },
  sin_costo:       { texto: 'Sin costo',        tono: 'gris',  ayuda: () => 'Hay unidades sin costo registrado: su utilidad no se puede medir.' },
  // Proveedores y precios
  mas_caro:        { texto: 'Más caro',         tono: 'rojo',  ayuda: (u) => `Otro proveedor dio el mismo producto más de ${u.precio_mas_caro_pct} % más barato.` },
  mejor_precio:    { texto: 'Mejor precio',     tono: 'verde', ayuda: () => 'El más barato de los proveedores a los que se les compró este producto.' },
  concentracion:   { texto: 'Concentra compras', tono: 'ambar', ayuda: (u) => `Más del ${u.concentracion_proveedor_pct} % de lo comprado es de este proveedor.` },
  devoluciones:    { texto: 'Devoluciones',     tono: 'ambar', ayuda: (u) => `Se le devolvió más del ${u.devoluciones_pct} % de las unidades.` },
  equipos_no_rotan: { texto: 'Equipos sin vender', tono: 'rojo', ayuda: (u) => `Se vendió menos del ${u.equipos_rotacion_pct} % de los equipos comprados, y lo que queda lleva ${u.equipos_dias_minimos} días o más.` },
  deuda_vencida:   { texto: 'Deuda vencida',    tono: 'rojo',  ayuda: () => 'Tiene facturas con la fecha de pago pasada.' },
  novedades:       { texto: 'Novedades',        tono: 'gris',  ayuda: () => 'Mandó otra variante, de más, o algo que no se pidió.' },
  // Clientes y cartera
  generico:        { texto: 'Sin identificar',  tono: 'gris',  ayuda: () => 'Ventas de mostrador sin nombre de cliente.' },
  recurrente:      { texto: 'Volvió',           tono: 'verde', ayuda: () => 'Compró en más de un día del período.' },
  vencido:         { texto: 'Vencido',          tono: 'rojo',  ayuda: () => 'Tiene deuda con la fecha límite pasada.' },
  cartera_vieja:   { texto: 'Deuda vieja',      tono: 'ambar', ayuda: (u) => `Debe desde hace más de ${u.cartera_vieja_dias} días.` },
  // Inventario
  equipo_viejo:    { texto: 'Equipo quieto',    tono: 'ambar', ayuda: (u) => `Tiene unidades con más de ${u.equipo_viejo_dias} días en inventario.` },
};

export const textoSenal = (clave) => SENALES[clave]?.texto ?? clave;

// ── Formato de una celda (pantalla). El Excel usa el tipo, no este texto. ────
const miles = (v) => Math.round(Number(v)).toLocaleString('es-CO');
export const formatearCelda = (valor, tipo) => {
  if (tipo === 'senales') return (valor || []).map(textoSenal).join(', ');
  if (valor === null || valor === undefined || valor === '') return '—';
  switch (tipo) {
    case 'moneda':  return `$${miles(valor)}`;
    case 'entero':  return miles(valor);
    case 'dias':    return `${miles(valor)} d`;
    case 'pct':     return `${Number(valor).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`;
    case 'decimal': return Number(valor).toLocaleString('es-CO', { maximumFractionDigits: 1 });
    default:        return String(valor);
  }
};

export const esNumerica = (tipo) => ['moneda', 'entero', 'dias', 'pct', 'decimal'].includes(tipo);

const c = (clave, titulo, tipo = 'texto', extra = {}) => ({ clave, titulo, tipo, ...extra });
const xl = { soloExcel: true };

// ─────────────────────────────────────────────────────────────────────────────
// Los grupos (las pestañas de la pantalla) y sus tablas (las hojas del Excel).
// `hoja` es el nombre de la hoja: Excel admite 31 caracteres y ningún  : \ / ? * [ ]
// ─────────────────────────────────────────────────────────────────────────────
export const GRUPOS = [
  { id: 'proveedores', titulo: 'Proveedores' },
  { id: 'productos',   titulo: 'Productos' },
  { id: 'compras',     titulo: 'Compras y ventas' },
  { id: 'clientes',    titulo: 'Clientes y cartera' },
  { id: 'inventario',  titulo: 'Equipos en inventario' },
];

export const TABLAS = [
  // ── Proveedores ────────────────────────────────────────────────────────────
  {
    id: 'proveedores', grupo: 'proveedores', hoja: 'Proveedores',
    titulo: 'Proveedores',
    pregunta: '¿A quién le compro, cómo me sale su mercancía y cuánto le debo?',
    nota: 'Las compras son las del período. Los equipos (IMEI) se siguen uno por uno: de los que se le compraron, cuántos ya se vendieron, en cuántos días y con qué margen. La deuda es la de HOY y es de todo el negocio.',
    filas: (d) => d.proveedores,
    orden: { clave: 'valor', desc: true },
    columnas: [
      c('proveedor', 'Proveedor'),
      c('tipo', 'Tipo', 'texto', xl),
      c('compras', 'Compras', 'entero'),
      c('compras_credito', 'A crédito', 'entero', xl),
      c('compras_canceladas', 'Canceladas', 'entero', xl),
      c('productos', 'Productos distintos', 'entero', xl),
      c('unidades', 'Unidades', 'entero', xl),
      c('valor', 'Comprado', 'moneda'),
      c('participacion_pct', '% de las compras', 'pct'),
      c('unidades_devueltas', 'Uds devueltas', 'entero', xl),
      c('valor_devuelto', 'Valor devuelto', 'moneda', xl),
      c('devuelto_pct', '% devuelto', 'pct', xl),
      c('novedades', 'Novedades', 'entero', xl),
      c('garantia_dias', 'Garantía (días)', 'entero', xl),
      c('equipos', 'Equipos', 'entero', { ayuda: 'Equipos con IMEI comprados en el período' }),
      c('equipos_vendidos', 'Equipos vendidos', 'entero', xl),
      c('equipos_vendidos_pct', '% vendido', 'pct'),
      c('dias_para_vender', 'Días en venderse', 'dias'),
      c('equipos_utilidad', 'Utilidad de sus equipos', 'moneda', xl),
      c('equipos_margen_pct', 'Margen equipos', 'pct'),
      c('equipos_sin_vender', 'Equipos sin vender', 'entero', xl),
      c('valor_sin_vender', 'Valor sin vender', 'moneda', xl),
      c('dias_sin_vender', 'Días sin vender', 'dias', xl),
      c('productos_comparables', 'Productos comparables', 'entero', xl),
      c('productos_mas_caro', 'Más caro en', 'entero', { ayuda: 'En cuántos productos otro proveedor dio mejor precio' }),
      c('sobrecosto', 'Diferencia pagada', 'moneda', { soloExcel: true, ayuda: 'Lo que costó de más frente al proveedor más barato de cada producto' }),
      c('deuda', 'Le debes hoy', 'moneda'),
      c('deuda_vencida', 'Vencido', 'moneda'),
      c('primera_compra', 'Primera compra', 'fecha', xl),
      c('ultima_compra', 'Última compra', 'fecha', xl),
      c('senales', 'Señales', 'senales'),
    ],
  },
  {
    id: 'precios_compra', grupo: 'proveedores', hoja: 'Precios de compra',
    titulo: 'El mismo producto, según el proveedor',
    pregunta: '¿A quién le estoy pagando de más por lo mismo?',
    nota: 'En pantalla, solo los productos comprados a más de un proveedor; el Excel los trae todos. El precio promedio va ponderado por unidades. En equipos la diferencia puede ser el estado de cada unidad.',
    filas: (d) => d.precios_compra.filter((f) => f.comparable),
    filasExcel: (d) => d.precios_compra,
    orden: { clave: 'sobrecosto', desc: true },
    columnas: [
      c('producto', 'Producto'),
      c('variante', 'Variante'),
      c('tipo', 'Tipo', 'texto', xl),
      c('proveedor', 'Proveedor'),
      c('compras', 'Compras', 'entero', xl),
      c('unidades', 'Unidades', 'entero'),
      c('valor', 'Comprado', 'moneda', xl),
      c('precio_promedio', 'Precio promedio', 'moneda'),
      c('precio_min', 'Precio mínimo', 'moneda', xl),
      c('precio_max', 'Precio máximo', 'moneda', xl),
      c('precio_primero', 'Primer precio', 'moneda', xl),
      c('precio_ultimo', 'Último precio', 'moneda', xl),
      c('variacion_pct', 'Cambio de precio', 'pct', { ayuda: 'Del primer precio al último, con este mismo proveedor' }),
      c('proveedores_del_producto', 'Proveedores del producto', 'entero', xl),
      c('mejor_precio', 'Mejor precio', 'moneda'),
      c('mejor_proveedor', 'Quién lo dio'),
      c('diferencia_pct', 'Diferencia', 'pct'),
      c('sobrecosto', 'Diferencia pagada', 'moneda'),
      c('ultima_compra', 'Última compra', 'fecha', xl),
      c('senales', 'Señales', 'senales'),
    ],
  },

  // ── Productos ──────────────────────────────────────────────────────────────
  {
    id: 'productos', grupo: 'productos', hoja: 'Productos',
    titulo: 'Productos',
    pregunta: '¿Qué deja plata, qué no se mueve y qué se me está acabando?',
    nota: 'Utilidad de lo vendido en el período, por fecha de venta (incluye lo vendido a crédito que aún no se cobra). Cobertura = para cuántos días alcanza el stock al ritmo del período. Clase A = los productos que suman el 80 % de la utilidad.',
    filas: (d) => d.productos,
    orden: { clave: 'utilidad', desc: true },
    columnas: [
      c('nombre', 'Producto'),
      c('tipo', 'Tipo', 'texto', xl),
      c('linea', 'Línea'),
      c('vendidas', 'Vendidas', 'entero'),
      c('ventas', 'Ventas', 'moneda'),
      c('participacion_ventas_pct', '% de las ventas', 'pct', xl),
      c('costo', 'Costo de lo vendido', 'moneda', xl),
      c('utilidad', 'Utilidad', 'moneda'),
      c('margen_pct', 'Margen', 'pct'),
      c('margen_linea_pct', 'Margen de su línea', 'pct', xl),
      c('participacion_utilidad_pct', '% de la utilidad', 'pct', xl),
      c('clase', 'Clase'),
      c('devueltas', 'Devueltas', 'entero', xl),
      c('obsequios', 'De obsequio', 'entero', xl),
      c('unidades_sin_costo', 'Vendidas sin costo', 'entero', xl),
      c('ultima_venta', 'Última venta', 'fecha', xl),
      c('dias_sin_vender', 'Días sin vender', 'dias', xl),
      c('venta_diaria', 'Venta diaria', 'decimal', xl),
      c('stock', 'Stock', 'entero'),
      c('valor_stock', 'Stock en costo', 'moneda'),
      c('stock_sin_costo', 'Stock sin costo', 'entero', xl),
      c('cobertura_dias', 'Cobertura', 'dias'),
      c('precio', 'Precio de venta', 'moneda', xl),
      c('comprado_unidades', 'Comprado', 'entero'),
      c('comprado_valor', 'Comprado ($)', 'moneda', xl),
      c('proveedores', 'Proveedores', 'entero'),
      c('ultima_compra', 'Última compra', 'fecha', xl),
      c('senales', 'Señales', 'senales'),
    ],
  },
  {
    id: 'variantes', grupo: 'productos', hoja: 'Variantes',
    titulo: 'Por talla, color o referencia',
    pregunta: '¿Dentro de un producto, cuál variante se vende y cuál se queda?',
    nota: 'Solo los productos con variantes. Sirve para no volver a pedir la talla que nadie compra.',
    filas: (d) => d.variantes,
    orden: { clave: 'nombre', desc: false },
    columnas: [
      c('nombre', 'Producto'),
      c('variante', 'Variante'),
      c('linea', 'Línea', 'texto', xl),
      c('vendidas', 'Vendidas', 'entero'),
      c('ventas', 'Ventas', 'moneda'),
      c('costo', 'Costo de lo vendido', 'moneda', xl),
      c('utilidad', 'Utilidad', 'moneda'),
      c('margen_pct', 'Margen', 'pct'),
      c('ultima_venta', 'Última venta', 'fecha', xl),
      c('dias_sin_vender', 'Días sin vender', 'dias', xl),
      c('stock', 'Stock', 'entero'),
      c('valor_stock', 'Stock en costo', 'moneda'),
      c('cobertura_dias', 'Cobertura', 'dias'),
      c('precio', 'Precio de venta', 'moneda', xl),
      c('senales', 'Señales', 'senales'),
    ],
  },
  {
    id: 'lineas', grupo: 'productos', hoja: 'Líneas',
    titulo: 'Líneas de producto',
    pregunta: '¿En qué línea está la plata y en cuál está quieto el inventario?',
    nota: 'Compare «% de las ventas» con «% del inventario»: una línea que vende el 6 % y tiene el 32 % del inventario tiene plata quieta. Cobertura = días que dura su inventario al ritmo al que se vende.',
    filas: (d) => d.lineas,
    orden: { clave: 'ventas', desc: true },
    columnas: [
      c('linea', 'Línea'),
      c('productos', 'Productos', 'entero'),
      c('productos_vendidos', 'Que vendieron', 'entero', xl),
      c('vendidas', 'Unidades', 'entero', xl),
      c('ventas', 'Ventas', 'moneda'),
      c('participacion_ventas_pct', '% de las ventas', 'pct'),
      c('costo', 'Costo de lo vendido', 'moneda', xl),
      c('utilidad', 'Utilidad', 'moneda'),
      c('margen_pct', 'Margen', 'pct'),
      c('stock', 'Unidades en stock', 'entero', xl),
      c('valor_stock', 'Inventario en costo', 'moneda'),
      c('participacion_stock_pct', '% del inventario', 'pct'),
      c('cobertura_dias', 'Cobertura', 'dias'),
      c('productos_sin_rotacion', 'Sin rotar', 'entero'),
      c('valor_sin_rotacion', 'Sin rotar ($)', 'moneda'),
      c('comprado_valor', 'Comprado', 'moneda', xl),
    ],
  },

  // ── Compras y ventas ───────────────────────────────────────────────────────
  {
    id: 'meses', grupo: 'compras', hoja: 'Mes a mes',
    titulo: 'Mes a mes: lo vendido, lo que costó y lo comprado',
    pregunta: '¿Estoy comprando al ritmo al que vendo?',
    nota: '«Comprado contra costo» por encima de 100 % = ese mes entró más mercancía de la que salió y el inventario creció; por debajo, se vendió de lo que ya había.',
    filas: (d) => d.meses,
    orden: { clave: 'mes', desc: false },
    columnas: [
      c('mes', 'Mes'),
      c('facturas', 'Facturas', 'entero'),
      c('facturas_credito', 'A crédito', 'entero', xl),
      c('unidades_vendidas', 'Unidades vendidas', 'entero', xl),
      c('ventas', 'Ventas', 'moneda'),
      c('ventas_credito', 'De eso, a crédito', 'moneda'),
      c('ticket_promedio', 'Factura promedio', 'moneda'),
      c('costo', 'Costo de lo vendido', 'moneda'),
      c('utilidad', 'Utilidad', 'moneda'),
      c('margen_pct', 'Margen', 'pct'),
      c('compras', 'Compras', 'entero'),
      c('unidades_compradas', 'Unidades compradas', 'entero', xl),
      c('comprado', 'Comprado', 'moneda'),
      c('comprado_credito', 'Comprado a crédito', 'moneda', xl),
      c('comprado_vs_costo_pct', 'Comprado contra costo', 'pct'),
    ],
  },
  {
    id: 'sedes', grupo: 'compras', hoja: 'Sedes',
    titulo: 'Por sede',
    pregunta: '¿Qué sede vende y cuál deja más?',
    nota: 'Solo aparece al analizar todo el negocio. En un local de la red interna el costo es el valor al que la bodega le despachó.',
    filas: (d) => (d.sedes.length > 1 ? d.sedes : []),
    orden: { clave: 'ventas', desc: true },
    columnas: [
      c('sede', 'Sede'),
      c('facturas', 'Facturas', 'entero'),
      c('unidades_vendidas', 'Unidades', 'entero'),
      c('ventas', 'Ventas', 'moneda'),
      c('participacion_pct', '% de las ventas', 'pct'),
      c('ticket_promedio', 'Factura promedio', 'moneda'),
      c('costo', 'Costo de lo vendido', 'moneda', xl),
      c('utilidad', 'Utilidad', 'moneda'),
      c('margen_pct', 'Margen', 'pct'),
    ],
  },
  {
    id: 'ventas_dia', grupo: 'compras', hoja: 'Ventas por día',
    titulo: 'Por día de la semana',
    pregunta: '¿Qué días se vende de verdad?',
    nota: '«Promedio por día» divide entre las fechas en que sí hubo ventas ese día de la semana.',
    filas: (d) => d.cuando.por_dia,
    orden: { clave: 'orden', desc: false },
    columnas: [
      c('dia', 'Día'),
      c('dias_con_ventas', 'Fechas con ventas', 'entero'),
      c('facturas', 'Facturas', 'entero'),
      c('facturas_por_dia', 'Facturas por día', 'decimal'),
      c('ventas', 'Ventas', 'moneda'),
      c('participacion_pct', '% de las ventas', 'pct'),
      c('promedio_por_dia', 'Promedio por día', 'moneda'),
    ],
  },
  {
    id: 'ventas_hora', grupo: 'compras', hoja: 'Ventas por hora',
    titulo: 'Por hora del día',
    pregunta: '¿A qué hora se vende?',
    filas: (d) => d.cuando.por_hora,
    orden: { clave: 'orden', desc: false },
    columnas: [
      c('hora', 'Hora'),
      c('facturas', 'Facturas', 'entero'),
      c('ventas', 'Ventas', 'moneda'),
      c('participacion_pct', '% de las ventas', 'pct'),
    ],
  },

  // ── Clientes y cartera ─────────────────────────────────────────────────────
  {
    id: 'clientes', grupo: 'clientes', hoja: 'Clientes',
    titulo: 'Clientes del período',
    pregunta: '¿Quién me compra, cuánto y quién vuelve?',
    nota: 'Agrupados por cédula (o por nombre si no hay). «Sin identificar» son las ventas de mostrador a cliente genérico.',
    filas: (d) => d.clientes.filas,
    orden: { clave: 'total', desc: true },
    columnas: [
      c('cliente', 'Cliente'),
      c('cedula', 'Cédula', 'texto', xl),
      c('celular', 'Celular'),
      c('facturas', 'Facturas', 'entero'),
      c('facturas_credito', 'A crédito', 'entero'),
      c('dias_de_compra', 'Días que compró', 'entero'),
      c('total', 'Compró', 'moneda'),
      c('participacion_pct', '% de las ventas', 'pct'),
      c('ticket_promedio', 'Factura promedio', 'moneda'),
      c('primera_compra', 'Primera compra', 'fecha', xl),
      c('ultima_compra', 'Última compra', 'fecha'),
      c('senales', 'Señales', 'senales'),
    ],
  },
  {
    id: 'cartera_antiguedad', grupo: 'clientes', hoja: 'Cartera por antigüedad',
    titulo: 'Lo que te deben, por antigüedad',
    pregunta: '¿Hace cuánto me deben?',
    nota: 'Créditos y préstamos activos HOY, solo capital (sin mora ni interés). La antigüedad se cuenta desde el día en que se otorgó.',
    filas: (d) => d.cartera.antiguedad,
    orden: null,
    columnas: [
      c('tramo', 'Hace cuánto'),
      c('documentos', 'Documentos', 'entero'),
      c('creditos', 'Créditos', 'entero'),
      c('prestamos', 'Préstamos', 'entero'),
      c('saldo', 'Saldo', 'moneda'),
      c('participacion_pct', '% de la cartera', 'pct'),
      c('senales', 'Señales', 'senales'),
    ],
  },
  {
    id: 'cartera_deudores', grupo: 'clientes', hoja: 'Deudores',
    titulo: 'Quién te debe',
    pregunta: '¿A quién le cobro primero?',
    nota: 'Una fila por persona, con todos sus créditos y préstamos activos. «Vencido» solo existe si el documento tiene fecha límite.',
    filas: (d) => d.cartera.deudores,
    orden: { clave: 'saldo', desc: true },
    columnas: [
      c('cliente', 'Cliente'),
      c('cedula', 'Cédula', 'texto', xl),
      c('celular', 'Celular'),
      c('documentos', 'Documentos', 'entero'),
      c('creditos', 'Créditos', 'entero', xl),
      c('prestamos', 'Préstamos', 'entero', xl),
      c('saldo', 'Debe', 'moneda'),
      c('participacion_pct', '% de la cartera', 'pct'),
      c('saldo_vencido', 'Vencido', 'moneda'),
      c('dias_vencido', 'Días de atraso', 'dias'),
      c('dias_mas_antiguo', 'Debe desde hace', 'dias'),
      c('senales', 'Señales', 'senales'),
    ],
  },

  // ── Inventario ─────────────────────────────────────────────────────────────
  {
    id: 'equipos_stock', grupo: 'inventario', hoja: 'Equipos en inventario',
    titulo: 'Equipos (IMEI) en inventario, por antigüedad',
    pregunta: '¿Qué equipos llevan demasiado tiempo sin venderse?',
    nota: 'Solo equipos con IMEI disponibles hoy (sin vender ni prestar). La mercancía por cantidad no tiene fecha por unidad: la suya se ve en Productos, con «No rota».',
    filas: (d) => d.equipos_stock,
    orden: { clave: 'valor_viejo', desc: true },
    columnas: [
      c('producto', 'Equipo'),
      c('linea', 'Línea', 'texto', xl),
      c('unidades', 'Unidades', 'entero'),
      c('valor', 'En costo', 'moneda'),
      c('sin_costo', 'Sin costo', 'entero', xl),
      c('dias_promedio', 'Días en promedio', 'dias'),
      c('dias_max', 'El más viejo', 'dias'),
      c('d_0_30', '0 a 30 días', 'entero'),
      c('d_31_60', '31 a 60', 'entero'),
      c('d_61_90', '61 a 90', 'entero'),
      c('d_mas_90', 'Más de 90', 'entero'),
      c('unidades_viejas', 'Quietos', 'entero', { ayuda: 'Unidades por encima del umbral de días' }),
      c('valor_viejo', 'Quietos ($)', 'moneda'),
      c('senales', 'Señales', 'senales'),
    ],
  },
];

export const tablaPorId = (id) => TABLAS.find((t) => t.id === id) || null;
export const columnasDePantalla = (tabla) => tabla.columnas.filter((col) => !col.soloExcel);

// Los indicadores de arriba (pantalla y hoja Resumen del Excel).
export const INDICADORES = [
  c('ventas', 'Vendido', 'moneda', { ayuda: 'Facturas no canceladas del período, por su fecha' }),
  c('utilidad', 'Utilidad de lo vendido', 'moneda', { ayuda: 'Lo vendido con costo menos su costo. Incluye lo vendido a crédito aún sin cobrar: no es la utilidad cobrada de las gráficas.' }),
  c('margen_pct', 'Margen', 'pct'),
  c('ticket_promedio', 'Factura promedio', 'moneda'),
  c('ventas_credito_pct', 'Vendido a crédito', 'pct'),
  c('comprado', 'Comprado', 'moneda'),
  c('inventario', 'Inventario en costo', 'moneda', { ayuda: 'A hoy' }),
  c('por_cobrar', 'Por cobrar', 'moneda', { ayuda: 'Créditos y préstamos activos hoy, capital' }),
  c('deuda_proveedores', 'Deuda con proveedores', 'moneda', { ayuda: 'A hoy, de todo el negocio' }),
];

// ── Ordenar y buscar (las usa la pantalla; puras para poder probarlas) ───────
export const ordenarFilas = (filas, orden, columnas) => {
  if (!orden?.clave) return filas;
  const col = columnas.find((x) => x.clave === orden.clave);
  const numerica = col ? esNumerica(col.tipo) : typeof filas[0]?.[orden.clave] === 'number';
  const signo = orden.desc ? -1 : 1;
  return [...filas].sort((a, b) => {
    const va = a[orden.clave], vb = b[orden.clave];
    // Lo vacío va SIEMPRE al final, se ordene hacia donde se ordene: un
    // producto sin margen no es «el de menor margen».
    const na = va === null || va === undefined || va === '';
    const nb = vb === null || vb === undefined || vb === '';
    if (na || nb) return na === nb ? 0 : na ? 1 : -1;
    if (col?.tipo === 'senales') return signo * ((va?.length || 0) - (vb?.length || 0));
    if (numerica) return signo * (Number(va) - Number(vb));
    return signo * String(va).localeCompare(String(vb), 'es', { numeric: true, sensitivity: 'base' });
  });
};

const normalizar = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const buscarFilas = (filas, texto, columnas) => {
  const palabras = normalizar(texto).split(/\s+/).filter(Boolean);
  if (!palabras.length) return filas;
  const deTexto = columnas.filter((col) => col.tipo === 'texto' || col.tipo === 'fecha');
  return filas.filter((f) => {
    const linea = normalizar(deTexto.map((col) => f[col.clave] ?? '').join(' '));
    return palabras.every((p) => linea.includes(p));
  });
};

/** Cuántas filas llevan cada señal, para los filtros de la tabla. */
export const contarSenales = (filas) => {
  const cuenta = new Map();
  for (const f of filas) for (const s of (f.senales || [])) cuenta.set(s, (cuenta.get(s) || 0) + 1);
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([clave, cuantas]) => ({ clave, cuantas }));
};
