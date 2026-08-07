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
node scripts/pruebas-red-interna/17-pago-total-acreedor.mjs
node scripts/pruebas-red-interna/18-importacion.mjs
node scripts/pruebas-red-interna/19-ordenes-compra.mjs
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

### `17-pago-total-acreedor.mjs` — 44 verificaciones

El pago total a un proveedor se sigue repartiendo entre los cargos abiertos,
pero el estado de cuenta lo muestra como el movimiento único que hizo el
usuario. La suite comprueba que esa mejora sea solo de lectura.

No usa `esquema.sql`: monta su propio esquema mínimo (acreedores, movimientos,
compras) y aplica `migrations/20260805_pago_total_acreedor.sql`.

| # | Escenario |
|---|---|
| 1-2 | Cargos y abonos parciales normales se siguen viendo uno por uno |
| 3 | Un pago de $10.000.000 **por dentro** son 3 filas, repartidas FIFO |
| 4 | **En el extracto es UNA línea** de $10.000.000, con el reparto adentro |
| 5 | El saldo corrido es idéntico al que da la suma cruda de la tabla |
| 6 | Cargos, caja e historial por cargo siguen viendo las porciones reales |
| 7 | **Borrar una porción** (anular una compra) baja el pago mostrado y cuadra |
| 8 | Un pago que cae en un solo cargo no se confunde con un pago adelantado |
| 9 | Los pagos de dos acreedores no se mezclan |
| 10 | El backfill agrupa los pagos viejos y es idempotente |

> El punto 7 es la razón de no guardar el total en una tabla aparte: cancelar
> una compra borra sus abonos, y un total guardado quedaría inflado contra un
> saldo que ya bajó. Derivarlo con `SUM` lo hace imposible por construcción.

### `18-importacion.mjs` — 212 verificaciones

Importación de inventario desde Excel, probada **como la usa una persona**: se
generan bytes `.xlsx` de verdad y se entregan al controller real con un req/res
falsos, así que también se ejercita la detección de hojas y la lectura de
cabeceras — donde vivían la mitad de los fallos.

No usa `esquema.sql`: monta `esquema-importacion.sql`, que replica las
**restricciones reales** de producción (verificadas con `pg_index`), no un
mínimo cómodo. Importa: `productos_cantidad UNIQUE (nombre, sucursal_id)` es
**exacto** mientras el importador busca con `LOWER(nombre)` — de ese desajuste
nacen los duplicados `[11PRO]`/`[11Pro]` que hay en producción. Un fixture más
permisivo dejaría pasar justo lo que se quiere cazar.

| # | Escenario |
|---|---|
| 1 | Alta inicial sin features · **el preview no escribe nada** |
| 2 | El mismo archivo en otra sucursal: cada sede recibe lo suyo |
| 3 | Re-subir el archivo **duplica el stock**, y el preview lo anuncia |
| 4 | Duplicados que ya existen: se detectan, **jamás se tocan** |
| 5 | IMEI en otra sede / vendido / repetido en el archivo → conflicto |
| 6 | El mismo IMEI en OTRO negocio sí puede |
| 7 | Variantes: el costo baja hasta atributo y variante |
| 8 | Las mismas columnas con las features apagadas |
| 9 | Código único: herencia entre sedes y conflictos |
| 10 | Hojas basura, hoja de seriales vacía, varias hojas de producto en un libro |
| 11 | `1.500` / `1,500` / `1.500,50` y fechas `dd/mm/aaaa` |
| 12 | Sin costo: **avisa, nunca bloquea** |
| 13 | El preview no escribe ni con errores de por medio |
| 14 | **El preview promete exactamente lo que hace la corrida real** |
| 15 | Integridad: nadie se pisó con nadie |
| 16 | **Ida y vuelta real**: descargar la plantilla, llenarla y subirla |
| 16b | Característica que se llama igual que una columna fija (`Color`) |
| 17 | **Un negocio, tres sucursales**: aritmética de stock exacta |
| 17b | **Mismo nombre en dos sedes con stock distinto** — cantidad Y serial |

> El punto 14 es el que sostiene todo lo demás: el preview no es un validador
> paralelo (esos se desincronizan y acaban mintiendo), es el importador de
> verdad corriendo dentro de una transacción que termina en `ROLLBACK`.

> El 16 es el único que prueba que el `.xlsx` que el sistema **entrega** sea el
> que el sistema **sabe leer**. Si la plantilla y el parser se separan, todo lo
> demás sigue en verde y el usuario no puede importar nada.

### `19-ordenes-compra.mjs` — 82 verificaciones

Órdenes de compra, recepción parcial, procedencia y garantía de proveedor.
Aplica `migrations/20260806_ordenes_compra.sql` tal cual va a producción.

| # | Qué verifica |
|---|---|
| 1 | Doble candado: apagado por defecto; los códigos de proveedor no se encienden sin código interno |
| 2 | **Con la feature apagada, `registrarCompra()` se comporta igual que siempre** |
| 3 | Una orden en borrador no admite recepciones |
| 4 | Recepciones parciales suman exacto; recibir de más se rechaza |
| 5 | **Cancelar una recepción reabre SU parte, sin tocar las otras** |
| 6 | **Devolver reabre el pendiente** — el caso que falla sin `cantidad_devuelta` |
| 7 | Procedencia: proveedores reales de un producto, descontando lo devuelto |
| 8 | El vencimiento de garantía no corre un día entre `TIMESTAMP` y `DATE` |
| 9 | Cerrar («ya no va a llegar») no toca inventario ni deuda |
| 10 | **Los dos modos de cargo**: `recepcion` y `orden` |
| 11 | Aislamiento entre sucursales y entre negocios |
| 12 | Anular solo sin recepciones; se lleva su cargo |
| 13 | **No existe ninguna columna de avance guardado** |
| 14 | Códigos del proveedor: la equivalencia se aprende, no se captura |
| 15 | Alerta de facturas de proveedor por pagar |

> El 5 y el 6 son los que justifican todo el diseño: el avance de la orden se
> **deriva** de `lineas_compra` en cada lectura. Un contador guardado quedaría
> inflado contra recepciones canceladas y contra mercancía devuelta, y la orden
> nunca volvería a pedir lo que se devolvió.

> El 13 es un candado sobre el diseño mismo: consulta
> `information_schema.columns` para que nadie agregue un `cantidad_recibida` más
> adelante «para que sea más rápido».

> El 15 cubre un error fácil de cometer: los abonos de la cartera de proveedores
> se siguen por **`cargo_id`**, no por la orden. Un pago hecho desde la cuenta del
> proveedor —la vía normal— solo lleva `cargo_id`; buscándolo por
> `orden_compra_id` o `compra_id`, pagar una factura no apagaría su aviso y el
> dueño seguiría viendo «vencida» sobre algo que ya pagó.

> Ojo con el `FILTER (WHERE c.id IS NOT NULL)` del cálculo de avance. Poner
> `c.estado <> 'Cancelada'` en el `WHERE` convertiría el `LEFT JOIN` en `INNER` y
> las líneas sin recepciones desaparecerían; ponerlo solo en el `JOIN` no basta,
> porque un `LEFT JOIN` que no empareja **no descarta la fila de
> `lineas_compra`**, solo deja `c.*` en `NULL`. Sin el `FILTER`, las recepciones
> canceladas siguen sumando. Las dos versiones equivocadas fallan aquí.

## Nota sobre `esquema.sql`

Es un recorte del esquema real: solo las tablas y columnas que tocan las
consultas bajo prueba. Si en producción cambia alguna de esas columnas, hay que
reflejarlo aquí o las pruebas dejarán de representar la realidad.
