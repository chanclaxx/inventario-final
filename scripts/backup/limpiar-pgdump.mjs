// ─────────────────────────────────────────────────────────────────────────────
// Retención de dumps pg_dump en Supabase Storage (bucket backups/pgdump/).
// Conserva los CONSERVAR más recientes y elimina el resto. Usado por el
// workflow .github/workflows/backup-pgdump.yml — también se puede correr a
// mano con las mismas variables de entorno.
//
// Solo toca archivos pgdump_*.dump dentro de pgdump/ — nunca los backups
// JSON del backend ni el archivo de metadatos.
//
// Requiere: BACKUP_SUPABASE_URL, BACKUP_SUPABASE_SERVICE_KEY (Node >= 18)
// ─────────────────────────────────────────────────────────────────────────────

const CONSERVAR = 60; // a 4 backups/día ≈ 15 días de historial binario

const URL_BASE = process.env.BACKUP_SUPABASE_URL?.replace(/\/+$/, '');
const KEY      = process.env.BACKUP_SUPABASE_SERVICE_KEY;

if (!URL_BASE || !KEY) {
  console.error('Faltan BACKUP_SUPABASE_URL o BACKUP_SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const cabeceras = {
  'Authorization': `Bearer ${KEY}`,
  'Content-Type':  'application/json',
};

const listar = async () => {
  const res = await fetch(`${URL_BASE}/storage/v1/object/list/backups`, {
    method:  'POST',
    headers: cabeceras,
    body:    JSON.stringify({
      prefix: 'pgdump/',
      limit:  1000,
      sortBy: { column: 'created_at', order: 'desc' },
    }),
  });
  if (!res.ok) throw new Error(`Error listando (HTTP ${res.status}): ${await res.text()}`);
  return res.json();
};

const eliminar = async (nombres) => {
  const res = await fetch(`${URL_BASE}/storage/v1/object/backups`, {
    method:  'DELETE',
    headers: cabeceras,
    body:    JSON.stringify({ prefixes: nombres }),
  });
  if (!res.ok) throw new Error(`Error eliminando (HTTP ${res.status}): ${await res.text()}`);
};

const main = async () => {
  const archivos = (await listar())
    .filter((f) => /^pgdump_[\w-]+\.dump$/.test(f.name));

  console.log(`Dumps encontrados: ${archivos.length} (se conservan hasta ${CONSERVAR})`);

  const aEliminar = archivos.slice(CONSERVAR).map((f) => `pgdump/${f.name}`);
  if (!aEliminar.length) {
    console.log('Nada que eliminar.');
    return;
  }

  await eliminar(aEliminar);
  console.log(`Eliminados ${aEliminar.length} dumps antiguos.`);
};

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
