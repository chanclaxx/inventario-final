const { pool } = require('../../config/db');
const { google } = require('googleapis');
const { Readable } = require('stream');

// ── Autenticación con Google Drive ────────────────────────────────────────
const _getAuthClient = () => {
  return new google.auth.JWT({
    email:  process.env.GOOGLE_CLIENT_EMAIL,
    key:    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
};

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
    version:   '1.0',
    fecha:     new Date().toISOString(),
    tablas:    {},
  };

  const client = await pool.connect();
  try {
    for (const tabla of tablas) {
      try {
        const { rows } = await client.query(`SELECT * FROM ${tabla} ORDER BY id`);
        dump.tablas[tabla] = rows;
      } catch {
        // Tabla no existe en este schema — omitir sin error
        dump.tablas[tabla] = [];
      }
    }
  } finally {
    client.release();
  }

  return dump;
};

// ── Subir JSON a Google Drive ─────────────────────────────────────────────
const _subirADrive = async (contenido, nombre) => {
  const auth  = _getAuthClient();
  const drive = google.drive({ version: 'v3', auth });

  const buffer   = Buffer.from(JSON.stringify(contenido, null, 2), 'utf-8');
  const readable = Readable.from(buffer);

  const res = await drive.files.create({
    requestBody: {
      name:    nombre,
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
    },
    media: {
      mimeType: 'application/json',
      body:     readable,
    },
    fields: 'id, name, size, createdTime',
  });

  return res.data;
};

// ── Listar backups ────────────────────────────────────────────────────────
const listarBackups = async () => {
  const auth  = _getAuthClient();
  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.files.list({
    q:        `'${process.env.GOOGLE_DRIVE_FOLDER_ID}' in parents and trashed = false`,
    fields:   'files(id, name, size, createdTime)',
    orderBy:  'createdTime desc',
    pageSize: 30,
  });

  return res.data.files;
};

// ── Eliminar backups antiguos ─────────────────────────────────────────────
const _limpiarBackupsAntiguos = async (mantener = 30) => {
  const auth  = _getAuthClient();
  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.files.list({
    q:        `'${process.env.GOOGLE_DRIVE_FOLDER_ID}' in parents and trashed = false`,
    fields:   'files(id, name, createdTime)',
    orderBy:  'createdTime desc',
  });

  const archivos  = res.data.files || [];
  const aEliminar = archivos.slice(mantener);

  for (const archivo of aEliminar) {
    await drive.files.delete({ fileId: archivo.id });
  }

  return aEliminar.length;
};

// ── Función principal ─────────────────────────────────────────────────────
const ejecutarBackup = async () => {
  const d     = new Date();
  const fecha = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const hora  = `${String(d.getHours()).padStart(2,'0')}-${String(d.getMinutes()).padStart(2,'0')}`;
  const nombre = `backup_${fecha}_${hora}.json`;

  // 1. Generar dump como JSON
  const dump = await _generarDumpJSON();

  // Contar total de registros
  const totalRegistros = Object.values(dump.tablas)
    .reduce((s, rows) => s + rows.length, 0);

  // 2. Subir a Drive
  const archivo = await _subirADrive(dump, nombre);

  // 3. Limpiar antiguos
  const eliminados = await _limpiarBackupsAntiguos(30);

  return {
    ok:               true,
    archivo:          archivo.name,
    id_drive:         archivo.id,
    size:             archivo.size,
    fecha:            archivo.createdTime,
    total_registros:  totalRegistros,
    tablas:           Object.keys(dump.tablas).length,
    eliminados_antiguos: eliminados,
  };
};

module.exports = { ejecutarBackup, listarBackups };