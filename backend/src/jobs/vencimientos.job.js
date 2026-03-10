const { verificarVencimientos } = require('../modules/superadmin/superadmin.service');
const { enviarAvisoVencimiento } = require('../modules/email/email.service');

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
};

module.exports = { ejecutar };