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
node scripts/pruebas-red-interna/21-backfill-envios.mjs
node scripts/pruebas-red-interna/22-corregir-errores.mjs
node scripts/pruebas-red-interna/17-pago-total-acreedor.mjs
node scripts/pruebas-red-interna/18-importacion.mjs
node scripts/pruebas-red-interna/19-ordenes-compra.mjs
node scripts/pruebas-red-interna/20-borradores.mjs
node scripts/pruebas-red-interna/23-costo-serial-en-local.mjs
node scripts/pruebas-red-interna/24-remision-por-variante.mjs
node scripts/pruebas-red-interna/25-reclamo-faltante.mjs
node scripts/pruebas-red-interna/26-lotes-cantidad.mjs
node scripts/pruebas-red-interna/28-abonos-anulados.mjs
node scripts/pruebas-red-interna/36-ubicaciones.mjs
node scripts/pruebas-red-interna/37-pedidos-a-bodega.mjs
node scripts/pruebas-red-interna/40-simulacion-tesla.mjs
node scripts/pruebas-red-interna/41-prestamos-por-persona.mjs
node scripts/pruebas-red-interna/54-tecnicos-externos.mjs
```

> `20-borradores` verifica sobre todo una invariante negativa: guardar un
> borrador **no escribe nada en el inventario**. No hay UPDATE a `seriales` ni a
> `productos_cantidad` en todo el módulo, y la sección 12 lo comprueba al final,
> después de doce secciones creando y borrando borradores. Si esa prueba se cae,
> la reserva dejó de ser blanda y la mercancía apalabrada está desapareciendo de
> reportes, catálogo y alertas de stock.

> Las suites cargan **toda la cadena de migraciones** de la red interna, hoy
> nueve: `20260725_red_interna`, `20260726_red_interna_v2`,
> `20260822_red_interna_envios`, `20260823_red_interna_control`,
> `20260823_red_interna_cargos_pagables`, `20260823_remision_variantes` y
> `20260823_lotes_cantidad` y
> `20260823_valor_acreditado`. Si se
> agrega otra hay que sumarla a **todas** las suites que carguen la cadena, o
> fallarán con columnas inexistentes — pasó al añadir la de variantes: catorce
> suites reventaron con `column "atributo_origen_id" does not exist`.

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

### `11-envios-por-remision.mjs` — 64 verificaciones

**La cuenta de cada envío.** Desde el cambio de modelo (agosto 2026) el envío es
el documento de deuda: el local paga todo lo que recibe, esté vendido o no. Cada
envío tiene su cargo (derivado de sus líneas) y sus abonos (escritos, porque a
qué envío se imputa un pago lo decide una persona).

| # | Escenario |
|---|---|
| 1 | El cargo del envío = lo que el local recibió, accesorios incluidos |
| 2 | **Vender NO mueve la cuenta**: ni de contado ni a crédito a medio recaudar |
| 3 | Devolver un equipo baja el cargo de SU envío, sin contra-asiento |
| 4 | **Abono dirigido**: paga el envío que el local elija, aunque no sea el más viejo |
| 5 | **Pago total**: se reparte del envío más viejo al más nuevo, un abono por envío |
| 6 | Gastos y ajustes entran por el mismo reparto |
| 7 | Una remesa sin confirmar **reserva** pero no baja la deuda; anularla la libera |
| 8 | Devolver algo ya pagado deja **saldo a favor**, que el próximo envío consume solo |
| 9 | Un ajuste **en contra** no cuelga de ningún envío: suma aparte |
| 10 | El extracto cuadra con la cuenta; las ventas van en 0 |
| 11 | La mercancía se filtra por varios estados a la vez (`Por liquidar,En recaudo`) |
| 12 | Un vendedor **ve la cuenta** (la tiene que pagar) pero no el costo de la mercancía |
| 13 | La bodega ve lo mismo; un local sigue sin poder ver la cuenta de otro |

> **La identidad** `Σ saldo(envío) + cargos sueltos = deuda_total` se vuelve a
> verificar en los puntos 3, 5, 6 y 9: es la que garantiza que las tarjetas de
> abajo y el número grande cuenten la misma historia.
>
> El punto 12 cubre una fuga real: el `desglose` viajaba sin recortar y repetía
> los mismos valores que el recorte pone en `null` unas líneas más arriba.

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

### `17-pago-total-acreedor.mjs` — 59 verificaciones

El pago total a un proveedor se sigue repartiendo entre los cargos abiertos,
pero el estado de cuenta lo muestra como el movimiento único que hizo el
usuario. La suite comprueba que esa mejora sea solo de lectura.

No usa `esquema.sql`: monta su propio esquema mínimo (acreedores, movimientos,
compras) y aplica `migrations/20260805_pago_total_acreedor.sql` y
`migrations/20260813_descripcion_pago_total.sql`.

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
| 11 | La consulta corre con los **tipos reales** (firma BYTEA, timestamptz, bigserial) |
| 12 | La **descripción** del pago se ve pegada a la etiqueta y no toca la contabilidad |

> El punto 12 verifica lo que NO cambia: la columna `descripcion` de cada fila
> hija sigue siendo `'Pago total distribuido'` —la marca que reconoce el
> backfill del punto 10 y la que edita el usuario desde el historial del
> cargo—, y un pago sin nota (o anterior a la columna) se rotula exactamente
> igual que antes.

> El punto 7 es la razón de no guardar el total en una tabla aparte: cancelar
> una compra borra sus abonos, y un total guardado quedaría inflado contra un
> saldo que ya bajó. Derivarlo con `SUM` lo hace imposible por construcción.

### `18-importacion.mjs` — 244 verificaciones

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
| 18 | La columna Ubicacion crea el sitio y asigna el producto |
| 19 | **Código automático**: lo que NACE en la importación nace con código; el preview lo anuncia sin gastar números; la otra sede hereda |

> `esquema-importacion.sql` trae desde sep-2026 `contadores_documento`. Sin ella
> la pasada del código automático fallaba **en silencio** (es tolerante: una
> importación no se cae por un código) y la suite seguía en verde sin haber
> asignado un solo código — una prueba que no puede fallar no prueba nada.

> El punto 14 es el que sostiene todo lo demás: el preview no es un validador
> paralelo (esos se desincronizan y acaban mintiendo), es el importador de
> verdad corriendo dentro de una transacción que termina en `ROLLBACK`.

> El 16 es el único que prueba que el `.xlsx` que el sistema **entrega** sea el
> que el sistema **sabe leer**. Si la plantilla y el parser se separan, todo lo
> demás sigue en verde y el usuario no puede importar nada.

### `19-ordenes-compra.mjs` — 118 verificaciones

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
| 16 | **Recibir con variantes: el stock va a la HOJA, no al padre** |
| 17 | Seriales con color y características al recibir |
| 18 | Compra SUELTA con plazo: también vence |
| 19 | Pantalla de facturas: órdenes y compras sueltas juntas |
| 20 | **Se olvidó el plazo: se puede poner después** |

> El 5 y el 6 son los que justifican todo el diseño: el avance de la orden se
> **deriva** de `lineas_compra` en cada lectura. Un contador guardado quedaría
> inflado contra recepciones canceladas y contra mercancía devuelta, y la orden
> nunca volvería a pedir lo que se devolvió.

> El 13 es un candado sobre el diseño mismo: consulta
> `information_schema.columns` para que nadie agregue un `cantidad_recibida` más
> adelante «para que sea más rápido».

> El 16 es el que cierra un fallo silencioso: el stock de un producto con
> variantes es la **suma de sus hojas**, así que escribirlo en el producto padre
> lo borra la siguiente `sincronizarStockProductoEnTx`. La mercancía recibida se
> perdería sin un solo mensaje de error. La recepción reparte por variante igual
> que la compra normal, con el **mismo componente** (`capturaMercancia.jsx`), no
> con una copia.

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

### `21-backfill-envios.mjs` — 14 verificaciones

El **backfill** que migra a los negocios que ya venían operando con la regla
vieja. Es un `DO` en plpgsql (`20260822_red_interna_envios_backfill.sql`) que
imputa los pagos existentes a los envíos, en orden cronológico y FIFO.

| # | Escenario |
|---|---|
| 1 | El bloque plpgsql corre contra un Postgres real |
| 2 | Reparte del envío más viejo al más nuevo; la remesa anulada no se imputa |
| 3 | La cuenta que ve el usuario queda coherente: Σ saldo por envío = deuda |
| 4 | **Es idempotente**: correrlo dos veces no duplica un peso |
| 5 | Un negocio que nunca activó la red interna **no se toca** |
| 6 | Lo que sobre queda sin imputar y se lee como saldo a favor |

### `22-corregir-errores.mjs` — 39 verificaciones

**Que nadie cambie la cuenta a espaldas del otro, y que todo error tenga
salida.** El módulo ya exigía que la otra parte confirmara cualquier movimiento
de mercancía o de plata; esta suite cubre haber extendido esa regla a lo que
toca la cuenta directamente.

| # | Escenario |
|---|---|
| 1 | Un GASTO del local **no le baja la deuda** hasta que la bodega lo apruebe; le aparece en su bandeja |
|   | Rechazarlo tumba su imputación — y la plata NO se devuelve: el local la gastó de verdad |
| 2 | Un gasto o un ajuste mal tecleado se **anulan**, y con ellos su imputación y su egreso de caja |
| 3 | Cada quien deshace lo suyo: el local su gasto sin aprobar, nunca uno aprobado ni un ajuste |
| 4 | Una remesa **ya confirmada** la revierte la bodega, con toda su tesorería; el local no |
| 5 | Un abono que entró al envío equivocado se **mueve**, sin tocar tesorería ni caja |
| 6 | Lo que "se recibió" y nunca llegó se **reclama después**; la bodega confirma y el cargo baja |
| 7 | Las dos identidades aguantan después de todo eso |

> El punto 6 usa el circuito de la devolución a propósito: hace lo mismo con la
> cuenta y con el inventario. La línea queda `'Devuelta'` y no `'Faltante'`
> —`'Faltante'` significa "nunca entró al cargo", y usarlo aquí encogía hacia
> atrás el cargo original del envío *además* de generar la nota de crédito, con
> lo que la baja se contaba dos veces. El "nunca llegó" vive en
> `remisiones.motivo`, que es de donde lo leen la pantalla y el historial.

### `23-costo-serial-en-local.mjs` — 7 verificaciones

En un LOCAL de la red, el costo de un equipo que vino de la bodega es el
`valor_interno` de la remisión, no `seriales.costo_compra` (ese es el costo de
la BODEGA, y a propósito nunca se reescribe al remisionar). Los productos por
cantidad ya lo resolvían solos —la recepción reescribe `costo_unitario` con el
promedio ponderado sobre `valor_interno`—; los seriales no, porque `moverSerial`
solo cambia `producto_id`. El local vendía un equipo consignado y su utilidad
salía contra el costo de la bodega, inflada, mientras la de los accesorios salía
bien: el mismo reporte con dos varas de medir.

Las cuatro barandas importan tanto como el arreglo: la BODEGA sigue usando su
costo, una unidad PROPIA del local (retoma) también, un negocio SIN red interna
no cambia en nada, y una remisión anulada o no recibida no cuenta. Contra el
código anterior esta suite falla 3 de 7; las 4 barandas pasan en ambos.

### `24-remision-por-variante.mjs` — 24 verificaciones

Con la feature "Variantes" activa el stock NO vive en `productos_cantidad.stock`:
ese pasa a ser un derivado (Σ de sus hojas). La red interna se escribió antes y
movía el nivel de arriba, con cuatro daños silenciosos: no se podía decir qué
talla se despachaba; el producto quedaba descuadrado contra sus variantes en las
dos sedes; el valor interno se escribía como costo del producto y la tarifa del
local se quedaba sin base; y el primer ajuste sobre cualquier variante borraba lo
recibido mientras el local lo seguía debiendo.

Recorre el día completo —despacho → recepción → tarifa → ajuste → devolución— y
comprueba el invariante `producto = Σ variantes` en las dos sucursales **en cada
paso**. Las dos primeras secciones son las barandas: despachar sin decir la talla
se rechaza, y un producto SIN variantes se sigue despachando exactamente igual.

### `25-reclamo-faltante.mjs` — 18 verificaciones

El local confirma un envío de más y luego descubre que algo no venía en la caja.
Lo marca como faltante y su deuda **no baja sola**: baja cuando la bodega lo
revisa y confirma que la mercancía la tiene ella.

Reportado desde producción: la pantalla decía **siempre** "no hay nada que
reportar: todo lo de este envío ya se vendió, se prestó o se devolvió", con el
envío recién recibido y nada vendido. Eran dos fallos encadenados. El filtro de
candidatos exigía `tipo === 'serial'` — y `estado_unidad` solo existe para
seriales, porque el motor de estados sigue unidad por unidad y eso no se puede
hacer con mercancía fungible —, así que las líneas de CANTIDAD no eran ni
candidatas ni bloqueadas: desaparecían. Para un negocio con el catálogo por
variantes, eso es **todo** su envío. Y el mensaje de "no hay nada" afirmaba que
ya se había vendido sin haber mirado si había algo vendido.

Ahora una línea de cantidad se reclama por unidades: el backend calcula
`reclamable` = lo que entregó la línea acotado a lo que el local todavía tiene de
esa talla (un reclamo saca del local unidades que nunca llegaron; si ya las
vendió, no hay nada que sacar). Las secciones 5 y 6 son las que sostienen el
mensaje: lo vendido queda bloqueado **con motivo**, y solo cuando de verdad no
queda nada la pantalla dice que todo se vendió.

### `26-lotes-cantidad.mjs` — 16 verificaciones

Un SERIAL tiene identidad y por eso todo es exacto: `serial_id` une la línea de
entrega con la de devolución. La mercancía por CANTIDAD no la tiene, y el sistema
lo resolvía con agregados **por producto** y **promedios ponderados**. Tres
defectos, los tres silenciosos y los tres sobre dinero: devolver una talla que la
bodega nunca envió bajaba la deuda (el producto tenía pendientes en otra talla);
se acreditaba un precio promedio que no era el de ninguna unidad real; y lo
reclamable de cada línea se medía contra el stock completo, así que con dos
envíos de la misma talla se podía reclamar el doble de lo que había.

Ahora cada línea de entrega es un **lote** (cantidad + su valor). Devolver
consume lotes del más viejo al más nuevo escribiendo `cantidad_devuelta`, y el
cargo de cada envío baja solo por lo que salió de él y **a su precio** — el
equivalente fungible del `'Devuelta'` de un serial, sin contra-asiento. Lo que no
calce contra ningún lote es del local y no se acredita, salvo que la bodega
decida comprárselo.

La sección 7 de `25-reclamo-faltante` cubre la trazabilidad: una devolución pendiente
tiene que verse en las TRES pantallas (bandeja de la bodega, panel del local y su
estado de cuenta).

La sección 7 vigila el invariante contable: **Σ movimientos del extracto = la
deuda**. Al pasar a lotes el cargo bajaba solo (bien), pero la nota crédito del
extracto solo contaba seriales —los accesorios iban antes por un `Ajuste` que
este modelo eliminó por duplicado—, así que el extracto mostraba el cargo entero
sin ningún movimiento que explicara la baja y su saldo se separaba de la deuda.
`valor_acreditado` guarda el crédito FIFO real de cada línea: no se puede
derivar del `valor_interno` de la devolución, porque una que cruza dos lotes se
acredita a dos precios.

La sección 4 es la que más importa vigilar: devolver más de lo que queda en un
lote **cruza al siguiente** y cobra cada tramo a su propio precio.

## Nota sobre `esquema.sql`

Es un recorte del esquema real: solo las tablas y columnas que tocan las
consultas bajo prueba. Si en producción cambia alguna de esas columnas, hay que
reflejarlo aquí o las pruebas dejarán de representar la realidad.

### `28-abonos-anulados.mjs` — 57 verificaciones

Dos errores distintos dejaban la cuenta de un cliente mintiendo, y los dos se
arreglan con el mismo mecanismo: **el abono deja de contar pero NO desaparece**,
y queda con su motivo escrito al lado.

**1. Devoluciones.** Reportado desde producción (Cellsite): el prestamista
TIENDA mostraba **$362.400.000** en su estado de cuenta y **$363.580.000** de
deuda total. Al devolver un producto su cobro sale de la cuenta, pero los
abonos se quedaban vivos y el extracto los seguía restando: daba **por debajo**
de la deuda real, a 23 personas, y a varias en negativo — como si el negocio les
debiera plata.

**2. Pagos duplicados.** Un doble clic en "guardar" registraba el mismo pago dos
veces: 45 parejas por $106.887.760, con pagos totales de id consecutivo creados
en el mismo segundo. La sección 5 vigila la baranda que lo impide, y comprueba
que un abono por OTRO valor sí entra — la baranda no puede estorbar la operación
real.

**La regla del negocio: el valor correcto de toda cuenta es la deuda total.** El
extracto se alinea hacia ella; la deuda no se mueve por un abono anulado. La
sección 6 es el invariante que lo sostiene y el que hay que vigilar.

La sección 4 cubre la devolución PARCIAL: devolver unidades baja el valor del
préstamo y lo ya pagado puede quedar por encima. Para eso existe `valor_anulado`
— se anula solo el pedazo sobrante, sin inventar filas que nadie registró.

La sección 7 cubre **créditos**, que tenían el mismo hueco sin que nadie lo
supiera: cancelar la factura ponía el crédito en 'Cancelado' y dejaba sus abonos
vivos. Hay $3.250.000 así en producción.

La sección 8 cubre las **tres salidas del modal** que aparece al devolver algo
con abonos: no devolverlo, dejarlo a favor, o —solo si el pago vino de un pago
total— reasignarlo a sus otros préstamos. Ojo con lo que verifica: devolver un
producto **sí** baja la deuda por lo que faltaba de ESE producto; lo que nunca
puede pasar es que el ABONO la mueva por su cuenta.

> Esta suite fue la primera en ejercitar `saldo_a_favor_sucursal` e
> `historial_saldo_sucursal`, y ahí se descubrió que el fixture las declaraba con
> `valor`/`tipo` y sin el índice único — columnas que **no existen** en
> producción. Ya están corregidas en `esquema-completo.sql`.


### `35-etiquetas.mjs` — 135 verificaciones

Etiquetas imprimibles (código de barras y QR) de los productos por cantidad.

**Un código de barras mal generado no se ve mal.** Se ve perfecto, se imprime
perfecto, se pega en 400 productos y no escanea — o peor, escanea otra cosa. No
hay forma de detectarlo mirando el PDF, así que la sección 1 hace lo único que
sirve: un **decodificador Code 128 independiente**, escrito desde el estándar y
no desde el codificador, que lee de vuelta lo generado y lo compara contra el
texto original. Son 974 códigos: los catorce casos límite a mano (un carácter,
ceros a la izquierda, corridas impares de dígitos en medio del texto, todo
numérico, puntuación) y un barrido de 960.

Las otras dos cosas que solo se descubren cuando ya se gastó la plancha
adhesiva son la **retícula** (sección 8: que ninguna casilla se salga de su
página — ahí se cazó que ocho filas de 37,1 mm no caben en una A4) y el **ancho
del módulo** (sección 5: por debajo de 0,25 mm el lector empieza a fallar de
forma intermitente, que es peor que fallar siempre).

La sección 6 sostiene la regla de diseño: cuando no cabe todo se sacrifica el
TEXTO y jamás el símbolo, y el código legible no se cae nunca (y el encabezado
cae antes que el precio: en la tira de 32 × 25 el precio sobrevive). La 10 genera
los PDF de verdad de los 20 formatos × 2 simbologías; ahí se cazó que empezar en
media plancha (`desde > 1`) dejaba el documento sin ninguna página.

Las secciones **11, 12 y 20 corren contra Postgres** (PGlite) porque el SQL solo
falla al ejecutarse: la regla del nodo HOJA, la herencia de precio, el
aislamiento entre negocios, la asignación masiva de códigos —que no puede
pisar uno existente, tiene que heredar de la otra sede en vez de inventar, y
tiene que propagar—, y el plan de la pantalla (geometría sin selección, avisos
de rollo ancho y de calibración, la hoja de prueba por el endpoint y que una
petición vieja siga funcionando). Se omiten solas, con un aviso, si PGlite no
está instalado.

Las secciones **13-19** son del rediseño de sep-2026 («cualquier papel en
cualquier impresora»):

| # | Qué sostiene |
|---|---|
| 13 | Rollo de **varias columnas**: la página es UNA FILA; centrado sobre el rollo; «no caben» con las medidas; papel continuo y varias filas por página |
| 14 | Hojas a medida: cualquier papel, márgenes centrados = las referencias de papelería |
| 15 | **Giro, escala y desvío medidos sobre el PDF de verdad** (instrumentando pdfkit): en los 4 giros ninguna barra cae fuera de la página física, y una A4 girada no abre páginas de más |
| 16 | Resolución: el módulo cae en **puntos enteros** del cabezal, y el símbolo se sigue leyendo |
| 17 | La zona muda ocupa el margen interior (módulo más grande), con **techo** de 0,6 mm |
| 18 | Diseño: letra, renglones, alineación, alto del símbolo, pie (lo primero que se suelta), margen interior |
| 19 | La hoja de prueba: una página por plancha y dos por rollo, con el contorno EXACTO de cada etiqueta |

> Ojo al medir en la 15: el `_ctm` de pdfkit incluye el volteo de la página
> (espacio nativo del PDF, origen ABAJO). La prueba lo convierte a «desde
> arriba»; sin eso, un giro correcto parece invertido.

### `44-codigo-automatico.mjs` — 52 verificaciones

Todo nodo nace con su código (`utils/codigoAuto.util.js`): el producto sin
variantes con el suyo y cada talla con el propio. Un solo motor para crear
producto, crear atributo/variante, la generación masiva y la recepción de la red
interna (que solo COPIA el código de la bodega); el importador tiene su sección
en la 18.

**La sección 1 es la que hay que mirar primero**: con el código único apagado,
o con `codigo_auto = '0'`, nada cambia — ni un número gastado. La 4 y la 6
comprueban que heredar no gasta números; la 7 y la 8, que si el código heredado
está ocupado en la sede NO se inventa otro (partiría la identidad del producto)
y que la otra sede conserva el suyo — la generación masiva vieja lo pisaba. La 10
corre una recepción real de la red interna: la talla que nace en el local lleva
el código de la bodega, y si allá está ocupado nace sin código **sin que la
recepción se caiga**. La 11 renombra el contador para que falle: el producto se
crea igual. La 12 recorre todos los códigos: ninguno en dos nodos de la misma
sede, en los tres niveles. Monta los índices únicos REALES de producción (el
fixture solo traía el del producto).


### `36-ubicaciones.mjs` — 173 verificaciones

Ubicaciones como entidad: la ubicación deja de ser un `TEXT` repetido en cada
producto y pasa a ser una fila con identidad, jerarquía y geometría, a la que se
le cuelgan productos, atributos, variantes, referencias con IMEI y unidades
sueltas. Ver `migrations/20260831_ubicaciones_estructura.sql`.

Lo que de verdad vigila esta suite es lo que **no se ve fallar**:

La **sección 1** comprueba que el backfill no invente ni pierda sitios. Ahí se
cazó el primer bug real: el agrupado usaba `LOWER(BTRIM(...))`, y `BTRIM` quita
los espacios de los EXTREMOS pero no los de dentro — así que `Estante  A-3`
(dos espacios) nacía como un sitio aparte, con un nombre que la propia API es
incapaz de reproducir, porque `utils/ubicacion.util.js` sí los colapsa. Se
normaliza igual en los dos lados con `[[:space:]]`.

La **sección 2** es la que impide que una migración de datos se pelee con el
usuario: las columnas `TEXT` no se borran (son el respaldo del rollback), así
que un backfill sin guarda recrearía en cada arranque el nombre que alguien
renombró y devolvería a su sitio lo que alguien quitó a propósito.

La **sección 5** sostiene el invariante de los IMEI: si la referencia está en
Vitrina y una unidad se movió a Caja Fuerte, la vitrina tiene que dejar de
contarla. `2 en vitrina + 1 en caja = 3 disponibles` — ni se duplica ni
desaparece.

La **10** revisa el JSON real en busca de claves de costo. Este módulo no
selecciona ninguna, y por eso queda fuera del alcance de `costos_solo_admin` sin
recorte propio; el día que alguien agregue `costo_unitario` al detalle, esta
sección lo caza antes que la consola del navegador.

La **14** compara el `.sql` contra la copia inline de `src/config/migrations.js`
columna por columna e **índice por índice, expresión incluida**. No basta con
"el runner corre sin error": la normalización del nombre vive dentro de una
expresión de índice, y una copia que dijera `BTRIM` donde la otra dice
`REGEXP_REPLACE` se ve idéntica a simple vista y solo deja entrar duplicados en
producción.

La **15** cruza la frontera: los `nivel` ('producto', 'variante', 'unidad'…) y
los `estado` son dos listas mantenidas a mano, una en el backend y otra en
`frontend/src/utils/ubicaciones.js`, porque no hay import posible entre los dos
lados. Es la misma situación que ya separó las dos listas de módulos y le costó
a un usuario perder la pestaña de Bodega en silencio. También comprueba que las
rutas literales sigan declaradas **antes** de `/:id` y que no desaparezca el
`GET /` de compatibilidad del que cuelgan `InputUbicacion` y el filtro del
inventario.

La **16** es la del historial, y su primera línea es la que importa: comprueba
que **todo lo anterior funcionó sin la tabla**. El INSERT del log corre dentro
de la transacción del movimiento, así que una tabla ausente abortaría la
transacción y mover una caja de estante fallaría por culpa de su propia
bitácora. También fija que renombrar una ubicación **no reescriba el pasado**
(los nombres se congelan) y que volver a guardar algo donde ya estaba no genere
una línea — con un lector eso pasa constantemente.

La **18** cubre la pregunta inversa («¿dónde está esto?»). Lo que fija es que la
respuesta **nunca sea «no sé»**: una talla sin sitio propio hereda el del
producto y se dice que es heredado, mientras que la que sí lo tiene gana sobre
el de arriba. También que un producto con tallas activas no aparezca como tal
—lo que se va a recoger es la talla, no «la correa»— y que lo que tiene sitio se
ordene antes que lo que no.

La **19** es la ruta de recogida vista desde el backend: dónde está cada línea
de una lista que ya existe. Lo que fija es que la herencia funcione también aquí
—una talla sin sitio propio se busca donde esté su producto— y que una lista con
ids inválidos responda lo que sí sabe en vez de fallar entera: quien la manda es
el carrito del propio usuario, no un formulario.

> El **orden** del recorrido no se prueba aquí porque no se calcula aquí: lo
> arma el frontend con el árbol, y lo cubren las secciones 8 a 10 de
> `frontend/scripts/prueba-mapa-ubicaciones.mjs` (94 verificaciones en total).

La sección **18 de `18-importacion`** cubre que la columna «Ubicacion» de la
plantilla cree el sitio y le cuelgue el producto. Su primera comprobación es la
que importa: que **sin las tablas del mapa todo lo anterior funcionó igual** —
ese INSERT corre dentro de la transacción de la importación y contra una tabla
ausente perdería el archivo completo. También fija que reimportar no duplique
sitios, que un nombre repetido en dos ramas avise en vez de adivinar, y que con
`ubicacion_activa` apagada no se cree nada.


### `37-pedidos-a-bodega.mjs` — 74 verificaciones

El sentido inverso de la red interna: **el local pide → la bodega despacha (o
cierra con una razón) → el local recibe**. Ver
`migrations/20260904_pedidos_internos.sql`.

El pedido se pone **encima** de la remisión —un pedido, N remisiones—, igual que
la orden de compra se puso encima de la compra. Eso significa que casi nada de
lo que hay que probar es "¿guarda bien el pedido?", sino **que el circuito de
siempre no se enteró**.

Las **secciones 5, 6 y 7** son el corazón. El avance de un pedido no está
guardado en ninguna columna: se deriva de `lineas_remision` en cada lectura, y
estas tres hacen pasar las cuatro cosas que a una línea ya despachada le pueden
ocurrir después —**anular** la remisión, quedar **`'Faltante'`** al recibir,
quedar **`'Devuelta'`**, y subir su **`cantidad_devuelta`** al devolver parte de
un lote— comprobando que el pendiente REAPARECE solo. Con un contador guardado,
las cuatro dejarían el pedido "completo" para siempre y el local nunca volvería
a recibir lo que no llegó.

La **sección 2** lee el JSON del catálogo con una expresión regular buscando
`costo`, `valor_interno` o `precio`. Ese catálogo es el de la BODEGA, y su costo
es exactamente lo que `red_interna_ocultar_costos` y `costos_solo_admin`
esconden: aquí ni se selecciona, porque recortarlo después es lo que deja el
dato viajando y visible desde la consola del navegador. También fija que un
producto **agotado** siga apareciendo — lo que se acabó es justamente lo que hay
que pedir.

La **4** comprueba la atribución automática, y a propósito **no manda ni un
`pedido_linea_id`**: el despacho puede salir del modal del pedido, del carrito
de inventario o del escáner, y las tres tienen que unir igual. Una pantalla que
se olvidara del vínculo dejaría el pedido pidiendo para siempre algo que ya
salió. También fija que una línea a **texto libre** no se atribuya sola: nadie
sabe qué es hasta que una persona lo decide.

La **8** es la que sostiene "esto no toca la plata": la deuda del local vale
exactamente lo que valdría sin pedido — lo recibido, menos lo devuelto, sin un
peso de diferencia.

La **11** corre el flujo de siempre (despachar SIN pedido) de punta a punta. Es
el único que existe hoy en los 28 negocios y tiene que quedar idéntico: la
remisión y sus líneas con el vínculo en `NULL`, y la cuenta cerrando igual.

La **12** apaga la función (`red_interna_pedidos = '0'`) y comprueba que el
panel de las dos caras siga completo, con la bandeja de pedidos en `null` en vez
de reventar.

La **13** compara el `.sql` contra la copia inline de `src/config/migrations.js`
sentencia por sentencia, con sus `CHECK` y sus índices. El `.sql` es lo que se
lee; la copia es lo que CORRE. Escribir uno y olvidar el otro deja el despliegue
con el código nuevo contra una base vieja — ya pasó con `abonos_remision`.

> La suite corre `detectarColumnas()` de verdad antes de empezar y **aborta si
> la detección no encuentra los pedidos**. Sin esa línea, `crearRemision` e
> `insertarLineaRemision` emitirían el SQL viejo —el que no nombra las columnas
> nuevas— y la suite pasaría entera sin haber probado el vínculo.


### `40-simulacion-tesla.mjs` — 52 verificaciones

Reproduce el montaje real del negocio 33 «Tesla SmartPhone Shop» —una bodega
(BODEGA LAS AMERICAS) surtiendo a tres locales— con su misma configuración
(`variantes_activo`, `codigo_producto_activo`, `costos_solo_admin`, pedidos) y
con productos, costos y precios sacados de la plantilla que se le importó. No es
una suite de regresión de una feature: es el **día completo** del cliente,
escrito para responder dos preguntas que se hicieron en concreto.

**¿Los costos se solapan?** No, y la sección 5 lo enseña con las dos columnas al
lado. La bodega compra la correa a $3.700 y la despacha a $4.600:

- `lineas_remision.costo_origen` = **$3.700**, lo que le costó a la BODEGA. Se
  fotografía al despachar y no sale de ahí.
- `lineas_remision.valor_interno` = **$4.600**, lo que le cuesta al LOCAL, y es
  lo que la recepción escribe en `costo_unitario` de su nodo.

Los dos números viven en la **misma fila** sin pisarse, y de ahí salen dos
utilidades que tampoco se pisan: la de la bodega ($900 por unidad, sección 7) y
la del local (venta − $4.600, sección 8). La sección 8 comprueba además la cifra
que NO debe aparecer: la utilidad inflada que saldría si el local midiera contra
el costo de la bodega.

**¿Los reportes se dan bien?** La sección 6 valora cada punta con SU costo —la
bodega a $3.700, el local a $4.600, que es justo lo que ya debe— y la 7 sostiene
lo que más se malinterpreta: **la utilidad de la bodega se realiza cuando el
local PAGA, no cuando recibe**. Una remesa en tránsito reserva el envío pero no
realiza un peso.

El resto recorre el circuito entero: el catálogo que ve el local sin un solo
costo en el JSON (1), el pedido bajando a la talla y despachado con atribución
automática (2-3), la deuda naciendo en la recepción (4), la devolución
acreditada al precio de su lote (9), el gasto que no baja la deuda hasta que la
bodega lo aprueba (10), el invariante `Σ saldo de documentos = deuda_total` (11)
y el aislamiento entre locales (12-13).

Dos cosas que la suite deja fijadas y que son fáciles de leer al revés:

- **Despachar NO baja el stock** cuando `confirmar_recepcion` está activo: la
  mercancía sigue siendo de la bodega hasta que el local confirma. Descontarla
  antes la haría desaparecer de las dos puntas mientras viaja (sección 3 contra
  sección 4).
- El **caso PACHA**: `25W`/`45W SAMSUNG ORIGINAL` existen en dos líneas
  (CARGADORES y PACHAS). Como `productos_cantidad` es único por
  `(nombre, sucursal_id)`, sin el sufijo `PACHA` colapsan en un solo producto y
  —si una fila trae atributo y la otra no— `_recalcularStockProducto` borra el
  stock de la plana. La sección 1 comprueba que el local ve las dos referencias
  por separado.


### `41-prestamos-por-persona.mjs` — 39 verificaciones

`GET /api/prestamos` devolvía **siempre** el historial completo del negocio. En
Cellsite (negocio 31) eso son 9.976 filas y **13,6 MB de JSON**, y la pantalla
los volvía a pedir enteros después de **cada abono** —toda mutación invalida
`['prestamos']`— para pintar diez tarjetas de persona. Ahora el endpoint acepta
dos recortes **opcionales**: `?vista=personas` (una fila por persona, 144 KB) y
`?persona_tipo=..&persona_id=..` (los préstamos de esa persona).

La suite protege que sean **exactamente eso: recortes**.

- **La sección 1 es la que hay que mirar primero.** Sin parámetros la respuesta
  es la de siempre, y cualquier parámetro que no se entienda —texto, `0`,
  negativo, vacío— **no recorta**: cae en el historial completo. Esa es la regla
  que protege a los 28 negocios y a cualquier cliente con el bundle viejo en
  caché.
- La sección 2 compara el resumen agregado contra **la agrupación que hacía el
  navegador, copiada tal cual** desde `PrestamosPage`. Las ocho cifras de cada
  tarjeta tienen que coincidir. El caso que vigila de cerca es el préstamo con
  `estado` **NULL**: el JavaScript lo contaba como cerrado, y un `<> 'Activo'`
  en SQL lo habría perdido de los dos contadores sin que nada avisara — por eso
  el repositorio usa `IS DISTINCT FROM`.
- La sección 3 comprueba que el filtro por persona da el **mismo subconjunto, en
  el mismo orden**. De ahí salió el desempate `p.id DESC` del `ORDER BY`: los
  préstamos de un lote del carrito comparten la fecha al milisegundo y sin él
  Postgres podía barajarlos entre dos cargas de la misma pantalla.
- La sección 4 fija que **`anotarLista` no cambia de FORMA según el conjunto**.
  Era un problema latente: cuando ningún documento tenía plazo ni interés, el
  atajo devolvía menos claves (`total_a_pagar`, `solo_faltan_cargos`) y
  `saldo_capital` en 0. O sea que el mismo préstamo llegaba distinto según si
  **otro** préstamo del negocio tenía plazo — y por lo tanto según qué
  subconjunto se pidiera. Ahora el atajo se sigue saltando las dos **consultas**
  (que es el costo real) pero pasa igual por `_resolverCargos` con los
  movimientos vacíos.
- La sección 5 comprueba que el recorte va **encima** del alcance de negocio,
  nunca en su lugar: pedir a una persona de Cellsite desde otro negocio no
  devuelve nada.
- La sección 6 extrae del `.jsx` la función **real** `adaptarResumenPersonas` y
  comprueba que dé lo mismo que el SQL. Existe porque Vercel y Railway se
  despliegan por separado: hay una ventana en la que el frontend nuevo habla con
  el backend viejo, que ignora `?vista=personas` y responde el array completo.
  El frontend lo detecta **por la forma de la respuesta** y agrupa en el
  navegador, como antes. Un respaldo que se separa del original no sirve, y no se
  notaría hasta el despliegue siguiente — que es cuando ya no sirve de nada.

### `49-codigo-proveedor-etiquetas.mjs` — 80 verificaciones

Código NOMBRE-NIT-CIUDAD-consecutivo del proveedor (opt-in
`proveedor_codigo_activo`) y las etiquetas de una compra, que salen al recibir y
se reimprimen desde la compra.

| # | Propiedad |
|---|---|
| 1 | **Sin las columnas y sin la clave nada cambia**: SQL de proveedores y plano de la etiqueta idénticos |
| 2 | Las tres letras (mismo `tresLetras` del código con patrón) y lo que falta |
| 3 | Encender la feature numera a los existentes por antigüedad; sin ciudad o inactivo, no |
| 4 | Crear y completar asignan; **editar no reescribe un código impreso**; el cliente no lo puede mandar |
| 5 | El contador sigue a lo escrito a mano y es por negocio |
| 6 | Asignar pendientes a mano; apagar no borra |
| 7 | Líneas de la compra (nodo hoja, IMEI de su sede, devueltas, sin código), cantidades, permisos y el PDF real |
| 8 | Una Entrada sin proveedor gana el código al confirmarse (se lee en vivo) |
| 9 | En una etiqueta chica el proveedor es lo último que cae |
| 10 | La copia del runner y el `.sql` dicen lo mismo |
| 11 | Las cinco pantallas usan la misma regla y el mismo modal, con la configuración guardada |
