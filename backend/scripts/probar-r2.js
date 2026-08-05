/**
 * Prueba de conexión con Cloudflare R2.
 *
 * Verifica las credenciales ANTES de tocar la app: sube un archivo diminuto,
 * comprueba que la URL pública responde y luego lo borra. Si algo falla, dice
 * exactamente qué variable revisar.
 *
 *   cd backend
 *   node scripts/probar-r2.js
 *
 * Lee las variables de backend/.env (o del entorno). No escribe en la base de
 * datos ni toca nada del sistema.
 */
require('dotenv').config();

const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const REQUERIDAS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_PUBLIC_URL',
];

const ok   = (m) => console.log(`✅ ${m}`);
const bad  = (m) => console.log(`❌ ${m}`);
const info = (m) => console.log(`   ${m}`);

(async () => {
  console.log('\n── Probando Cloudflare R2 ──────────────────────────────\n');

  // ── 1. Variables ──────────────────────────────────────────────────────────
  const faltantes = REQUERIDAS.filter((k) => !process.env[k]);
  if (faltantes.length) {
    bad(`Faltan variables: ${faltantes.join(', ')}`);
    info('Ponlas en backend/.env para probar localmente, y en Railway para producción.');
    process.exit(1);
  }
  const bucket = process.env.R2_BUCKET || 'catalogo';
  ok('Las cuatro variables están definidas');
  info(`Bucket: ${bucket}`);
  info(`URL pública: ${process.env.R2_PUBLIC_URL}`);

  const cliente = new S3Client({
    region:   'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  // PNG de 1x1 px transparente — el archivo válido más pequeño posible.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  const clave = `_prueba/${Date.now()}.png`;

  // ── 2. Subida ─────────────────────────────────────────────────────────────
  try {
    await cliente.send(new PutObjectCommand({
      Bucket: bucket, Key: clave, Body: png,
      ContentType: 'image/png', CacheControl: 'no-store',
    }));
    ok('Subida correcta (credenciales y bucket válidos)');
  } catch (err) {
    bad(`No se pudo subir: ${err.name} — ${err.message}`);
    if (/NoSuchBucket|NotFound/i.test(err.name + err.message)) {
      info(`El bucket "${bucket}" no existe. Créalo en R2, o ajusta R2_BUCKET.`);
    } else if (/InvalidAccessKeyId|SignatureDoesNotMatch|Forbidden/i.test(err.name + err.message)) {
      info('Revisa R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY.');
      info('Ojo: el token debe tener permiso "Object Read and Write".');
    } else if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(err.message)) {
      info('No se resolvió el endpoint. Revisa que R2_ACCOUNT_ID sea el Account ID correcto.');
    }
    process.exit(1);
  }

  // ── 3. Lectura pública ────────────────────────────────────────────────────
  // Este es el paso que más falla: subir funciona con solo el token, pero para
  // que la foto se VEA el bucket tiene que estar expuesto por un dominio.
  const url = `${process.env.R2_PUBLIC_URL.replace(/\/+$/, '')}/${clave}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      ok(`La URL pública responde (${res.status})`);
    } else {
      bad(`La URL pública respondió ${res.status}`);
      info('El archivo se subió, pero el bucket no está expuesto públicamente.');
      info('R2 → tu bucket → Settings → Custom Domains → Add.');
      info('Y verifica que R2_PUBLIC_URL sea ese dominio, no el endpoint de la API.');
    }
  } catch (err) {
    bad(`No se pudo leer la URL pública: ${err.message}`);
    info(`Probé: ${url}`);
    info('Suele ser que el dominio aún no propaga, o que R2_PUBLIC_URL está mal.');
  }

  // ── 4. Limpieza ───────────────────────────────────────────────────────────
  try {
    await cliente.send(new DeleteObjectCommand({ Bucket: bucket, Key: clave }));
    ok('Archivo de prueba eliminado');
  } catch {
    info(`No se pudo borrar el archivo de prueba (${clave}). Bórralo a mano si quieres.`);
  }

  console.log('\n────────────────────────────────────────────────────────\n');
})();
