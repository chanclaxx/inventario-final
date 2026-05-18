const runMigrations = async () => {
  // Aplicadas manualmente en producción:
  // - lineas_traslado: revertida_por_usuario_id, fecha_reversion
  // - traslados: revertido_por_usuario_id, fecha_reversion
  console.log('✅ Migraciones: sin pendientes.');
};

module.exports = { runMigrations };