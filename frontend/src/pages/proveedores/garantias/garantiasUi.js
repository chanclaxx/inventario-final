// Garantías con proveedores — textos y colores compartidos por la pestaña, los
// modales y los documentos. Los estados los DERIVA el backend
// (reclamosGarantia.repository: SQL_ESTADO_PROVEEDOR / SQL_ESTADO_CLIENTE);
// aquí solo se les pone nombre.

export const ESTADO_PROVEEDOR = {
  por_enviar: { texto: 'Por enviar',       clase: 'bg-amber-50 text-amber-700 border-amber-200' },
  afuera:     { texto: 'Con el proveedor', clase: 'bg-blue-50 text-blue-700 border-blue-200' },
  parcial:    { texto: 'Respuesta parcial', clase: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  resuelto:   { texto: 'Resuelto',         clase: 'bg-green-50 text-green-700 border-green-200' },
  anulado:    { texto: 'Anulado',          clase: 'bg-gray-100 text-gray-500 border-gray-200' },
};

export const ESTADO_CLIENTE = {
  pendiente: { texto: 'Cliente espera', clase: 'bg-orange-50 text-orange-700 border-orange-200' },
  resuelto:  { texto: 'Cliente atendido', clase: 'bg-green-50 text-green-700 border-green-200' },
  no_aplica: null,
  anulado:   null,
};

export const ORIGEN = {
  inventario: 'Inventario',
  factura:    'Factura',
  prestamo:   'Préstamo',
};

export const TIPO_MOVIMIENTO = {
  cambio:              'Se le entregó otra unidad',
  reembolso:           'Se le devolvió el dinero',
  reposicion:          'El proveedor repuso la unidad',
  reparacion:          'El proveedor la reparó',
  nota_credito:        'Nota crédito del proveedor',
  reembolso_proveedor: 'El proveedor devolvió el dinero',
  rechazo:             'El proveedor no la cubrió',
};

export const DESTINO_RECHAZO = {
  reingreso: 'volvió al inventario',
  baja:      'se dio de baja',
};

export const FALLAS_RAPIDAS = ['No enciende', 'Pantalla', 'Batería', 'No carga', 'Audio', 'Cámara', 'Táctil', 'Señal'];
export const ACCESORIOS = ['Caja', 'Cargador', 'Cable', 'Audífonos', 'Estuche', 'Factura'];

/** Semáforo de la garantía del proveedor (estado de procedencia.estadoGarantia). */
export const SEMAFORO = {
  vigente:      { texto: 'Garantía vigente',  clase: 'text-green-700 bg-green-50 border-green-200' },
  por_vencer:   { texto: 'Garantía por vencer', clase: 'text-amber-700 bg-amber-50 border-amber-200' },
  vencida:      { texto: 'Garantía vencida',  clase: 'text-red-700 bg-red-50 border-red-200' },
  sin_garantia: { texto: 'Sin plazo registrado', clase: 'text-gray-500 bg-gray-50 border-gray-200' },
};

// 'YYYY-MM-DD' → 'DD/MM/AAAA' sin pasar por Date (un DATE se correría un día).
export const fechaDia = (iso) => {
  const f = String(iso || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(f) ? f.split('-').reverse().join('/') : '';
};

export const numeroDe = (x) => x?.numero ?? x?.id;
export const numFactura = (n) => String(n ?? '').padStart(6, '0');

/** De dónde salió, en una frase corta: «Factura #000101 · Ana Ruiz». */
export const textoOrigen = (c) => {
  if (c.factura) return `Factura #${numFactura(c.factura.numero)}${c.cliente?.nombre ? ` · ${c.cliente.nombre}` : ''}`;
  if (c.prestamo) return `Préstamo #${c.prestamo.numero}${c.cliente?.nombre ? ` · ${c.cliente.nombre}` : ''}`;
  if (c.factura_numero) return `Factura #${numFactura(c.factura_numero)}${c.cliente_nombre ? ` · ${c.cliente_nombre}` : ''}`;
  if (c.prestamo_numero) return `Préstamo #${c.prestamo_numero}${c.cliente_nombre ? ` · ${c.cliente_nombre}` : ''}`;
  return 'Estaba en el inventario';
};

/** El origen que el backend espera al crear, a partir de un candidato. */
export const origenDeCandidato = (c) => {
  // Si vino de una orden de Servicios, viaja con ella para quedar ligada.
  const os = c.orden_servicio?.id ? { orden_servicio_id: c.orden_servicio.id } : {};
  if (c.origen_tipo === 'factura') return { tipo: 'factura', linea_factura_id: c.linea_factura_id, ...os };
  if (c.origen_tipo === 'prestamo') return { tipo: 'prestamo', prestamo_id: c.prestamo?.id, ...os };
  if (c.tipo === 'serial') return { tipo: 'inventario', serial_id: c.serial_id, ...os };
  return { tipo: 'inventario', producto_id: c.producto_id, atributo_id: c.atributo_id, variante_id: c.variante_id };
};

export const mensajeError = (err, porDefecto) => err?.response?.data?.error || err?.message || porDefecto;
