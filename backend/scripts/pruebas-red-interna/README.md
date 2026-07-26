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
```

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

## Nota sobre `esquema.sql`

Es un recorte del esquema real: solo las tablas y columnas que tocan las
consultas bajo prueba. Si en producción cambia alguna de esas columnas, hay que
reflejarlo aquí o las pruebas dejarán de representar la realidad.
