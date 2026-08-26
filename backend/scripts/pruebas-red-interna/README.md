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
