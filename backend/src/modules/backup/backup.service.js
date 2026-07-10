const { pool }                = require('../../config/db');
const { createClient }        = require('@supabase/supabase-js');
const { enviarAlertaBackup }  = require('../email/email.service');

// ── Cliente Supabase ──────────────────────────────────────────────────────
const _getSupabase = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BUCKET       = 'backups';
const META_ARCHIVO = 'meta_ultimo_backup.json';

// Solo los archivos con este patrón participan en la retención — protege
// meta_ultimo_backup.json y la carpeta pgdump/ de ser eliminados.
const PATRON_BACKUP = /^backup_[\w-]+\.json$/;

// ── Listar tablas del esquema public dinámicamente ────────────────────────
// Cada tabla nueva queda incluida sin tocar código. Se detecta si tiene
// columna id para mantener el orden estable de los dumps.
const _listarTablas = async (client) => {
  const { rows } = await client.query(`
    SELECT t.table_name AS tabla,
           EXISTS (
             SELECT 1 FROM information_schema.columns c
             WHERE c.table_schema = 'public'
               AND c.table_name   = t.table_name
               AND c.column_name  = 'id'
           ) AS tiene_id
    FROM information_schema.tables t
    WHERE t.table_schema = 'public'
      AND t.table_type   = 'BASE TABLE'
    ORDER BY t.table_name
  `);
  return rows;
};

// ── Exportar todas las tablas como JSON ───────────────────────────────────
// Snapshot REPEATABLE READ: todas las tablas se leen en el mismo instante
// lógico — una factura creada a mitad del proceso no queda sin sus líneas.
// Si alguna tabla falla, el backup completo falla (nunca respaldos a medias).
const _generarDumpJSON = async () => {
  const dump = {
    version: '2.0',
    fecha:   new Date().toISOString(),
    tablas:  {},
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

    const tablas  = await _listarTablas(client);
    const errores = [];

    for (const { tabla, tiene_id } of tablas) {
      const nombreSeguro = `"${tabla.replace(/"/g, '""')}"`;
      const orden        = tiene_id ? ' ORDER BY id' : '';
      try {
        const { rows } = await client.query(`SELECT * FROM ${nombreSeguro}${orden}`);
        dump.tablas[tabla] = rows;
      } catch (err) {
        errores.push(`${tabla}: ${err.message}`);
      }
    }

    await client.query('COMMIT');

    if (errores.length) {
      throw { status: 500, message: `Backup abortado — tablas con error: ${errores.join(' | ')}` };
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return dump;
};

// ── Subir a Supabase Storage ──────────────────────────────────────────────
const _subirASupabase = async (contenido, nombre) => {
  const supabase = _getSupabase();
  const buffer   = Buffer.from(JSON.stringify(contenido), 'utf-8');

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(nombre, buffer, {
      contentType: 'application/json',
      upsert:      false,
    });

  if (error) throw { status: 500, message: `Error subiendo backup: ${error.message}` };
  return data;
};

// ── Metadatos del último backup exitoso ───────────────────────────────────
// Sirven de línea base: si un backup nuevo trae muchos menos registros que
// el anterior, algo anda mal y no se limpia nada.
const _leerMeta = async () => {
  try {
    const supabase        = _getSupabase();
    const { data, error } = await supabase.storage.from(BUCKET).download(META_ARCHIVO);
    if (error || !data) return null;
    return JSON.parse(await data.text());
  } catch {
    return null;
  }
};

const _guardarMeta = async (meta) => {
  try {
    const supabase = _getSupabase();
    const buffer   = Buffer.from(JSON.stringify(meta), 'utf-8');
    await supabase.storage
      .from(BUCKET)
      .upload(META_ARCHIVO, buffer, { contentType: 'application/json', upsert: true });
  } catch (err) {
    console.warn('[backup] No se pudo guardar meta:', err?.message || err);
  }
};

// ── Listar backups ────────────────────────────────────────────────────────
const listarBackups = async () => {
  const supabase = _getSupabase();

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list('', {
      limit:  50,
      offset: 0,
      sortBy: { column: 'created_at', order: 'desc' },
    });

  if (error) throw { status: 500, message: `Error listando backups: ${error.message}` };
  // Solo archivos de backup — oculta meta_ultimo_backup.json y la carpeta
  // pgdump/ para que el historial del panel se vea igual que siempre.
  return (data || []).filter((f) => PATRON_BACKUP.test(f.name));
};

// ── URL firmada para descargar un backup (expira en 5 minutos) ────────────
const generarUrlDescarga = async (nombre) => {
  if (!/^[\w.-]+\.json$/.test(nombre) || nombre.includes('..')) {
    throw { status: 400, message: 'Nombre de archivo inválido' };
  }

  const supabase        = _getSupabase();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(nombre, 300);

  if (error) throw { status: 500, message: `Error generando URL de descarga: ${error.message}` };
  return data.signedUrl;
};

// ── Eliminar backups antiguos ─────────────────────────────────────────────
// Política: últimos 7 días completos, uno por semana hasta 28 días, uno por
// mes hasta 180 días. Los 7 archivos más recientes se conservan SIEMPRE,
// sin importar fechas — red de seguridad ante relojes o metadatos raros.
const _limpiarBackupsInteligente = async () => {
  const supabase = _getSupabase();
  const { data } = await supabase.storage
    .from(BUCKET)
    .list('', { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } });

  const candidatos = (data || []).filter((f) => PATRON_BACKUP.test(f.name));
  if (!candidatos.length) return 0;

  const ahora      = new Date();
  const aConservar = new Set(candidatos.slice(0, 7).map((f) => f.name));
  const porSemana  = new Set();
  const porMes     = new Set();

  // candidatos viene ordenado del más reciente al más viejo: el primero que
  // aparece en cada semana/mes es el más reciente de ese periodo.
  for (const archivo of candidatos) {
    const fecha     = new Date(archivo.created_at);
    const diasAtras = (ahora - fecha) / (1000 * 60 * 60 * 24);

    if (diasAtras <= 7) { aConservar.add(archivo.name); continue; }

    if (diasAtras <= 28) {
      const semana = Math.floor(fecha.getTime() / (7 * 24 * 60 * 60 * 1000));
      if (!porSemana.has(semana)) { porSemana.add(semana); aConservar.add(archivo.name); }
      continue;
    }

    if (diasAtras <= 180) {
      const mes = `${fecha.getFullYear()}-${fecha.getMonth()}`;
      if (!porMes.has(mes)) { porMes.add(mes); aConservar.add(archivo.name); }
    }
    // Más de 6 meses — eliminar
  }

  const aEliminar = candidatos
    .filter((f) => !aConservar.has(f.name))
    .map((f) => f.name);

  if (!aEliminar.length) return 0;

  await supabase.storage.from(BUCKET).remove(aEliminar);
  return aEliminar.length;
};

// ── Heartbeat opcional (healthchecks.io o similar) ────────────────────────
// Si BACKUP_HEALTHCHECK_URL no está configurada, no hace nada.
const _pingHeartbeat = async (exito) => {
  const base = process.env.BACKUP_HEALTHCHECK_URL;
  if (!base) return;
  const url = exito ? base : `${base.replace(/\/+$/, '')}/fail`;
  try {
    await fetch(url, { method: 'POST', signal: AbortSignal.timeout(10000) });
  } catch (err) {
    console.warn('[backup] No se pudo hacer ping al heartbeat:', err?.message || err);
  }
};

// ── Función principal ─────────────────────────────────────────────────────
const ejecutarBackup = async () => {
  const d      = new Date();
  const fecha  = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const hora   = `${String(d.getHours()).padStart(2,'0')}-${String(d.getMinutes()).padStart(2,'0')}`;
  const nombre = `backup_${fecha}_${hora}.json`;

  // 1. Generar dump (falla completo si alguna tabla falla)
  const dump = await _generarDumpJSON();

  const totalRegistros = Object.values(dump.tablas)
    .reduce((s, rows) => s + rows.length, 0);

  // 2. Subir a Supabase
  const archivo = await _subirASupabase(dump, nombre);

  // 3. Validar contra el backup anterior antes de limpiar nada.
  //    Si el nuevo trae menos de la mitad de registros que el anterior,
  //    se conserva TODO el historial y se alerta — nunca se borra evidencia.
  const metaAnterior = await _leerMeta();
  const sospechoso   = metaAnterior?.total_registros > 0
    && totalRegistros < metaAnterior.total_registros * 0.5;

  let eliminados = 0;
  if (sospechoso) {
    console.warn(`[backup] ⚠ Backup sospechoso: ${totalRegistros} registros vs ${metaAnterior.total_registros} del anterior — limpieza omitida`);
    await enviarAlertaBackup({
      asunto:   'Backup sospechoso — revisar de inmediato',
      detalles: `El backup ${nombre} tiene ${totalRegistros} registros, pero el anterior tenía ${metaAnterior.total_registros}. ` +
                `Una caída tan fuerte puede indicar pérdida de datos en la base. No se eliminó ningún backup antiguo.`,
    });
  } else if (totalRegistros > 0) {
    await _guardarMeta({
      fecha:           d.toISOString(),
      archivo:         nombre,
      total_registros: totalRegistros,
      tablas:          Object.keys(dump.tablas).length,
    });
    eliminados = await _limpiarBackupsInteligente();
  }

  await _pingHeartbeat(true);

  return {
    ok:                  true,
    archivo:             nombre,
    path:                archivo.path,
    fecha:               d.toISOString(),
    total_registros:     totalRegistros,
    tablas:              Object.keys(dump.tablas).length,
    eliminados_antiguos: eliminados,
    advertencia:         sospechoso
      ? 'Backup con muchos menos registros que el anterior — limpieza omitida y alerta enviada'
      : null,
  };
};

// ── Backup con notificación de fallos — usado por el cron ─────────────────
// Nunca lanza: alerta por email, hace ping de fallo al heartbeat y devuelve
// el error para que el caller decida qué loguear.
const ejecutarBackupConAlertas = async () => {
  try {
    return await ejecutarBackup();
  } catch (err) {
    const mensaje = err?.message || String(err);
    await _pingHeartbeat(false);
    await enviarAlertaBackup({
      asunto:   'Falló el backup automático',
      detalles: `El backup automático falló con el siguiente error:\n\n${mensaje}\n\n` +
                `Mientras no se resuelva, no se están generando copias nuevas de la base de datos.`,
    });
    return { ok: false, error: mensaje };
  }
};

module.exports = {
  ejecutarBackup,
  ejecutarBackupConAlertas,
  listarBackups,
  generarUrlDescarga,
};
