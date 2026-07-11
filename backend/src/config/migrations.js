const { pool } = require('./db');

const runMigrations = async () => {
  // ── Auto-aplicadas al arrancar (100% aditivas e idempotentes) ──────────────
  // Notas / post-it de inventario — ver migrations/20260710_notas_inventario.sql
  await pool.query(`
    ALTER TABLE IF EXISTS seriales           ADD COLUMN IF NOT EXISTS nota TEXT;
    ALTER TABLE IF EXISTS productos_serial   ADD COLUMN IF NOT EXISTS nota TEXT;
    ALTER TABLE IF EXISTS productos_cantidad ADD COLUMN IF NOT EXISTS nota TEXT;
  `);

  // Aplicadas manualmente en producción:
  // - lineas_traslado: revertida_por_usuario_id, fecha_reversion
  // - traslados: revertido_por_usuario_id, fecha_reversion
  // - lineas_compra: producto_id (para revertir stock de productos cantidad simples al cancelar)
  //   ALTER TABLE lineas_compra ADD COLUMN IF NOT EXISTS producto_id integer REFERENCES productos_cantidad(id);
  // - movimientos_acreedor: sucursal_id (caja de proveedores por sucursal) — ver migrations/20260628_movimientos_acreedor_sucursal.sql
  //   ALTER TABLE movimientos_acreedor ADD COLUMN IF NOT EXISTS sucursal_id integer; + backfill por compra
  // - vendedores: catálogo de vendedores por negocio/sucursal + facturas.vendedor_id — ver migrations/20260706_vendedores.sql
  //   CREATE TABLE vendedores(...); ALTER TABLE facturas ADD COLUMN IF NOT EXISTS vendedor_id integer;
  //
  // Pendiente de aplicar manualmente (opcional, 100% aditiva):
  // - auditoria_eliminaciones: papelera ante borrados por error — ver migrations/20260709_auditoria_eliminaciones.sql
  //   CREATE TABLE auditoria_eliminaciones(...) + triggers BEFORE DELETE en tablas de negocio. Idempotente.
  // - tesoreria: cuentas de dinero + movimientos + arqueos — ver migrations/20260709_tesoreria.sql
  //   CREATE TABLE cuentas_dinero / movimientos_dinero / arqueos_cuenta. Idempotente. REQUERIDA para el módulo Tesorería.
  // - tesoreria divisa (USD): columnas moneda y tasa_cambio — ver migrations/20260710_tesoreria_divisa.sql
  //   Idempotente; aplicar después de 20260709_tesoreria.sql (la versión actual de 20260709 ya las incluye).
  // - tesoreria pago-compra: proveedor_id/compra_id en movimientos_dinero — ver migrations/20260710_tesoreria_pago_compra.sql
  //   Idempotente; permite asignar "Pagué mercancía" a proveedor/compra y bloquear dobles pagos.
  // - tesoreria abono espejo: mov_dinero_id en movimientos_acreedor + backfill — ver migrations/20260710_tesoreria_abono_espejo.sql
  //   Idempotente; un pago de compra desde Tesorería crea un Abono (registrar_en_caja=FALSE) que salda la deuda del acreedor.
  console.log('✅ Migraciones: sin pendientes.');
};

module.exports = { runMigrations };