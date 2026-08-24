# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Inventario** is a multi-tenant SaaS inventory and sales management system targeting Colombian businesses (Spanish locale, Colombian pesos COP). It is composed of a Node.js/Express backend and a React 19 + Vite frontend in separate subdirectories.

---

## Commands

### Backend (`/backend`)
```bash
pnpm dev         # nodemon dev server on port 3001
pnpm start       # production
```

### Frontend (`/frontend`)
```bash
pnpm dev         # Vite dev server on port 5173
pnpm build       # production build
pnpm lint        # ESLint
pnpm preview     # preview production build
```

> Ambos usan **pnpm** (el único lockfile versionado en los dos es `pnpm-lock.yaml`).
> El `backend/package.json` declara `packageManager: npm`, que ya no corresponde: hay
> que instalar con `pnpm add <pkg> --config.package-manager-strict=false`. Correr `npm
> install` ahí revienta con `Cannot read properties of null (reading 'matches')`, porque
> el árbol de `node_modules` es de pnpm.

---

## Architecture

### Multi-tenant Model

The hierarchy is: **Negocio (business) → Sucursales (branches) → Users (roles)**.

Three roles exist: `admin_negocio`, `supervisor`, `vendedor`. Role determines which sucursal is resolved:
- `admin_negocio` passes `sucursal_id` as a query parameter on every request.
- `supervisor` / `vendedor` have their sucursal embedded in the JWT and resolved server-side.

### Authentication Flow

1. Login returns an **access token** (8h) + sets an httpOnly cookie with a **refresh token** (7d).
2. The Axios instance in `frontend/src/api/` auto-refreshes on 401 via an interceptor.
3. A 403 with plan status `vencido` or `suspendido` redirects the user to `/plan-bloqueado`.

### Backend Module Pattern

All 27 feature modules under `backend/src/` follow the same layered structure:

```
<module>/
  routes.js       → Express router, middleware wiring
  controller.js   → HTTP in/out, calls service
  service.js      → Business logic
  repository.js   → Raw SQL queries via pg pool
```

Key modules: `auth`, `registro`, `usuarios`, `productos`, `inventario`, `facturas`, `caja`, `creditos`, `prestamos`, `reportes`, `sucursales`, `superadmin`, `tesoreria`, `notificaciones`.

> **Notificaciones push** (`notificaciones`): Web Push con VAPID (`web-push`), sin
> Firebase. La suscripción se identifica por **endpoint**, no por usuario (una persona
> tiene varios dispositivos). Todo envío pasa por `notificaciones.service.enviar()`, que
> **nunca lanza** (un aviso fallido no puede tumbar la venta que lo disparó), resuelve
> destinatarios **siempre dentro de un `negocio_id`**, y borra la suscripción ante un
> 404/410 del navegador. `unico_por_dia` deduplica contra `notificaciones_enviadas` para
> que un reinicio de Railway no reenvíe el mismo aviso. Sin `VAPID_PUBLIC_KEY` /
> `VAPID_PRIVATE_KEY` el módulo queda apagado y la app funciona igual. Los handlers del
> service worker viven en `frontend/public/push-sw.js`, inyectados con
> `workbox.importScripts` (el SW lo genera Workbox y no se puede editar a mano).
> En iOS solo funciona con la PWA instalada en la pantalla de inicio.
> Los avisos automáticos (cartera **por vencer** y **vencida**, plan por vencer, stock bajo) salen de
> `notificaciones.alertas.js` y los dispara `notificaciones.cron.js` a las 8:00
> America/Bogota (`NOTIF_CRON`). Los de cobro abren **directo la ficha del cliente**
> (`/prestamos?tab=prestamos&persona=prestatario_<id>` o `?tab=creditos&persona=<cédula>`):
> esas claves son las mismas que arman `PrestamosPage` y `TabCreditos` al agrupar, así que
> si cambian allá, los enlaces dejan de abrir la ficha.

> **Cargos financieros — mora e interés** (`mora/`, `utils/devengo.util.js`,
> `utils/mora.util.js`, `utils/interes.util.js`): dos cargos **independientes**
> sobre créditos y préstamos. La **mora** sanciona el atraso (ancla: `fecha_limite`);
> el **interés corriente** cobra el plazo (ancla: la entrega). Se puede tener uno,
> el otro, los dos o ninguno — los interruptores son la ausencia de datos, no un
> flag: `fecha_limite IS NULL` ⇒ nunca hay mora, `interes_condicion IS NULL` ⇒
> nunca hay interés. Por eso las features son aditivas.
> El cálculo de los dos sale del **mismo motor** (`devengo.util.calcularDevengo`),
> que reconstruye tramos de saldo constante entre abonos: calcular sobre el saldo
> de hoy haría **desaparecer** lo causado cuando el cliente salda el capital.
> El interés soporta arranque diferido, periodicidad libre (diaria/semanal/
> quincenal/mensual/cada N días), causación **proporcional al día o a escalón**
> (`devengo: 'periodo_cumplido'` — "pasa el mes y sube 2% de una vez"), base
> **saldo o valor original**, topes de períodos y porcentual, y qué hacer al
> vencerse (`al_vencer: 'sustituye'` por defecto — el interés se detiene y entra
> la mora, porque no se cobran plazo y mora sobre la misma suma y el mismo
> período; `'continua'` los deja correr juntos). **Nunca capitaliza**: sería
> anatocismo.
> Los dos pactos se **congelan** en el documento (jsonb): subir la tasa en Ajustes
> no toca lo ya otorgado. Lo pendiente se **deriva** siempre (causado − cobrado −
> condonado); solo se escriben cobros y condonaciones, en `movimientos_mora`
> discriminados por **`concepto`** (`'mora'` | `'interes'`).
> **Ninguno entra jamás en `total_abonado`**: los reportes calculan la utilidad
> como (abonado − costo) y los contarían como margen comercial. Son ingreso
> financiero y salen en grupos propios de caja y reportes.
> El abono se imputa en cascada **mora → interés → capital** (Art. 1653 C.C.), y
> la obligación **no se cierra hasta que las tres cubetas estén en cero**.
> Pruebas: `13-devengo-identidad` (el refactor del motor no cambió una cifra de
> la mora — 12.566 corridas), `14-interes-corriente` (fórmula), `15-interes-integracion`
> (cableado contra Postgres real). Las suites `09` y `10` siguen cubriendo la mora.
> Cuidado con las fechas: `interes_desde`/`fecha_limite` son **DATE** (leer en UTC)
> y `prestamos.fecha`/`creditos.creado_en` son **TIMESTAMP** (leer en Bogotá) —
> confundirlos corre un día y ya mordió dos veces (`mora.service._inicioInteres`).

> **Pago total a un acreedor** (`acreedores/`): el pago se reparte entre los cargos
> abiertos (FIFO) creando **una fila de `movimientos_acreedor` por cargo** — eso no
> cambió. Lo que cambia es la **lectura**: las filas que comparten `pago_total_id`
> se colapsan en `getMovimientos` en un solo movimiento (`es_pago_total`, con el
> reparto en `detalle`), para que el estado de cuenta muestre el pago tal como lo
> hizo el usuario. El importe mostrado se **deriva con `SUM`**, nunca se guarda:
> cancelar una compra borra sus abonos (`compras.service`: `DELETE ... WHERE
> cargo_id`), y un total guardado quedaría inflado contra un saldo ya bajado.
> Caja, tesorería, `getComprasConSaldo` y `getAbonosPorCargo` siguen leyendo las
> filas individuales — no tocar. Quien resuelva la etiqueta del movimiento debe
> mirar `es_pago_total` **antes** que `cargo_id`, o un pago total se rotula "Pago
> adelantado": pasa en tres sitios (`EstadoCuentaAcreedor.resolverTipo`,
> `acreedores.pdf.resolverTipoLabel`, `exportarCuentaAcreedorExcel.metaMovimiento`).
> Prueba: `17-pago-total-acreedor`.
> La **descripción** del pago (por qué se hizo) es texto libre, tope 200, y no
> entra en ningún cálculo. Va en `movimientos_acreedor.pago_total_descripcion`
> —repetida en cada fila hija, como la marca— y **nunca** en `descripcion`: esa
> columna es la del abono individual (la edita el usuario desde el historial del
> cargo) y su valor fijo `'Pago total distribuido'` es lo que reconoce el
> backfill de 20260805. `getMovimientos` la **compone** sobre la etiqueta
> (`Pago total — N cargos · nota`) para que aparezca sola en los cuatro sitios
> que leen la descripción: cuadrícula, conversación, PDF y Excel.
> El gemelo en préstamos es `abonos_totales.descripcion`, que viaja en columna
> propia hasta el frontend (**no** pegada al concepto: `PrestamosPage` saca el
> método de pago parseando `concepto` para precargar el modal de edición, y
> cualquier texto extra se colaría dentro del método).
> **Nada de `UNION` en `getMovimientos`**: obliga a castear a mano el NULL de cada
> columna, y `movimientos_acreedor.firma` es **BYTEA** en producción (el fixture de
> pruebas la declara TEXT). Un `NULL::text` ahí tumbó el estado de cuenta entero con
> `UNION types bytea and text cannot be matched`. Por eso se agrupa todo con un
> `GROUP BY` sobre `COALESCE('p'||pago_total_id, 'm'||id)`: los tipos salen de las
> columnas. La firma se resuelve con `array_agg(...)[1]`, no `MIN()` — `min(bytea)`
> solo existe desde Postgres 14. La sección 11 de la prueba monta una base con los
> tipos reales (bytea/timestamptz/bigserial) justo para cazar esto.

> **Importación de inventario** (`importacion/`): se corre prácticamente **una
> vez por negocio**, cuando arrancan. Por eso el diseño es **informativo, no
> correctivo**: el importador no arregla nombres, no fusiona productos y no
> adivina — dice qué va a pasar y el usuario corrige su Excel.
> El flujo es de dos pasos: `POST /importacion/analizar` corre **el importador
> de verdad** dentro de una transacción que termina en `ROLLBACK` y devuelve el
> informe; `POST /importacion/inventario` lo aplica. **Nunca escribir un
> validador paralelo**: se desincroniza del importador y acaba mintiendo.
> Dos categorías, y la diferencia importa: **conflicto** = la fila no se
> escribe (IMEI en otra sede, unidad vendida, código tomado); **aviso** = sí se
> escribe pero puede sorprender (se suma stock, hay un nombre casi idéntico, el
> producto entra sin costo). El costo **jamás bloquea**: hay negocios que a
> propósito no lo registran.
> **La identidad del producto NO se unifica.** Conviven tres nociones: el índice
> único de la BD es `(nombre, sucursal_id)` **exacto**, el importador busca con
> `LOWER(nombre)` y la UI no valida nada. De ahí salen los duplicados reales
> (`[11PRO]`/`[11Pro]`, `cargador 3ds ` con espacio final). Se **detectan y se
> reportan**, nunca se tocan: son negocios operando y su historia de ventas
> cuelga de esas filas. `_NORM` solo sirve para avisar, jamás para decidir a qué
> fila se escribe.
> El **IMEI es único por negocio** (es físico). La misma sucursal actualiza
> (re-import correctivo); otra sucursal es conflicto — antes hacía `UPDATE`
> sobre la fila de la otra sede y el equipo no aparecía en la destino.
> Las unidades vendidas o prestadas no se tocan: reescribirles el costo cambia
> la utilidad de una venta ya hecha.
> El nombre de columna de una característica se resuelve con
> `nombreColumnaCaracteristica` / `clavesCaracteristica` en
> `importacion.informe.js`, compartidas por la plantilla y el service: si se
> separan, la característica se importa vacía. Existe porque una característica
> puede llamarse igual que una columna fija (negocio 4: característica «Color»
> **y** colores de serial activos → dos columnas `Color`, y SheetJS renombra la
> segunda a `Color_1`, que no lee nadie).
> Prueba: `18-importacion` (212 verificaciones, incluye el ida y vuelta con la
> plantilla real y tres sucursales del mismo negocio).

> **Código único — lo escaneable es el NODO, no el producto**
> (`utils/codigo.util.js`, `20260823_codigo_variantes.sql`): el código vive en
> los **tres** niveles del árbol de cantidad — `productos_cantidad.codigo`,
> `atributos_producto.codigo` y `variantes_atributo.codigo`. La primera versión
> (20260714) solo lo puso en el producto, y con la feature «Variantes» activa un
> producto con 30 tallas tenía **un** código: el lector solo podía abrir el árbol
> para que alguien eligiera a mano, justo el trabajo que el código venía a quitar.
> **La regla es una: un código = un nodo escaneable por sucursal, sin importar el
> nivel.** Si el mismo código estuviera en un producto y en el atributo de otro,
> el lector no tendría cómo decidir. La BD la garantiza por tabla (índices
> parciales); **entre niveles no es expresable como constraint —son tres tablas—**
> y la impone `buscarCodigoEnUso`, igual que ya pasaba con «un código = un solo
> nombre de producto». `variantes_atributo` no tiene `sucursal_id` (cuelga de
> `atributo_id`), así que su índice es por atributo y el alcance de sucursal
> también lo cubre el service.
> El **importador** le pone el código de cada fila al nodo que esa fila describe:
> con Atributo, el código es de esa talla. Antes iba todo a `productos_cantidad`
> con «gana la última fila». Al validar compara por **identidad lógica**
> (nombre + valor del atributo + valor de la variante), nunca por id: re-importar
> el mismo archivo no puede chocar consigo mismo, y el mismo nodo en otra sede
> comparte código **a propósito** (así el lector funciona en las dos) — para eso
> están `heredarCodigo` y `propagarCodigo`, que viven en el util porque los
> comparten el módulo de variantes y el importador, que corre todo con su propio
> `client` en transacción.
> Al escanear, `buscarCantidadPorCodigo` devuelve el nodo con su `nivel` y el
> `precio`/`costo` ya resueltos con `COALESCE` hacia arriba; el POS agrega la
> variante al carrito **con la misma `key`** que arma `VistaVariantesProducto`
> (`cant-<prod>-a-<atr>` / `cant-<prod>-v-<var>`) o el carrito guardaría dos
> líneas para la misma variante. El buscador de texto de la pantalla filtra
> también por `codigos_variantes` (agregado en `findAll`): sin eso, mover los
> códigos a las variantes los volvía inbuscables.

> **El costo de un LOCAL es el valor_interno, no el de la bodega**
> (`reportes.service.js: _valorInternoSerial`): cuando la bodega despacha, le
> cobra al local por encima de lo que a ella le costó. El costo del local es el
> `valor_interno` de la línea de la remisión — lo que tendrá que liquidar al
> vender. Los productos por **cantidad** ya lo resolvían solos: la recepción
> reescribe `productos_cantidad.costo_unitario` del destino con el promedio
> ponderado sobre `valor_interno`. Los **seriales NO**, porque `moverSerial` solo
> cambia `producto_id` y `seriales.costo_compra` **se conserva a propósito**: es
> la verdad del costo del NEGOCIO (lo que se le pagó a un proveedor externo), y
> para el margen consolidado del grupo eso es lo correcto — el traspaso interno
> se anula solo.
> El hueco estaba en los reportes por sucursal, que calculaban el costo de una
> venta con IMEI desde `costo_compra` sin mirar si esa sucursal era un local:
> el local reportaba utilidad inflada en los equipos y correcta en los
> accesorios, con dos varas de medir en el mismo reporte. **El arreglo NO
> reescribe `costo_compra`** —se perdería el costo externo real—: el reporte
> prefiere el `valor_interno` de la entrega más reciente **anterior a la venta**
> (una unidad puede enviarse, devolverse y reenviarse con otro valor) y cae a
> `costo_compra` cuando no aplica. `r.tipo = 'entrega'` es lo que excluye a la
> bodega. Alimenta los 6 reportes que pasan por `_costoPorImei`, más préstamos y
> productos más vendidos. El cruce va por IMEI —no por `serial_id`— porque se
> parte de `lineas_factura`, que no lo guarda; acotarlo a la sucursal destino y
> a la fecha es lo que evita el fan-out del IMEI.
> Prueba: `23-costo-serial-en-local` (falla 3 de 7 contra el código anterior;
> las 4 barandas —bodega, unidad propia, negocio sin red, remisión anulada—
> pasan en ambos).

> **Red interna — el ENVÍO es la deuda** (`red-interna/`): una sucursal-bodega
> surte a los locales. Feature opt-in (`config_negocio.red_interna_activa`),
> nunca activa para clientes existentes.
> Hasta agosto 2026 el modelo era **consignación**: entregar no generaba deuda,
> la deuda nacía al VENDER y se derivaba de las ventas. Desde
> `20260822_red_interna_envios.sql` el local **paga todo lo que recibe**, esté
> vendido o no, y cada envío es un documento de deuda con su saldo y sus abonos
> —como una factura a crédito de un cliente. Que la unidad se haya vendido
> **sigue calculándose y se muestra, pero ya no mueve un peso**.
> El cambio cerró tres agujeros: el equipo que desaparecía del local ('Sin
> ubicar') dejaba de cobrarse; una devolución parcial de una venta a crédito
> seguía generando deuda sobre un equipo devuelto a la vitrina; y la deuda por
> accesorios se estimaba contra el **stock global** del local, así que bajaba
> sola si el local le compraba el mismo accesorio a otro proveedor.
> **Qué se deriva y qué se escribe**: el CARGO se deriva de las líneas en estado
> `'Recibida'` (una devolución marca la línea `'Devuelta'` y el cargo baja solo,
> sin contra-asiento); el ABONO se **escribe** en `abonos_remision`, porque a
> qué envío se imputa un pago no se puede derivar de ninguna tabla — lo decide
> una persona. Todo pago entra por **un solo motor**, `_imputarFIFO`: pago
> dirigido a un envío, pago total repartido del más viejo al más nuevo, gasto
> autorizado, ajuste a favor y saldo a favor aplicado. Un accesorio devuelto no
> tiene línea de entrega que marcar, así que se acredita con un `Ajuste`.
> **La deuda nunca queda negativa**: si el crédito del local supera lo que debe,
> la bodega no le queda debiendo plata sino MERCANCÍA — el excedente vive en
> `saldo_a_favor` y `_aplicarSaldoAFavor` lo consume al recibir el próximo envío,
> dentro de la misma transacción de la recepción.
> Una remesa **en tránsito** no baja la deuda (esa regla no cambió) pero su
> imputación ya está escrita y **reserva** el envío: sin `SQL_ABONOS_RESERVADOS`
> dos pagos seguidos sin confirmar taparían el mismo envío dos veces.
> **Invariante probado**: `Σ saldo(envío) + cargos_sueltos = deuda_total`, y
> `Σ movimientos del extracto = totales.neto`.
> **Costos ocultos a vendedores** (`red_interna_ocultar_costos`, default on): el
> recorte va en el backend (`_recortarParaVendedor`), nunca solo en la pantalla.
> Desde el cambio de modelo el vendedor **sí ve la cuenta** (la tiene que pagar);
> lo que se esconde es la valorización de la mercancía. Todo campo monetario
> nuevo hay que decidirlo ahí — el `desglose` se colaba entero y repetía justo
> los valores que el recorte anula.
> **Nada cambia la cuenta a espaldas del otro** (v4, `20260823_red_interna_control.sql`):
> la regla de "la otra parte confirma" se extendió a lo que toca la cuenta.
> Un GASTO del local nace `'Por aprobar'` y no le baja la deuda hasta que la
> bodega lo acepte — antes bajaba sola y un local podía rebajarse la deuda sin
> que nadie se enterara. Rechazarlo tumba su imputación pero **no devuelve la
> plata**: el local la gastó de verdad y se la come. Los abonos de un gasto se
> escriben igual que los de una remesa en tránsito (reservan, no cuentan).
> **Todo error tiene salida**: anular un gasto o un ajuste (la columna `anulado`
> existía desde 20260725 y ningún código la usaba), revertir una remesa que la
> bodega ya confirmó, mover un abono al envío correcto, reportar después lo que
> nunca llegó y corregir el valor de una línea entregada. Quién puede deshacer
> qué lo decide el service, no la ruta: el local solo su gasto sin aprobar.
> El **reclamo por faltante** viaja por el circuito de la devolución y deja la
> línea `'Devuelta'`, no `'Faltante'` — ese estado significa "nunca entró al
> cargo" y usarlo ahí encogía hacia atrás el cargo original del envío *además*
> de generar la nota de crédito, contando la baja dos veces. El "nunca llegó"
> vive en `remisiones.motivo`.
> **Un CARGO también es un documento que se paga** (v5,
> `20260823_red_interna_cargos_pagables.sql`). Reportado desde producción: *"Todos
> tus envíos están pagados. Más $830.000 de cargos. Y $586.010 a tu favor."*
> Deber y tener a favor a la vez, porque un ajuste en contra subía la deuda pero
> no era un documento: `_imputarFIFO` solo repartía entre ENVÍOS, así que el
> cargo **no se podía pagar nunca** — con los envíos al día el dinero se volvía
> saldo a favor y el cargo se quedaba ahí. Ahora `abonos_remision` apunta a un
> envío **o** a un cargo (`cargo_id`, CHECK de exactamente uno), el FIFO los
> reparte juntos por fecha, y el cargo sale como tarjeta propia en la pestaña de
> Envíos. **INVARIANTE: si hay saldo a favor, no hay deuda abierta** — el
> crédito se aplica en cuanto aparece (`_aplicarSaldoAFavor` corre al recibir,
> al cargar y al confirmar una devolución), no espera un envío que quizá no
> llega. La identidad pasó a ser `Σ saldo de TODOS los documentos = deuda_total`.
> **Avisos push** (`_avisar`, nunca lanza): despacho, recepción —que ahora
> genera la deuda y la puede confirmar un vendedor—, gasto por aprobar y su
> decisión, ajuste y anulación. Antes el módulo no usaba `notificaciones` en
> ningún punto.
> Pruebas: `11-envios-por-remision` (la cuenta y sus invariantes),
> `21-backfill-envios` (la migración de los negocios que ya operaban, y que el
> runner de arranque cree lo mismo que el `.sql`), `22-corregir-errores` (la
> aprobación y todo lo que se puede deshacer). Las suites `01`, `03`, `05`, `06`
> y `07` siguen cubriendo el circuito.
> **Las migraciones de este módulo NO son manuales**: están replicadas inline en
> `src/config/migrations.js`, que corre en cada arranque. Escribir el `.sql` y
> olvidar el runner deja el despliegue con el código nuevo contra una base vieja
> — ya pasó con `abonos_remision`.

> **Tesorería**: los saldos por cuenta (efectivo/banco/billetera/corresponsal/divisa USD) se **derivan** de las tablas transaccionales existentes mapeando método de pago → cuenta, anclados en arqueos. Solo traslados/retiros/gastos se escriben en `movimientos_dinero`. Si cambian las reglas de qué entra/sale en `caja.repository.js`, replicarlas en `tesoreria.repository.js` (ramas marcadas). Los movimientos de efectivo se espejan en `movimientos_caja` con `referencia_tipo='tesoreria'`. Un pago de compra desde Tesorería crea un **Abono espejo** en `movimientos_acreedor` (`registrar_en_caja=FALSE`, `mov_dinero_id`) que salda la deuda del acreedor sin doble descuento; anular el pago elimina/recrea el espejo en cascada.

### Frontend API Layer

Each feature has a dedicated Axios client file in `frontend/src/api/` (e.g., `productosApi.js`, `facturasApi.js`). These files are the only place that constructs request URLs — components and hooks should never call `axios` directly.

State is split between:
- **Zustand stores** (`carritoStore`, `sucursalStore`) for UI/session state.
- **React Query** for server state and caching.
- **AuthContext** for the authenticated user/session.

### Route Protection

`PrivateRoute` in `frontend/src/components/Layout/` enforces authentication. `ModuloGuard` enforces plan-level feature permissions (some modules are locked behind Premium/Monthly plans).

### PWA Caching Strategy

Routes under `/api/reportes` and `/api/facturas` use **NetworkOnly** (always fresh). Other API routes cache responses for 5 minutes. This is configured in the Vite PWA plugin settings.

### Database

- PostgreSQL, timezone forced to `America/Bogota`.
- **No hay un archivo único de esquema.** El esquema real se reconstruye entre
  `backend/migrations/*.sql` (cambios incrementales, aplicados al arranque desde
  `src/config/migrations.js`) y `backend/scripts/pruebas-red-interna/esquema.sql`
  + `esquema-completo.sql`, que son fixtures **escritos a mano** para las pruebas.
  Esos fixtures solo contienen las columnas que tocan las consultas bajo prueba y
  pueden desviarse de producción: si dudas de una columna, créele a la migración,
  no al fixture.
- Billing states: `trial`, `mensual`, `premium`, `vencido`, `suspendido`.
- A separate `superadmin` table exists for platform owners (distinct from `admin_negocio`).

---

## Deployment

| Layer    | Platform | Notes |
|----------|----------|-------|
| Backend  | Railway  | `VITE_API_URL` in frontend points here |
| Frontend | Vercel   | SPA rewrite configured in `vercel.json` |
| DB       | PostgreSQL (Railway) | |

### Required Backend Environment Variables
```
DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
JWT_SECRET, JWT_REFRESH_SECRET, JWT_SA_SECRET
PORT, NODE_ENV, FRONTEND_URL
EMAIL_USER, EMAIL_PASS
```

Opcionales (si faltan, su feature queda apagada y el resto funciona igual):
```
VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT   # notificaciones push
SUPABASE_URL, SUPABASE_SERVICE_KEY                   # backup automático
R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL, R2_BUCKET
                                                     # fotos del catálogo web
CATALOGO_URL, CATALOGO_REVALIDATE_SECRET             # refresco inmediato del catálogo
```

> **Refresco del catálogo web.** La app pública cachea su HTML 30 min (ISR) para
> proteger la BD del tráfico anónimo. `catalogo.revalidar.js` purga esa caché al
> instante después de publicar, editar o subir una foto — y **nunca lanza**: que
> el catálogo tarde en refrescarse no puede tumbar el guardado de un producto.
> Sin `CATALOGO_URL` / `CATALOGO_REVALIDATE_SECRET` la feature queda apagada y
> el catálogo solo se refresca por ISR. Los cambios hechos desde Inventario (un
> precio, una venta que agota el stock) no disparan refresco: para esos está el
> botón "Actualizar ahora" de la pestaña Catálogo web.

> **Las fotos del catálogo van a Cloudflare R2, NO a Supabase Storage.** La BD
> está en el plan gratuito de Supabase, cuyo cupo de salida es compartido con la
> base que corre la facturación: un catálogo viral podría hacer que Supabase
> restrinja el proyecto y con él el punto de venta. R2 no cobra egress. Todo el
> almacenamiento está aislado en `catalogo.storage.js` (`estaActivo`, `subir`,
> `borrar`): cambiar de proveedor toca ese único archivo.

---

## Key Conventions

- **Rate limiting**: 60 req/min on all `/api/` routes except `/health`.
- **CORS**: Strict whitelist — `FRONTEND_URL` env var + `localhost:5173`.
- **Excel**: Inventory/product imports handled via `multer` + `xlsx` on the backend; frontend also exports Excel directly.
- **PDF**: Generated server-side with `pdfkit`.
- **Email**: Multiple providers in use — Nodemailer (Gmail), Brevo SDK, and Resend — configured per environment.
- **Backup**: Automated cron jobs via `node-cron` in the `backup` module.
- **Superadmin JWT**: Uses a separate secret (`JWT_SA_SECRET`) and separate middleware from regular user auth.
