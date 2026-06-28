const runMigrations = async () => {
  // Aplicadas manualmente en producción:
  // - lineas_traslado: revertida_por_usuario_id, fecha_reversion
  // - traslados: revertido_por_usuario_id, fecha_reversion
  // - lineas_compra: producto_id (para revertir stock de productos cantidad simples al cancelar)
  //   ALTER TABLE lineas_compra ADD COLUMN IF NOT EXISTS producto_id integer REFERENCES productos_cantidad(id);
  // - movimientos_acreedor: sucursal_id (caja de proveedores por sucursal) — ver migrations/20260628_movimientos_acreedor_sucursal.sql
  //   ALTER TABLE movimientos_acreedor ADD COLUMN IF NOT EXISTS sucursal_id integer; + backfill por compra
  console.log('✅ Migraciones: sin pendientes.');
};

module.exports = { runMigrations };