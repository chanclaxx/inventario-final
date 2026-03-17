require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');

const { validateEnv }      = require('./config/env');
const { connectDB }        = require('./config/db');
const { auth }             = require('./middlewares/auth.middleware');
const { verificarPlan }    = require('./middlewares/plan.middleware');
const { resolveSucursal }  = require('./middlewares/sucursal.middleware');
const { errorHandler }     = require('./middlewares/error.middleware');
const { ejecutar: verificarVencimientos } = require('./jobs/vencimientos.job');
const { iniciarCronBackup } = require('./modules/backup/backup.cron');

validateEnv();

const app = express();
app.set('trust proxy', 1);

// ── Middlewares globales ──────────────────────────────
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      process.env.FRONTEND_URL,
      'http://localhost:5173',
    ].filter(Boolean);
    if (!origin || allowed.includes(origin)) return callback(null, true);
    callback(new Error('No permitido por CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// ── Rate limiting global ──────────────────────────────
app.use('/api/', rateLimit({
  windowMs:        60 * 1000,
  max:             60,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { ok: false, error: 'Demasiadas solicitudes. Intenta más tarde.' },
  skip:            (req) => req.path === '/health',
}));

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
app.use('/api/prestatarios',       protegida, require('./modules/prestatarios/prestatarios.routes'));
app.use('/api/compras',            protegida, require('./modules/compras/compras.routes'));
app.use('/api/acreedores',         protegida, require('./modules/acreedores/acreedores.routes'));
app.use('/api/reportes',           protegida, require('./modules/reportes/reportes.routes'));
app.use('/api/clientes',           protegida, require('./modules/clientes/clientes.routes'));
app.use('/api/garantias',          protegida, require('./modules/garantias/garantias.routes'));
app.use('/api/config',             protegida, require('./modules/config/config.routes'));
app.use('/api/importacion',        protegida, require('./modules/importacion/importacion.routes'));
app.use('/api/inventario',         protegida, require('./modules/inventario/inventario.export.routes'));
app.use('/api/sucursales',         protegida, require('./modules/sucursales/sucursales.routes'));
app.use('/api/lineas',             protegida, require('./modules/lineas/lineas.routes'));

// ── Rutas de superadmin (sin protegida) ───────────────
app.use('/api/superadmin', require('./modules/superadmin/superadmin.routes'));

// ── Middleware de errores (siempre al final) ──────────
app.use(errorHandler);

process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err.message, err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
});

// ── Iniciar servidor ──────────────────────────────────
const PORT = process.env.PORT || 3001;

const start = async () => {
  await connectDB();

  verificarVencimientos();
  setInterval(verificarVencimientos, 24 * 60 * 60 * 1000);

  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  });

  iniciarCronBackup();
};

start();