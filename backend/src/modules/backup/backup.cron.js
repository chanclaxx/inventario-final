const cron = require('node-cron');
const { ejecutarBackupConAlertas } = require('./backup.service');

// ── Configuración ─────────────────────────────────────────────────────────────
// Backup diario a las 2:00 AM por defecto — configurable con BACKUP_CRON
// (ej. "0 */6 * * *" para cada 6 horas) sin tocar código.
// Retención: 7 días completos, uno por semana hasta 28 días, uno por mes
// hasta 180 días — ver backup.service.js.
// Si falla: loguea, alerta por email (BACKUP_ALERT_EMAIL) y notifica al
// heartbeat (BACKUP_HEALTHCHECK_URL) — nunca interrumpe el servidor.

const CRON_POR_DEFECTO = '0 2 * * *'; // Cada día a las 2:00 AM

const _resolverExpresion = () => {
  const custom = process.env.BACKUP_CRON;
  if (!custom) return CRON_POR_DEFECTO;
  if (cron.validate(custom)) return custom;
  console.warn(`[backup-cron] BACKUP_CRON inválida ("${custom}") — usando "${CRON_POR_DEFECTO}"`);
  return CRON_POR_DEFECTO;
};

// ── Iniciar el cron ───────────────────────────────────────────────────────────

const iniciarCronBackup = () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.warn('[backup-cron] Variables SUPABASE_URL o SUPABASE_SERVICE_KEY no configuradas — cron desactivado');
    return;
  }

  const expresion = _resolverExpresion();

  cron.schedule(expresion, async () => {
    console.log(`[backup-cron] Iniciando backup automático — ${new Date().toISOString()}`);
    const resultado = await ejecutarBackupConAlertas();
    if (resultado.ok) {
      const nota = resultado.advertencia ? ` | ⚠ ${resultado.advertencia}` : '';
      console.log(`[backup-cron] ✓ Backup completado: ${resultado.archivo} | ${resultado.total_registros} registros | ${resultado.eliminados_antiguos} backups eliminados${nota}`);
    } else {
      console.error(`[backup-cron] ✗ Error en backup automático: ${resultado.error}`);
    }
  }, {
    timezone: 'America/Bogota',
  });

  console.log(`[backup-cron] Cron de backup activado — ${expresion} (America/Bogota)`);
};

module.exports = { iniciarCronBackup };
