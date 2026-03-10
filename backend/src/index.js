require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const cookieParser = require('cookie-parser');

const { validateEnv }      = require('./config/env');
const { connectDB }        = require('./config/db');
const { auth }             = require('./middlewares/auth.middleware');
const { verificarPlan }    = require('./middlewares/plan.middleware');
const { resolveSucursal }  = require('./middlewares/sucursal.middleware');
const { errorHandler }     = require('./middlewares/error.middleware');

validateEnv();

const app = express();

// ── Middlewares globales ──────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// ── Ruta de salud ─────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Servidor funcionando correctamente' });
});

// ── Rutas públicas (sin auth) ─────────────────────────
app.use('/api/auth',     require('./modules/auth/auth.routes'));
app.use('/api/registro', require('./modules/registro/registro.routes'));

// ── Rutas protegidas (auth + verificarPlan + resolveSucursal) ─────────────
const protegida = [auth, verificarPlan, resolveSucursal];

app.use('/api/usuarios',           protegida, require('./modules/usuarios/usuarios.routes'));
app.use('/api/productos-serial',   protegida, require('./modules/productos/productosSerial.routes'));
app.use('/api/productos-cantidad', protegida, require('./modules/productos/productosCantidad.routes'));
app.use('/api/facturas',           protegida, require('./modules/facturas/facturas.routes'));
app.use('/api/prestamos',          protegida, require('./modules/prestamos/prestamos.routes'));
app.use('/api/creditos',           protegida, require('./modules/creditos/creditos.routes'));
app.use('/api/caja',               protegida, require('./modules/caja/caja.routes'));
app.use('/api/proveedores',        protegida, require('./modules/proveedores/proveedores.routes'));
app.use('/api/compras',            protegida, require('./modules/compras/compras.routes'));
app.use('/api/acreedores',         protegida, require('./modules/acreedores/acreedores.routes'));
app.use('/api/reportes',           protegida, require('./modules/reportes/reportes.routes'));
app.use('/api/clientes',           protegida, require('./modules/clientes/clientes.routes'));
app.use('/api/garantias',          protegida, require('./modules/garantias/garantias.routes'));
app.use('/api/config',             protegida, require('./modules/config/config.routes'));
app.use('/api/importacion',        protegida, require('./modules/importacion/importacion.routes'));
app.use('/api/inventario',         protegida, require('./modules/inventario/inventario.export.routes'));
app.use('/api/sucursales',         protegida, require('./modules/sucursales/sucursales.routes'));

// ── Rutas de superadmin (sin protegida) ───────────────
app.use('/api/superadmin', require('./modules/superadmin/superadmin.routes'));

// ── Middleware de errores (siempre al final) ──────────
app.use(errorHandler);

// ── Iniciar servidor ──────────────────────────────────
const PORT = process.env.PORT || 3001;

const start = async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  });
};

start();