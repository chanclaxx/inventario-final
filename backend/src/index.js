require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');
const compression  = require('compression');

const { validateEnv }      = require('./config/env');
const { connectDB }        = require('./config/db');
const { runMigrations }    = require('./config/migrations');
const { detectarColumnas } = require('./config/columnas');
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
// Gzip de las respuestas. Pesa poco en JSON chico y hace la diferencia en los
// payloads grandes (exportación de inventario, reportes), que son puro texto
// repetido y bajan alrededor de un 90%.
app.use(compression());

// ── Catálogo web público ──────────────────────────────
//
// Se monta ANTES del CORS con whitelist y del rate limiter global, y por eso
// va tan arriba. Tres razones concretas:
//
//   1. CORS: la whitelist de abajo rechaza cualquier origen que no sea la app
//      interna. El catálogo se sirve desde otro dominio y es contenido público
//      de solo lectura, sin cookies ni credenciales, así que lleva su propio
//      CORS abierto. La whitelist estricta del resto de /api no se toca.
//   2. Rate limit: los 60 req/min de abajo están pensados para una sesión
//      humana. Aquí las peticiones llegan desde el renderizador de la app
//      pública — pocas IPs con el volumen de todos los visitantes agregado.
//   3. No puede pasar por [auth, verificarPlan, resolveSucursal]: no hay sesión
//      ni sucursal que resolver.
//
// Con el caché del CDN el backend ve ~1 petición cada 5 minutos por vitrina,
// así que 300/min sobra y a la vez sigue frenando un abuso.
app.use('/api/publico/catalogo',
  cors({ origin: '*', credentials: false, methods: ['GET'] }),
  rateLimit({
    windowMs:        60 * 1000,
    max:             300,
    standardHeaders: true,
    legacyHeaders:   false,
    message:         { ok: false, error: 'Demasiadas solicitudes. Intenta más tarde.' },
  }),
  require('./modules/catalogo/catalogo.publico.routes'));

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
app.use('/api/cruces',             protegida, require('./modules/cruces/cruces.routes'));
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
app.use('/api/domiciliarios',      protegida, require('./modules/domiciliarios/domiciliarios.routes'));
app.use('/api/vendedores',         protegida, require('./modules/vendedores/vendedores.routes'));
app.use('/api/servicios',          protegida, require('./modules/servicios/servicios.routes'));
app.use('/api/traslados',          protegida, require('./modules/traslados/traslados.routes'));
app.use('/api/red-interna',        protegida, require('./modules/red-interna/redInterna.routes'));
app.use('/api/busqueda',           protegida, require('./modules/busqueda/busqueda.routes'));
app.use('/api/tesoreria',          protegida, require('./modules/tesoreria/tesoreria.routes'));
app.use('/api/tipos-caracteristica', protegida, require('./modules/tipos-caracteristica/tipos-caracteristica.routes'));
app.use('/api/variantes-producto',   protegida, require('./modules/variantes-producto/variantes-producto.routes'));
app.use('/api/ubicaciones',          protegida, require('./modules/ubicaciones/ubicaciones.routes'));
app.use('/api/notificaciones',       protegida, require('./modules/notificaciones/notificaciones.routes'));
app.use('/api/catalogo',             protegida, require('./modules/catalogo/catalogo.routes'));

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
  await runMigrations();
  // Después de las migraciones: si alguna columna opcional no llegó a crearse,
  // su feature se apaga sola en vez de romper las consultas que la usan.
  await detectarColumnas();

  verificarVencimientos();
  setInterval(verificarVencimientos, 24 * 60 * 60 * 1000);

  // Notificaciones push: solo informa en qué estado arrancó. Sin las variables
  // VAPID_* la feature queda apagada y el resto del sistema funciona igual.
  const notificaciones = require('./modules/notificaciones/notificaciones.service');
  console.log(notificaciones.estaActivo()
    ? '🔔 Notificaciones push activas'
    : '🔕 Notificaciones push desactivadas (faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)');

  // Avisos diarios (cartera vencida, plan por vencer, stock bajo). Si las
  // notificaciones están apagadas, el cron ni se registra.
  const { iniciarCronNotificaciones } = require('./modules/notificaciones/notificaciones.cron');
  iniciarCronNotificaciones();

  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  });

  iniciarCronBackup();
};

start();