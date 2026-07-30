# Análisis — Fecha límite de pago y mora en créditos y préstamos

> **Estado:** **implementado y probado** (30-jul-2026). 11 suites contra Postgres real.
>
> ## Decisiones finales y hallazgos de la prueba adversaria
>
> **La mora se acumula por TRAMOS sobre el capital que estuvo vencido**, no sobre el saldo
> de hoy. Se reconstruye con las fechas de los abonos, así que sigue siendo derivada (no
> guarda estado nuevo). Un abono deja de causar mora hacia adelante, nunca hacia atrás.
>
> La primera versión calculaba sobre el saldo actual y tenía un **bug grave**: al saldar el
> capital la base quedaba en 0 y **toda la mora causada desaparecía**. El negocio perdía los
> intereses justo en el caso más común (el cliente que salda). Lo encontró la suite
> adversaria `10-adversario-mora-tarifas.mjs`.
>
> Dos normalizadores de fecha distintos, a propósito: `_aFecha` para columnas `DATE` (UTC,
> porque pg las entrega a medianoche UTC) y `_aFechaInstante` para `TIMESTAMP` (Bogotá,
> porque son instantes reales). Confundirlos corría un día y rompía el cálculo.
>
> **Pendientes de decisión del negocio** (§7 actualizado): cancelar una factura a crédito
> no revierte la mora ya cobrada; un préstamo se puede saldar con mora pendiente.
> **Pedido:** poder fijar una fecha máxima de pago a una factura a crédito o a un
> préstamo; si el cliente no paga en ese plazo, se genera una mora. Opt-in por negocio.

**Veredicto: sí es posible y encaja bien en la arquitectura** — la mora se puede *derivar*
igual que ya se derivan la deuda de red interna y los saldos de tesorería. Pero hay
**una trampa contable grave** (§2) que hay que resolver antes de escribir una línea, y
un componente legal que no es opcional (§4).

---

## 1. Cómo funciona el crédito hoy

Hay **tres vehículos de cobro diferido**, todos con la misma forma y **ninguno con
fecha de vencimiento**:

| Vehículo | Valor | Abonado | Saldo | Activos hoy |
|---|---|---|---|---|
| `creditos` (factura a crédito) | `valor_total` | `cuota_inicial` + `total_abonado` | `valor_total − cuota_inicial − total_abonado` | **15** · $28,1 M |
| `prestamos` | `valor_prestamo` | `total_abonado` | `valor_prestamo − total_abonado` | **1.793** · $3.630 M |
| `ordenes_servicio` | `precio_final` | `total_abonado` | resto | (menor) |

> El préstamo es, por lejos, el vehículo dominante: **1.793 activos contra 15 créditos**.
> Cualquier diseño que solo cubra facturas a crédito deja fuera el 99% del problema real.

Antigüedad de lo que está abierto hoy:

| | 0-30 días | 31-90 | 91-180 | +180 |
|---|---|---|---|---|
| Créditos | 8 | 5 | 2 | 0 |
| Préstamos | 1.115 | 658 | 20 | 0 |

**678 préstamos ya llevan más de 30 días.** Si la mora se aplicara retroactivamente,
generaría cargos masivos de la nada. El diseño debe impedirlo (§5.3).

Piezas relacionadas que hay que tener en cuenta:
- `abonos_totales`: un pago único que se reparte **FIFO** entre todos los préstamos activos
  de una persona (`prestamos.service.js:1436-1476`).
- `modificarAbonoTotal`: revierte todos los abonos del total y **re-distribuye**.
- `clientes.saldo_a_favor` / `prestatarios.saldo_a_favor`: excedentes que quedan a favor.
- `devolverLineasCredito`: **reduce `creditos.valor_total`** en devoluciones parciales.

No existe ninguna columna de plazo, vencimiento, mora ni interés en ninguna tabla.

---

## 2. 🔴 La trampa contable — el hallazgo más importante

**La utilidad de créditos y préstamos se calcula sobre lo COBRADO, no sobre el valor de venta.**

| Dónde | Fórmula |
|---|---|
| Préstamos saldados | `utilidad = total_abonado − costo_producto` (`reportes.service.js:467`) |
| Préstamos activos | `utilidad_parcial = total_abonado − costo_producto` (`:486`) |
| Créditos saldados | `utilidad = (cuota_inicial + total_abonado) − costo_total_productos` (`:645`, `:660`) |
| Créditos activos | `utilidad_parcial = MAX(0, total_cobrado − costo_total)` (`:776`) |

Consecuencia: **si la mora se registra como un abono normal, el sistema la cuenta como
margen del producto.** Un préstamo de $700.000 con $100.000 de mora reportaría
$800.000 − costo como utilidad comercial. Eso contamina:

- la utilidad bruta y el margen %
- el análisis por línea de producto
- la Proyección mensual y el punto de equilibrio
- el PDF de reportes

### Regla de diseño obligatoria

> **La mora NUNCA puede entrar en `total_abonado` ni en `cuota_inicial`.**
> Vive en su propia tabla y se suma aparte como **ingreso financiero**, no como margen.

Esto es lo mismo que ya se hizo con las retomas ("la retoma no reduce la utilidad"): un
concepto que mueve plata pero no es margen de producto.

---

## 3. 🟡 Segundo obstáculo: los abonos rechazan pagar más del saldo

`creditos.service.registrarAbono:23-25`:

```js
if (valor > saldoPendiente) throw { status: 400, message: 'El abono supera el saldo pendiente' };
```

Y `abonoTotal` reparte FIFO contra `saldoPendiente = valor_prestamo − total_abonado`, sin
saber nada de mora (`prestamos.service.js:1441-1444`).

Con mora activa el cliente debe **más** que el saldo de capital → los pagos que incluyan
mora serían rechazados, o la mora quedaría sin poder cobrarse. Hay que:

1. ampliar el tope a `saldo_capital + mora_pendiente`, y
2. decidir el **orden de imputación** del pago.

**Orden de imputación:** el Art. 1653 del Código Civil colombiano imputa **primero
intereses y luego capital**, salvo pacto en contrario. Recomiendo ese default, configurable.

---

## 4. Legalidad — no es opcional

Esto no es un detalle de producto; condiciona el diseño:

1. **La mora solo es exigible si se pactó por escrito antes.** → hay que imprimir la fecha
   límite y la tasa en la factura y en el recibo de préstamo (los PDFs ya existen, se
   añade un renglón). Sin eso, el cargo no es defendible.
2. **Tope legal: la tasa de usura.** La Superintendencia Financiera publica cada mes el
   interés bancario corriente; el límite de usura es **1,5 ×** ese valor. Cobrar por encima
   es delito de usura (Art. 305 C.P.) y hace perder los intereses.
   → El sistema debe **validar contra un techo configurable y advertir**, no intentar
   consultar la tasa oficial (cambia cada mes y no hay API estable). Que el negocio la fije.
3. **Prohibido el anatocismo:** la mora se calcula sobre el **capital vencido**, nunca sobre
   capital + mora acumulada. **Interés simple, no compuesto.**
4. La tasa pactada debe **congelarse en el documento** (§5.2): si el negocio la sube después,
   no puede aplicarla a créditos ya otorgados.

---

## 5. Diseño propuesto

### 5.1 Principio: la mora se deriva, no se escribe

Igual que la deuda de red interna y los saldos de tesorería: **solo se guarda el pacto
(fecha límite + tasa) y lo que efectivamente se cobró.** La mora acumulada se calcula al
leer. Ventajas: no hay dos lados que se desincronicen, y si se cancela una factura o se
devuelve un producto, el número se corrige solo.

### 5.2 Datos

Config de negocio (clave-valor, **0 migraciones** para los flags):

| Clave | Para qué |
|---|---|
| `mora_activa` | `'1'`/`'0'` — enciende la feature |
| `mora_tasa_mensual` | % mensual sobre el capital vencido (ej. `'2.5'`) |
| `mora_dias_gracia` | días después del vencimiento antes de que corra la mora |
| `mora_orden_pago` | `'mora_primero'` (default legal) / `'capital_primero'` |
| `mora_tope_mensual` | techo de seguridad para la validación en Ajustes |
| `mora_plazo_default_dias` | precarga la fecha límite en el POS |
| `mora_cobrable` | `'1'` cobra, `'0'` solo la muestra como presión de cobro |

Migración **aditiva** (todo nullable → los 1.793 préstamos y 15 créditos existentes no cambian):

```sql
ALTER TABLE creditos  ADD COLUMN IF NOT EXISTS fecha_limite      DATE;
ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS fecha_limite      DATE;
-- Se congelan las condiciones PACTADAS: no se lee la config actual al calcular,
-- porque subir la tasa mañana no puede aplicarse a lo ya otorgado.
ALTER TABLE creditos  ADD COLUMN IF NOT EXISTS mora_tasa_mensual NUMERIC(6,3);
ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS mora_tasa_mensual NUMERIC(6,3);
ALTER TABLE creditos  ADD COLUMN IF NOT EXISTS mora_dias_gracia  INTEGER;
ALTER TABLE prestamos ADD COLUMN IF NOT EXISTS mora_dias_gracia  INTEGER;

-- La mora cobrada vive APARTE de total_abonado (ver §2).
CREATE TABLE IF NOT EXISTS cobros_mora (
  id            BIGSERIAL PRIMARY KEY,
  negocio_id    INTEGER NOT NULL REFERENCES negocios(id)   ON DELETE RESTRICT,
  sucursal_id   INTEGER NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
  credito_id    INTEGER REFERENCES creditos(id)  ON DELETE CASCADE,
  prestamo_id   INTEGER REFERENCES prestamos(id) ON DELETE CASCADE,
  valor         NUMERIC(14,2) NOT NULL CHECK (valor > 0),
  dias_mora     INTEGER,
  tasa_aplicada NUMERIC(6,3),
  saldo_base    NUMERIC(14,2),   -- foto de sobre qué capital se calculó
  metodo        TEXT,
  usuario_id    INTEGER,
  fecha         TIMESTAMP NOT NULL DEFAULT NOW(),
  anulado       BOOLEAN   NOT NULL DEFAULT FALSE,
  CONSTRAINT cobros_mora_un_solo_origen_chk
    CHECK ((credito_id IS NOT NULL) <> (prestamo_id IS NOT NULL))
);
```

### 5.3 La clave de la aditividad

> **`fecha_limite IS NULL` ⇒ no hay plazo ⇒ no hay mora. Nunca.**

Con eso, los 1.793 préstamos y 15 créditos que ya existen quedan intactos aunque el negocio
active la feature. La mora solo aplica a documentos creados después, o a los que el negocio
le ponga fecha a mano de forma deliberada.

Además resuelve gratis el pedido de *"esto es para un solo cliente"*: si a un cliente no le
pones fecha límite, no tiene mora. No hace falta una lista de clientes exentos.

### 5.4 Cálculo (función pura, como `utils/tarifas.js`)

```js
dias_vencidos = max(0, hoy_bogota − fecha_limite − dias_gracia)
mora_causada  = saldo_capital × (tasa_mensual / 100) × (dias_vencidos / 30)
mora_pendiente = mora_causada − mora_ya_cobrada
```

Interés **simple** sobre el capital (§4.3). Los días se cuentan en `America/Bogota`
— no en UTC (ya hay precedente de que eso muerde: una suite fallaba cada tarde por
calcular "hoy" con `toISOString()`).

---

## 6. Qué hay que tocar

### Backend
| Archivo | Cambio |
|---|---|
| `backend/migrations/2026xxxx_mora.sql` + `src/config/migrations.js` | migración aditiva |
| `src/utils/mora.util.js` *(nuevo)* | `calcularMora()` puro y testeable |
| `src/modules/config/config.service.js` | validar tasa/tope, como ya se hace con `tarifas_lista` |
| `creditos.repository/service` | exponer `fecha_limite`, `dias_mora`, `mora_pendiente`, `saldo_con_mora`; **ampliar la validación del abono** (§3) |
| `prestamos.repository/service` | idem + **la distribución FIFO de `abonoTotal`** con orden de imputación (lo más delicado) |
| `facturas.service.crearFactura` | aceptar `fecha_limite` cuando `es_credito` |
| nuevo endpoint | registrar cobro de mora (o extender el abono con `valor_mora`) |
| `caja.repository` | **grupo nuevo "Intereses de mora"** (ingreso), separado de facturas y abonos |
| `reportes.service` | renglón propio "ingresos por mora"; **NO** tocar la utilidad de producto |
| `facturas.pdf.js`, `prestamos.pdf.service.js` | imprimir fecha límite y condiciones pactadas (§4.1) |
| `src/jobs/` + `node-cron` + `email.service` | *(opcional, fase 3)* recordatorios; la infra ya existe |

### Frontend
| Archivo | Cambio |
|---|---|
| `pages/configuracion/MoraConfig.jsx` *(nuevo)* + tab en `ConfigPage` | tasa, gracia, orden de pago, advertencia legal |
| `pages/facturas/SeccionCredito.jsx` | campo de fecha límite |
| `pages/prestamos/ModalPrestamo.jsx` | campo de fecha límite |
| `pages/prestamos/TabCreditos.jsx`, `PrestamosPage.jsx` | badge "Vencido hace N días" + columna mora |
| `ModalAbonoPrestamo`, `ModalAbonoTotal`, abono de crédito | desglose **capital / mora** y a dónde va el pago |
| `pages/prestamos/EstadoDeCuenta.jsx` | la mora como renglón propio |

---

## 7. Riesgos

1. 🔴 **Contaminar la utilidad** (§2). El riesgo número uno. Se evita con `cobros_mora`.
2. 🟡 **`abonoTotal` FIFO.** Un pago único sobre N préstamos con mora exige decidir dos
   órdenes: entre préstamos, y entre mora/capital dentro de cada uno. Es la parte más
   delicada del cambio.
3. 🟡 **`modificarAbonoTotal`** revierte y redistribuye. Si hay mora cobrada, hay que
   revertirla en cascada o el saldo queda mal.
4. **Retroactividad.** Cubierto por `fecha_limite IS NULL` (§5.3), pero hay que probarlo.
5. **`devolverLineasCredito` reduce `valor_total`.** Si ya se causó mora sobre un capital
   que luego se redujo, hay que decidir: recalcular hacia atrás o congelar lo ya causado.
   Recomiendo **recalcular** (la mora se deriva, así se corrige sola).
6. **Cancelar una factura a crédito con mora cobrada** → hay que devolver esa mora en caja,
   igual que hoy se devuelven los pagos.
7. **Zona horaria** en el conteo de días (§5.4).
8. **Préstamos a compañeros** (`cedula = 'COMPANERO'`): cobrarles mora probablemente no
   tiene sentido. Conviene excluirlos o no ponerles fecha límite.

---

## 8. Fases sugeridas

**Fase 1 — plazo y mora informativa** *(bajo riesgo, entrega la mayor parte del valor)*
Fecha límite + mora derivada y visible en pantalla y PDF, **sin cobrarla**. No toca caja ni
reportes ni la lógica de abonos. Ya sirve como presión de cobro, que es el 80% del uso real.

**Fase 2 — cobro de la mora**
`cobros_mora`, imputación en los abonos, grupo propio en caja, renglón en reportes.
Aquí es donde vive el riesgo; conviene hacerla sola y probarla con PGlite.

**Fase 3 — recordatorios automáticos**
Job diario con `node-cron` + email (o WhatsApp) a los que están por vencer y vencidos.

---

## 9. Preguntas para el cliente

1. ¿La tasa es **mensual o diaria**, y de cuánto exactamente?
2. ¿La mora se calcula sobre el **saldo pendiente** o sobre el **valor total original**?
3. ¿Hay **días de gracia** después del vencimiento?
4. ¿La mora se **cobra** de verdad, o solo se muestra para presionar el pago?
   (Cambia mucho el alcance: fase 1 vs fase 2.)
5. Cuando el cliente paga, ¿el dinero abona **primero la mora** o primero el capital?
6. ¿Aplica a **préstamos**, a **facturas a crédito**, o a los dos? (Asumo los dos; ojo que
   los préstamos son el 99% del volumen.)
7. ¿La mora **crece indefinidamente** o tiene un tope (p. ej. no más del X% del capital)?
8. ¿Qué pasa con los **préstamos a compañeros**? ¿También llevan mora?
9. **¿Ya lo pactó por escrito con sus clientes?** Es la condición para que sea exigible, y
   define si hay que imprimirlo en los documentos desde el día uno.
