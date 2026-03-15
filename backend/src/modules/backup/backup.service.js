const { exec }   = require('child_process');
const { google } = require('googleapis');
const path       = require('path');
const fs         = require('fs');
const os         = require('os');

// ── Autenticación con Google Drive ────────────────────────────────────────
const _getAuthClient = () => {
  return new google.auth.JWT({
    email:      process.env.GOOGLE_CLIENT_EMAIL,
    key:        process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes:     ['https://www.googleapis.com/auth/drive.file'],
  });
};

// ── Ejecutar pg_dump y guardar en archivo temporal ────────────────────────
const _generarDump = () => {
  return new Promise((resolve, reject) => {
    const fecha     = new Date().toISOString().slice(0, 10);
    const hora      = new Date().toTimeString().slice(0, 8).replace(/:/g, '-');
    const nombre    = `backup_${fecha}_${hora}.dump`;
    const rutaTemp  = path.join(os.tmpdir(), nombre);

    const cmd = `pg_dump "${process.env.DATABASE_URL}" --format=custom --no-password --file="${rutaTemp}"`;

    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        reject({ message: `Error generando dump: ${stderr || err.message}` });
        return;
      }
      resolve({ rutaTemp, nombre });
    });
  });
};

// ── Subir archivo a Google Drive ──────────────────────────────────────────
const _subirADrive = async (rutaTemp, nombre) => {
  const auth  = _getAuthClient();
  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.files.create({
    requestBody: {
      name:    nombre,
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
    },
    media: {
      mimeType: 'application/octet-stream',
      body:     fs.createReadStream(rutaTemp),
    },
    fields: 'id, name, size, createdTime',
  });

  return res.data;
};

// ── Limpiar archivo temporal ──────────────────────────────────────────────
const _limpiarTemp = (rutaTemp) => {
  try {
    fs.unlinkSync(rutaTemp);
  } catch {
    // Si falla no es crítico
  }
};

// ── Listar backups existentes en Drive ────────────────────────────────────
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

// ── Eliminar backups antiguos — mantener solo los últimos N ───────────────
const _limpiarBackupsAntiguos = async (mantener = 30) => {
  const auth  = _getAuthClient();
  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.files.list({
    q:        `'${process.env.GOOGLE_DRIVE_FOLDER_ID}' in parents and trashed = false`,
    fields:   'files(id, name, createdTime)',
    orderBy:  'createdTime desc',
  });

  const archivos = res.data.files || [];
  const aEliminar = archivos.slice(mantener);

  for (const archivo of aEliminar) {
    await drive.files.delete({ fileId: archivo.id });
  }

  return aEliminar.length;
};

// ── Función principal ─────────────────────────────────────────────────────
const ejecutarBackup = async () => {
  let rutaTemp = null;

  try {
    // 1. Generar dump
    const { rutaTemp: rt, nombre } = await _generarDump();
    rutaTemp = rt;

    // 2. Subir a Drive
    const archivo = await _subirADrive(rutaTemp, nombre);

    // 3. Limpiar temp
    _limpiarTemp(rutaTemp);

    // 4. Eliminar backups antiguos — mantiene los últimos 30
    const eliminados = await _limpiarBackupsAntiguos(30);

    return {
      ok:        true,
      archivo:   archivo.name,
      id_drive:  archivo.id,
      size:      archivo.size,
      fecha:     archivo.createdTime,
      eliminados_antiguos: eliminados,
    };
  } catch (err) {
    if (rutaTemp) _limpiarTemp(rutaTemp);
    throw err;
  }
};

module.exports = { ejecutarBackup, listarBackups };