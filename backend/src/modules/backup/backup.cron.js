const cron            = require('node-cron');
const { ejecutarBackup } = require('./backup.service');

// ── Configuración ─────────────────────────────────────────────────────────────
// Backup diario a las 2:00 AM — hora en que el sistema tiene menos actividad.
// Mantiene los últimos 30 backups (~1 mes de historial).
// Si falla, solo loguea — nunca interrumpe el servidor.

const CRON_EXPRESION = '0 2 * * *'; // Cada día a las 2:00 AM

// ── Iniciar el cron ───────────────────────────────────────────────────────────

const iniciarCronBackup = () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.warn('[backup-cron] Variables SUPABASE_URL o SUPABASE_SERVICE_KEY no configuradas — cron desactivado');
    return;
  }

  cron.schedule(CRON_EXPRESION, async () => {
    console.log(`[backup-cron] Iniciando backup automático — ${new Date().toISOString()}`);
    try {
      const resultado = await ejecutarBackup();
      console.log(`[backup-cron] ✓ Backup completado: ${resultado.archivo} | ${resultado.total_registros} registros | ${resultado.eliminados_antiguos} backups eliminados`);
    } catch (err) {
      console.error('[backup-cron] ✗ Error en backup automático:', err?.message || err);
    }
  }, {
    timezone: 'America/Bogota',
  });

  console.log(`[backup-cron] Cron de backup activado — ${CRON_EXPRESION} (America/Bogota)`);
};

module.exports = { iniciarCronBackup };