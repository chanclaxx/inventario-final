const { pool }                = require('../../config/db');
const { createClient }        = require('@supabase/supabase-js');

// ── Cliente Supabase ──────────────────────────────────────────────────────
const _getSupabase = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Exportar todas las tablas como JSON ───────────────────────────────────
const _generarDumpJSON = async () => {
  const tablas = [
    'negocios', 'planes', 'sucursales', 'usuarios',
    'proveedores', 'clientes', 'acreedores', 'prestatarios',
    'empleados_prestatario',
    'productos_serial', 'productos_cantidad',
    'seriales', 'historial_stock_cantidad',
    'facturas', 'lineas_factura', 'pagos_factura', 'retomas',
    'creditos', 'abonos_credito',
    'prestamos', 'abonos_prestamo',
    'compras', 'lineas_compra',
    'aperturas_caja', 'movimientos_caja',
    'movimientos_acreedor',
    'garantias', 'config_negocio',
    'pagos_plan',
  ];

  const dump = {
    version: '1.0',
    fecha:   new Date().toISOString(),
    tablas:  {},
  };

  const client = await pool.connect();
  try {
    for (const tabla of tablas) {
      try {
        const { rows } = await client.query(`SELECT * FROM ${tabla} ORDER BY id`);
        dump.tablas[tabla] = rows;
      } catch {
        dump.tablas[tabla] = [];
      }
    }
  } finally {
    client.release();
  }

  return dump;
};

// ── Subir a Supabase Storage ──────────────────────────────────────────────
const _subirASupabase = async (contenido, nombre) => {
  const supabase = _getSupabase();
  const buffer   = Buffer.from(JSON.stringify(contenido, null, 2), 'utf-8');

  const { data, error } = await supabase.storage
    .from('backups')
    .upload(nombre, buffer, {
      contentType: 'application/json',
      upsert:      false,
    });

  if (error) throw { status: 500, message: `Error subiendo backup: ${error.message}` };
  return data;
};

// ── Listar backups ────────────────────────────────────────────────────────
const listarBackups = async () => {
  const supabase = _getSupabase();

  const { data, error } = await supabase.storage
    .from('backups')
    .list('', {
      limit:  50,
      offset: 0,
      sortBy: { column: 'created_at', order: 'desc' },
    });

  if (error) throw { status: 500, message: `Error listando backups: ${error.message}` };
  return data || [];
};

// ── Eliminar backups antiguos — mantener los últimos N ────────────────────
const _limpiarBackupsInteligente = async () => {
  const supabase = _getSupabase();
  const { data } = await supabase.storage
    .from('backups')
    .list('', { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } });

  if (!data?.length) return 0;

  const ahora      = new Date();
  const aConservar = new Set();

  for (const archivo of data) {
    const fecha     = new Date(archivo.created_at);
    const diasAtras = (ahora - fecha) / (1000 * 60 * 60 * 24);

    // Últimos 7 días — conservar todos
    if (diasAtras <= 7) { aConservar.add(archivo.name); continue; }

    // Últimas 4 semanas — conservar uno por semana (el domingo)
    if (diasAtras <= 28) {
      if (fecha.getDay() === 0) aConservar.add(archivo.name);
      continue;
    }

    // Últimos 6 meses — conservar uno por mes (el día 1)
    if (diasAtras <= 180) {
      if (fecha.getDate() === 1) aConservar.add(archivo.name);
    }
    // Más de 6 meses — eliminar
  }

  const aEliminar = data
    .filter((f) => !aConservar.has(f.name))
    .map((f) => f.name);

  if (!aEliminar.length) return 0;

  await supabase.storage.from('backups').remove(aEliminar);
  return aEliminar.length;
};

// ── Función principal ─────────────────────────────────────────────────────
const ejecutarBackup = async () => {
  const d      = new Date();
  const fecha  = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const hora   = `${String(d.getHours()).padStart(2,'0')}-${String(d.getMinutes()).padStart(2,'0')}`;
  const nombre = `backup_${fecha}_${hora}.json`;

  // 1. Generar dump
  const dump = await _generarDumpJSON();

  const totalRegistros = Object.values(dump.tablas)
    .reduce((s, rows) => s + rows.length, 0);

  // 2. Subir a Supabase
  const archivo = await _subirASupabase(dump, nombre);

  // 3. Limpiar antiguos
  const eliminados = await _limpiarBackupsInteligente();

  return {
    ok:                  true,
    archivo:             nombre,
    path:                archivo.path,
    fecha:               d.toISOString(),
    total_registros:     totalRegistros,
    tablas:              Object.keys(dump.tablas).length,
    eliminados_antiguos: eliminados,
  };
};

module.exports = { ejecutarBackup, listarBackups };