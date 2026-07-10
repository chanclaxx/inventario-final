# Runbook de Backups y Recuperación de Datos

Guía operativa completa: qué protege el sistema, cómo activarlo y — lo más
importante — **qué hacer paso a paso cuando algo se pierde**.

---

## Arquitectura de protección (4 capas)

| Capa | Qué es | Frecuencia | RPO (máx. datos perdidos) | Depende de |
|------|--------|-----------|---------------------------|------------|
| 1. Backups nativos de Supabase | Snapshot automático del proyecto de la BD | Diaria (plan Pro) / PITR (~2 min con add-on) | 24 h / ~2 min | Plan de Supabase |
| 2. `pg_dump` binario (GitHub Actions) | Dump completo restaurable con un comando | Cada 6 horas | 6 h | GitHub + Storage |
| 3. Backup JSON (backend) | Export legible de todas las tablas | Diaria 2:00 AM (configurable) | 24 h | Backend en Railway |
| 4. Auditoría de eliminaciones | Copia de cada fila antes de un DELETE | Tiempo real | 0 (para borrados) | Migración aplicada |

La BD vive en el proyecto Supabase `mkosuhvfoyxupadxjoub`; los backups (capas
2 y 3) se guardan en el proyecto **separado** `tyeqlsqkzlihwiaiytzg`, bucket
`backups` (los JSON en la raíz, los binarios en `pgdump/`).

---

## Activación (checklist)

Nada de lo implementado se activa solo. Para encender cada capa:

### Capa 1 — Supabase nativo (recomendado primero, cero código)
1. Dashboard del proyecto de la BD → **Database → Backups**.
2. Plan Free = sin backups. Subir a **Pro** activa backups diarios (7 días).
3. Evaluar el add-on **PITR** cuando el volumen del negocio lo justifique.

### Capa 2 — pg_dump por GitHub Actions
En GitHub → Settings → Secrets and variables → **Actions**, crear:

| Secret | Valor |
|--------|-------|
| `SUPABASE_DB_URL` | `postgres://postgres.<ref>:<password>@aws-1-us-west-2.pooler.supabase.com:5432/postgres` — **puerto 5432 (modo sesión)**, nunca 6543 |
| `BACKUP_SUPABASE_URL` | `https://tyeqlsqkzlihwiaiytzg.supabase.co` |
| `BACKUP_SUPABASE_SERVICE_KEY` | Service key del proyecto de backups |
| `BACKUP_HEALTHCHECK_URL` | (opcional) URL de healthchecks.io |

Sin secrets, el workflow corre y termina en verde sin hacer nada.
Probar manualmente: pestaña **Actions → Backup PostgreSQL (pg_dump) → Run workflow**.

> Si un dump supera el límite de subida del bucket (50 MB por defecto),
> subir el límite en Storage → Settings del proyecto de backups.

### Capa 3 — Backup JSON del backend
Ya funciona como antes. Variables **opcionales** nuevas en Railway:

- `BACKUP_ALERT_EMAIL` — email que recibe alertas de fallo o backup sospechoso.
- `BACKUP_HEALTHCHECK_URL` — check de healthchecks.io (distinto al de la capa 2).
- `BACKUP_CRON` — ej. `0 */6 * * *` para cada 6 horas (default: 2:00 AM).

### Capa 4 — Auditoría de eliminaciones
Ejecutar `backend/migrations/20260709_auditoria_eliminaciones.sql` en el SQL
Editor de Supabase (proyecto de la BD). Es idempotente y 100% aditiva: los
DELETE de la app siguen funcionando igual, pero cada fila borrada queda
copiada en `auditoria_eliminaciones`.

### Heartbeat (detecta backups que dejaron de correr)
1. Crear cuenta gratis en [healthchecks.io](https://healthchecks.io).
2. Crear un check por capa (JSON: periodo 1 día; pg_dump: periodo 6 h, gracia 1 h).
3. Poner las URLs en las variables/secrets de arriba.
4. Si un backup no reporta a tiempo, healthchecks.io envía email solo.

---

## 🚨 Procedimientos de recuperación

### Caso A — Un cliente borró algo por error (lo más común)

La fila completa está en `auditoria_eliminaciones` (si la capa 4 está activa):

```sql
-- Buscar lo borrado
SELECT id, tabla, registro_id, eliminado_en, datos
FROM auditoria_eliminaciones
WHERE tabla = 'facturas'            -- o seriales, prestamos, clientes...
ORDER BY eliminado_en DESC
LIMIT 50;

-- Reinsertar una fila usando el JSON guardado (ejemplo con facturas)
INSERT INTO facturas
SELECT * FROM jsonb_populate_record(NULL::facturas, (
  SELECT datos FROM auditoria_eliminaciones WHERE id = <id_auditoria>
));
```

Si un DELETE en cascada borró hijos (líneas, pagos), buscarlos por la misma
fecha en `eliminado_en` y reinsertar primero el padre, luego los hijos.

### Caso B — Corrupción o pérdida masiva de datos

**Opción 1 (preferida): restaurar desde Supabase** — Dashboard → Database →
Backups → Restore (o PITR al minuto exacto anterior al incidente).

**Opción 2: restaurar un pg_dump (capa 2):**

```bash
# 1. Descargar el dump desde el proyecto de backups
#    (Storage → backups → pgdump/ → descargar el más reciente)

# 2. Restaurar en una BD NUEVA primero — nunca directo sobre producción
pg_restore --dbname "postgres://postgres.<ref-nuevo>:<pass>@...:5432/postgres" \
  --no-owner --no-privileges --clean --if-exists respaldo.dump

# 3. Verificar conteos contra lo esperado
psql "<url>" -c "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname;"

# 4. Solo cuando esté verificado, apuntar el backend (variables DB_* en
#    Railway) a la BD restaurada, o repetir el restore sobre producción.
```

### Caso C — Solo existe el backup JSON (última línea de defensa)

El JSON (formato v2) contiene `{ tablas: { nombre: [filas...] } }`. Para
restaurar: crear el esquema con las migraciones, luego insertar tabla por
tabla respetando el orden de las foreign keys (negocios → sucursales →
usuarios → productos → facturas → líneas...). Es manual y lento — por eso
las capas 1 y 2 son las principales; el JSON es respaldo del respaldo y
sirve para inspección puntual (recuperar un registro específico).

Descargar un JSON: endpoint superadmin
`GET /api/superadmin/backup/descargar/:nombre` (devuelve URL firmada de 5 min),
o directo desde Storage del proyecto de backups.

---

## Simulacro de restauración (hacer 1 vez al mes)

Un backup no probado no es un backup:

1. Crear un proyecto Supabase gratis temporal.
2. Restaurar el último `pgdump_*.dump` con `pg_restore` (Caso B, opción 2).
3. Verificar: `SELECT COUNT(*) FROM facturas;` y comparar contra producción.
4. Borrar el proyecto temporal.

Anotar la fecha del último simulacro exitoso aquí:

- (pendiente — primer simulacro)

---

## Qué se mejoró en el servicio JSON (julio 2026)

- **Snapshot consistente**: todas las tablas se leen en una transacción
  `REPEATABLE READ` — no más facturas sin sus líneas.
- **Sin fallos silenciosos**: si una tabla falla, el backup falla y alerta
  (antes se guardaba `[]` y el backup se reportaba exitoso).
- **Tablas dinámicas**: se leen de `information_schema` — las tablas nuevas
  entran solas al backup.
- **Validación antes de limpiar**: si el backup nuevo trae menos de la mitad
  de registros que el anterior, no se borra ningún backup viejo y se alerta.
- **Retención más segura**: los 7 archivos más recientes se conservan siempre;
  semana/mes se calculan por periodo (antes solo sobrevivían los backups
  creados en domingo o el día 1).
- **Alertas + heartbeat**: fallos notificados por email (Brevo) y a
  healthchecks.io.
- **Descarga**: endpoint superadmin con URL firmada.

## Seguridad

- Los backups contienen **todos los datos de todos los clientes y los hashes
  de contraseñas**: el bucket `backups` debe ser **privado** (verificar en
  Storage → backups → configuración) y las service keys jamás van al frontend
  ni al repositorio.
- Las URLs de descarga expiran a los 5 minutos y solo un superadmin puede
  generarlas.
