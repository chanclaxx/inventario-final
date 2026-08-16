const { verificarVencimientos } = require('../modules/superadmin/superadmin.service');
const { enviarAvisoVencimiento } = require('../modules/email/email.service');

// Los borradores vencidos se filtran al leer, así que dejan de verse y de
// reservar solos — pero las filas se quedarían para siempre. Se barren aquí y no
// en el cron de notificaciones porque este job corre SIEMPRE, mientras que aquel
// ni se registra si faltan las claves VAPID.
//
// En su propio try/catch: si la migración de borradores no está aplicada, el
// job de vencimientos —que es lo que mantiene vivo el cobro de los planes— no
// puede caerse por eso.
const purgarBorradores = async () => {
  try {
    const repo = require('../modules/borradores/borradores.repository');
    const borrados = await repo.purgarVencidos();
    if (borrados > 0) console.log(`🧹 Borradores vencidos purgados: ${borrados}`);
  } catch (err) {
    if (err?.code !== '42P01') {  // 42P01 = la tabla aún no existe
      console.error('⚠️  No se pudieron purgar los borradores vencidos:', err.message);
    }
  }
};

const ejecutar = async () => {
  try {
    console.log('⏰ Verificando vencimientos...');
    const { vencidos, porVencer } = await verificarVencimientos();

    // Notificar negocios por vencer
    for (const negocio of porVencer) {
      await enviarAvisoVencimiento(negocio).catch(err =>
        console.error(`Error enviando aviso a ${negocio.email}:`, err.message)
      );
    }

    console.log(`✅ Vencidos: ${vencidos.length} | Por vencer: ${porVencer.length}`);
  } catch (err) {
    console.error('❌ Error en job de vencimientos:', err.message);
  }

  await purgarBorradores();
};

module.exports = { ejecutar };