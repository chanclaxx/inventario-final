# Pruebas de la red interna (bodega → locales)

Verifican el circuito completo contra un **Postgres real** (PGlite, la build WASM
de Postgres) montado en memoria. No tocan la base de datos de producción ni
requieren un servidor: cada ejecución crea el esquema desde cero, corre los
escenarios y desaparece.

Ejercitan el **service verdadero**, no mocks: se inyecta un pool falso en
`src/config/db.js` que apunta a la base en memoria.

## Cómo correrlas

PGlite no está en `package.json` a propósito — no debe entrar al despliegue.
Se instala solo cuando se van a correr las pruebas:

```bash
cd backend
npm install --no-save @electric-sql/pglite   # o: npm i -D @electric-sql/pglite

node scripts/pruebas-red-interna/00-aislamiento-sucursales.mjs
node scripts/pruebas-red-interna/01-circuito-completo.mjs
node scripts/pruebas-red-interna/02-seguridad-produccion.mjs
node scripts/pruebas-red-interna/03-accesorios-y-codigos.mjs
node scripts/pruebas-red-interna/04-referencias-sin-duplicar.mjs
node scripts/pruebas-red-interna/05-bugs-despacho.mjs
node scripts/pruebas-red-interna/06-estado-cuenta.mjs
node scripts/pruebas-red-interna/07-devolucion-costos-medios.mjs
node scripts/pruebas-red-interna/08-tarifas-porcentuales.mjs
node scripts/pruebas-red-interna/09-mora-credito.mjs
node scripts/pruebas-red-interna/10-adversario-mora-tarifas.mjs
node scripts/pruebas-red-interna/11-envios-por-remision.mjs
node scripts/pruebas-red-interna/12-destino-y-referencias.mjs
```

> Las suites cargan **las dos migraciones**: `20260725_red_interna.sql` y
> `20260726_red_interna_v2.sql`. Si se agrega una tercera hay que sumarla a
> todas, o fallarán con columnas inexistentes.

> **Todas** las suites cargan además `esquema-completo.sql`, que **complementa**
> a `esquema.sql` en vez de reemplazarlo. Hace falta en todas desde que el
> estado de una unidad dice también a quién se le prestó: ese cruce toca
> `prestamos` y `prestatarios`, que viven en el complemento.

### Diagnóstico sobre datos reales (solo lectura)

```bash
node scripts/pruebas-red-interna/diagnostico-catalogo.mjs <negocio_id>
```

Se conecta a la base del `.env` y reporta qué referencias parecen duplicadas o
quedaron sin código. **No escribe nada**: abre la sesión con
`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`, así que cualquier
intento de escritura falla en el motor. El `negocio_id` es obligatorio para no
recorrer datos de otros clientes por accidente.

Ambos salen con código 0 si todo pasa.

> Si `npm install --no-save` falla por el estado del lockfile, sirve instalar en
> una carpeta aparte y copiar `node_modules/@electric-sql/pglite` dentro de
> `backend/node_modules/`. La dependencia solo se usa para correr estas pruebas.

## Qué cubre cada una

### `00-aislamiento-sucursales.mjs` — 47 verificaciones · **prueba de caracterización**

Deja por escrito que dos sucursales que manejan **el mismo producto** (mismo
nombre y mismo código) siguen siendo independientes. Ejercita los repositorios
reales de inventario, préstamos, búsqueda y reportes.

Se corrió **antes** de tocar la resolución de referencias (línea base: 47/47) y
**después** del cambio (47/47). Que dé idéntico es la prueba de que el
aislamiento no se rompió.

| # | Propiedad |
|---|---|
| 1 | Cada sucursal ve solo su stock, su costo y su precio |
| 2 | La vista global agrupa por nombre pero detalla cada sucursal |
| 3 | Vender en una no toca el stock ni los seriales de la otra |
| 4 | Prestar en una no afecta a la otra |
| 5 | El mismo código escaneado en cada sucursal devuelve **su** fila |
| 6 | Ventas y utilidad se reportan por sucursal, sin mezclarse |
| 7 | La alerta de stock bajo no se contamina entre sucursales |
| 8 | El valor de inventario es independiente |
| 9 | Ajustar el costo en una no mueve el de la otra |
| 10 | El código único se valida a nivel negocio y se hereda al replicar |
| 11 | Las garantías siguen la línea del producto |
| 12 | Ninguna sucursal termina con el mismo producto repetido |

### `01-circuito-completo.mjs` — 51 verificaciones

| # | Escenario |
|---|---|
| 1 | La bodega despacha: el inventario **no** se mueve todavía |
| 2 | El local recibe con faltantes: lo no marcado se queda en bodega |
| 3 | Consignación: mercancía sin vender **no** genera deuda |
| 4 | Venta de contado → nace la obligación de liquidar el costo |
| 5 | Venta a crédito → liquida `mín(recaudado, costo)`, topado en el costo |
| 6 | Remesa con cuenta de tránsito: el dinero nunca desaparece del total |
| 7 | Conciliación FIFO: cuál equipo ya se pagó y cuál no |
| 8 | **La utilidad de los reportes no se altera** |
| 9 | Panel de salud: detecta un equipo que se movió por fuera |
| 10 | El traslado libre queda cerrado con la red activa |

### `02-seguridad-produccion.mjs` — 24 verificaciones

| # | Escenario |
|---|---|
| A | Un negocio **sin** el flag no nota nada: su traslado libre sigue igual |
| B | Idempotencia del despacho: doble toque → una sola remisión |
| C | Un equipo no puede estar vivo en dos remisiones |
| D | Anular en tránsito libera el equipo para volver a despacharlo |
| E | No se puede recibir dos veces |
| F | Un local no puede recibir la remisión de otro |
| G | Devolución local → bodega |
| H | **Idempotencia de remesas** (el error que costaría plata) |
| I | Anular remesa desactiva los movimientos, nunca los borra |
| J | Apagar el flag revierte el comportamiento sin migrar nada |

### `03-accesorios-y-codigos.mjs` — 31 verificaciones

| # | Escenario |
|---|---|
| 1 | Un solo campo de escáner resuelve IMEI **y** código único |
| 2 | Catálogo de accesorios: solo los que tienen stock, busca por nombre o código |
| 3 | Ítems del carrito se re-resuelven **al costo**, no al precio de venta |
| 4 | Despacho mixto: equipo + accesorios en la misma remisión |
| 5 | Recepción parcial de accesorios (llegaron 7 de 10) |
| 6 | Liquidación de accesorios anclada en el stock del local |
| 7 | Devolución de accesorios rebaja la consignación |
| 8 | Un local no puede despachar: solo la bodega |

### `04-referencias-sin-duplicar.mjs` — 22 verificaciones

El caso reportado en producción: la bodega tiene `iPad 10 64GB` (cód. `IPAD10`)
y el local tiene **el mismo iPad** escrito `iPad 10ma gen 64GB`, con el mismo
código. El despacho creaba una tercera fila **sin código** que el lector no
encontraba, y corregirla a mano tiraba un 409.

| # | Escenario |
|---|---|
| 1 | La previsualización dice a qué referencia va cada producto y con qué confianza |
| 2 | Despachar y recibir sin crear una sola referencia nueva |
| 3 | El lector sigue funcionando en el local después del despacho |
| 4 | Lo que sí es nuevo se crea **heredando el código** |
| 5 | Despachar lo mismo otra vez no vuelve a crear |
| 6 | Ninguna sucursal queda con el producto repetido ni con referencias mudas |
| 7 | El usuario puede forzar el destino a mano |
| 8 | Un id de otra sucursal se rechaza |

### `05-bugs-despacho.mjs` — 16 verificaciones

Regresión de tres fallos reportados en producción.

| # | Escenario |
|---|---|
| A | Buscar por código cuando ese texto coincide con el IMEI de un equipo vendido: devuelve el accesorio, y si ninguno sirve explica **ambos** motivos |
| B | El valor de la línea es editable y manda sobre el costo; negativo se rechaza |
| C | El valor editado es el que el local termina liquidando |
| D | El precio del carrito llega como sugerencia, nunca aplicado solo |

### `06-estado-cuenta.mjs` — 43 verificaciones

El extracto tipo bancario de cada local.

| # | Escenario |
|---|---|
| 1 | Recién recibido: el envío es un apunte informativo y el saldo sigue en 0 |
| 2 | Cada venta genera un cargo con cliente, factura y valor interno |
| 3 | La remesa solo abona cuando la bodega la confirma |
| 4 | Los gastos por cuenta de bodega abonan |
| 5 | **La suma de los movimientos cuadra con el saldo del panel** |
| 6 | Búsqueda por IMEI y por cliente; filtros por estado con sus totales |
| 7 | Cada unidad trae trazabilidad completa (envío, recepción, venta, cliente) |
| 8 | Un local no ve la cuenta de otro; la bodega ve todas |
| 9 | El rango de fechas filtra el extracto sin alterar los totales |
| 10 | **Recepción confirmada tarde**: la venta intermedia sí genera cargo |

### `07-devolucion-costos-medios.mjs` — 46 verificaciones

| # | Escenario |
|---|---|
| 1 | La devolución distingue si cada equipo vino de bodega o es del local |
| 2 | Emitirla **no mueve inventario**: queda en tránsito |
| 3 | La bodega confirma → se mueve todo y lo propio genera **saldo a favor** |
| 4 | Las devoluciones sin confirmar salen en la bandeja de la bodega |
| 5 | **Un vendedor no ve costos** pero sí cuánto debe remitir |
| 6 | Remesas por Nequi/banco: cuenta correcta, sin espejo en caja física |
| 7 | Corrección de valor: directa en tránsito, con nota si ya se recibió |
| 8 | Detalle del envío con estado por línea y resumen de lo que ya es deuda |
| 9 | El desglose explica el saldo y por qué medio ha pagado |
| 10 | Un local no puede confirmar su propia devolución |

### `11-envios-por-remision.mjs` — 60 verificaciones

El estado de cuenta contado **envío por envío**: de cada remisión que mandó la
bodega, qué se vendió, qué se prestó y qué sigue en vitrina.

| # | Escenario |
|---|---|
| 1 | Tres envíos, uno con accesorios y otro anulado: el anulado se lista sin unidades |
| 2 | Vendido / prestado / disponible se separan por envío, y el prestado **no** genera deuda |
| 3 | La devolución descuenta del envío del que salió el equipo |
| 4 | **Σ pendiente por envío + accesorios = saldo por liquidar** |
| 5 | Un pago parcial se imputa a las ventas más antiguas (FIFO), no al envío más viejo |
| 6 | Los gastos por cuenta de bodega también imputan |
| 7 | Y los ajustes de la bodega |
| 8 | La deuda de accesorios queda como residuo: **no se cuelga de ningún envío** |
| 8b | **DEUDA TOTAL ≠ POR REMITIR**: `deuda_total = por_remitir + lo que aún no se cobra` |
| 9 | La mercancía se filtra por varios estados a la vez (`Por liquidar,En recaudo`) |
| 10 | **Un vendedor ve los conteos** (qué vendió, qué prestó) **pero ningún peso** |
| 11 | La bodega ve lo mismo; un local sigue sin poder ver la cuenta de otro |
| 12 | Devolver mercancía **baja la deuda pero no lo exigible** (nunca se vendió) |

> La identidad del punto 4 se vuelve a verificar en los puntos 5, 6, 7 y 8: es
> la que garantiza que el desglose por envío y el número grande del panel
> cuenten la misma historia.

### `12-destino-y-referencias.mjs` — 42 verificaciones

A dónde fue cada equipo y bajo qué nombre quedó, más la deuda en el Dashboard.

| # | Escenario |
|---|---|
| 1 | "Recibí todo" de un solo toque recibe el envío completo, sin faltantes |
| 2 | Vendido: cliente, factura y fecha |
| 3 | **Prestado: a quién, con su número de préstamo** (antes no se veía) |
| 4 | El cruce del préstamo respeta los candados: uno de otra sucursal no contamina |
| 5 | Devuelto: cuándo volvió a la bodega y con qué documento |
| 6 | **La referencia de la bodega vs la del local**: solo se marca la diferencia REAL |
| 7 | Tildes, mayúsculas y espacios de más no cuentan como diferencia |
| 8 | El detalle del envío dice lo mismo que la lista — y su resumen ya no da 0 |
| 9 | Un vendedor ve el destino y los dos nombres, pero ningún peso |
| 10 | **La deuda del Dashboard es exactamente la del panel** (una sola fórmula) |
| 11 | No aparece para la bodega, ni para un negocio sin la feature, ni si se apaga |

> El punto 8 es una regresión: `getLineasDetalladas` recibía el id de la
> remisión donde el motor de estados esperaba la sucursal, así que el detalle
> de un envío mostraba siempre el estado de la línea y `liquidable = 0`.

## Nota sobre `esquema.sql`

Es un recorte del esquema real: solo las tablas y columnas que tocan las
consultas bajo prueba. Si en producción cambia alguna de esas columnas, hay que
reflejarlo aquí o las pruebas dejarán de representar la realidad.
