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

> **Permisos granulares: `null` = permisos base del rol, NUNCA "no puede".** Las
> tres columnas `jsonb` de `usuarios` —`permisos_proveedores`,
> `permisos_edicion_productos` y `permisos_facturas`— comparten la misma regla, y
> es la que las hace aditivas: mientras la columna esté en NULL manda el ROL,
> exactamente como antes de que la columna existiera. Un `=== true` a secas en el
> middleware convierte el despliegue en una degradación masiva —le quitaría el
> permiso a todos los supervisores del sistema sin que nadie lo pidiera— y por eso
> `30-permisos-facturas` prueba el caso NULL antes que el caso concedido.
> `admin_negocio` nunca se lee: pasa siempre y su columna se guarda en NULL.
> Vale también para el JWT: un token emitido antes del despliegue no trae la clave
> nueva, y ausente tiene que comportarse igual que NULL o la gente pierde acceso
> durante las 8 horas que dura su access token.
>
> **Editar y cancelar facturas** (`permisos_facturas`, `requirePermisoFacturas`)
> son dos llaves independientes: editar corrige un dato, cancelar revierte
> inventario, caja y crédito. `PATCH /facturas/:id/devolucion-parcial` cuelga de
> **`puede_cancelar`**, no de `puede_editar`: quitarle líneas a una factura
> devuelve stock y baja el crédito — es una cancelación parcial, y quien solo
> corrige datos no debe poder revertir mercancía.

> **«¿Puede ver los costos?» tiene UNA sola respuesta** (`utils/costos.util.js`,
> `hooks/usePuedeVerCostos.js`): antes convivían cuatro reglas para la misma
> pregunta —`rol === 'admin_negocio'` en búsqueda y export,
> `permisos_edicion_productos.campos` en los modales, `red_interna_ocultar_costos`
> en la red interna, y **nada** en las listas de inventario, el árbol de variantes
> y la procedencia—. De ahí salían las fugas: el costo no se pintaba pero **sí
> viajaba en el JSON**, visible desde la consola del navegador.
> Es **opt-in por negocio**: `config_negocio.costos_solo_admin` ausente o `'0'`
> (el default, y lo que tienen los 28 negocios) deja **todo exactamente igual**;
> en `'1'` solo ve costos `admin_negocio`. La excepción por usuario **no es una
> columna nueva**: es el campo «Costo» de `permisos_edicion_productos.campos`, que
> ya se configura en Ajustes → Usuarios — si el negocio deja editarlo, es que
> quiere que lo vea.
> El recorte va en el **backend** (`recortarSiToca` en el controlador): quitarlo
> solo de la pantalla deja el dato viajando. Se pone a `null`, no se borra la
> clave, o las destructuraciones del frontend revientan en vez de mostrar vacío.
> **El helper solo puede QUITAR, nunca dar**: la búsqueda por IMEI y la
> exportación ya son admin-only pase lo que pase y **no** se pasaron por él —
> hacerlo, con el candado apagado, les abriría los costos a los supervisores de
> los 28 negocios de golpe. La sección 6 de la prueba lo vigila.
> El árbol de variantes es el único con costo **anidado** (las variantes van
> dentro del atributo): sin `{ anidados: ['variantes'] }` el nivel de abajo se
> escapa. Es el mismo error que ya se cometió en el código escaneable y en las
> remisiones por variante.
> **`costos_solo_admin` y `tarifas_activo` son incompatibles y `saveConfig` lo
> rechaza**: una tarifa calcula el precio de venta *desde* el costo y ese cálculo
> corre en el navegador del vendedor. Con las dos encendidas, o el vendedor se
> queda sin precio o el costo sigue viajando; las dos salidas son mentiras.
> Consecuencia menor del recorte: `precio || costo_unitario` (el fallback al
> agregar al carrito un producto **sin precio de venta**) pasa a dar 0 en vez del
> costo. Ese fallback ya contradecía la tarjeta, que mostraba $0.
> Aparte, `permisos_proveedores.ver_compras` **existía solo en el frontend**:
> `GET /api/compras` respondía el historial con precios a cualquiera con el
> módulo. Ahora lo exige `requirePermisoVerCompras`.
> La red interna también lo respeta: su `_puedeVerCostos` miraba
> `rol !== 'vendedor'`, así que a un SUPERVISOR no le escondía nada — y el
> bodeguero es supervisor. Ahora exige las DOS reglas (la de la red y el candado
> global) y sigue siendo puramente restrictiva: con el candado apagado se
> comporta igual que siempre.
> Prueba: `31-costos-solo-admin` (42 verificaciones; la sección 1 falla si
> alguien invierte el default).

> **Entradas de bodega — el bodeguero recibe sin ver ni teclear precios**
> (`compras.service.registrarEntrada`, `pages/entradas/EntradasPage.jsx`,
> `20260828_entradas_bodega.sql`): recibir mercancía y valorizarla son dos actos
> distintos, los hacen dos personas y ocurren en momentos distintos; el sistema
> los obligaba a ser el mismo formulario (`POST /compras` exige proveedor y
> precio > 0).
> **Una Entrada ES una compra**: misma fila, mismo consecutivo, misma
> `registrarCompra()`. Todo el modelo nuevo son dos columnas. Lo único que
> cambia es quién la dispara y qué ve mientras lo hace.
> **El bodeguero es un SUPERVISOR** — no hay rol ni permiso nuevo. Recibir es
> estrictamente MENOS poderoso que registrar una compra: no elige proveedor, no
> elige precios y no toca caja. Las rutas de entrada van por el módulo
> **`inventario`**, no `proveedores`: pedirle proveedores para recibir le
> abriría justo la puerta que `costos_solo_admin` cierra. Por eso también
> existe `GET /compras/entradas/ordenes`, que le da las órdenes por recibir sin
> proveedor ni precios.
> **CUIDADO — recibir en cero NO es reversible.** `editarPreciosCompra` reparte
> el delta sobre el stock ACTUAL: desde 0 da una cifra equivocada (10 uds a
> $100 + 10 que costaron $180 → da $190 donde la respuesta es $140). Por eso la
> entrada SE VALORIZA al **último costo conocido del nodo** (o al
> `precio_estimado` de la orden), que es **neutro** —mezclar unidades al mismo
> costo deja el promedio idéntico— y hace que la corrección posterior aterrice
> exacto. Es una identidad algebraica:
> `C + (R−C)·cant/(stock+cant) == (stock·C + cant·R)/(stock+cant)`.
> El costo se lee del **nodo** que recibe (variante > atributo > producto): con
> variantes activas el del producto es la suma y no dice nada de esa talla.
> **Con orden y sin orden NO son flujos distintos**: la orden es un atajo que
> llena la lista. Un solo documento, una sola pantalla, ninguna pregunta de
> "¿esto tiene pedido?". El faltante y el sobrante tampoco son otro flujo:
> escribir una cantidad distinta a la pedida ya los reporta.
> **Bodega no crea productos** (decisión del negocio: de los nombres casi
> iguales salen los duplicados que hay en producción). El backend responde
> `PRODUCTO_NO_EXISTE` con un mensaje que dice a quién pedírselo.
> `factura_confirmada` nace en **TRUE** para que ninguna compra existente
> aparezca de golpe en la bandeja de los 28 negocios.
> **La deuda con el proveedor nace al CONFIRMAR cuando la entrada llegó sin
> orden.** Sin proveedor, `registrarCompra` se salta entero el bloque del
> acreedor y no crea Cargo; y `editarPreciosCompra` solo *actualiza* el cargo
> existente (`UPDATE ... WHERE compra_id`), nunca lo crea. La mercancía entraba
> al inventario y el proveedor jamás quedaba con su cuenta por pagar. El Cargo
> se crea en `confirmarEntrada`, que es el momento en que por fin se sabe a
> quién se le debe, y el `INSERT` va ANTES de la corrección de precios para que
> `editarPreciosCompra` lo deje al día.
> **`es_entrada` es una marca explícita, no deducida**: "sin proveedor" o "no
> toca caja" también describen una compra a crédito registrada desde
> Proveedores, y esa no es una Entrada ni va en la pantalla del bodeguero.
> **`VARIANTE_REQUERIDA`**: con variantes activas el stock se mueve en la HOJA.
> Una línea de cantidad sin nodo se rechaza en vez de escribir arriba y dejar el
> producto diciendo 5 con sus tallas en 0 — el mismo error que costó corregir en
> las remisiones por variante.
> **Las rutas `/entradas`, `/entradas/ordenes` y `/por-confirmar` van ANTES de
> `/:id`**. Declaradas después, Express las resolvía por `/:id` con
> id="entradas" y el bodeguero moría en el permiso de ver compras: la entrada se
> creaba pero la lista salía vacía. El archivo ya lo advertía arriba.
> La captura (IMEI + color + características, y el reparto por variante) **se
> reusa** de `capturaMercancia.jsx`, la misma de ModalCompra y ModalRecibir;
> `MultiSelectorCompra` aprendió `mostrarCosto={false}` en vez de que naciera
> una tercera copia.
> **OJO con despachar antes de confirmar**: el valor de una línea de remisión se
> congela al despachar (`_valorLinea` toma el costo real), y corregir después el
> precio de la compra NO lo actualiza. Si la bodega despacha una entrada sin
> confirmar, el local queda debiendo el valor PROVISIONAL para siempre, salvo
> corrección manual desde Red interna → «Corregir valor de la línea».
> Prueba: `33-entradas-bodega` (32 verificaciones; la sección 1 corre la
> identidad del costo sobre las dos funciones REALES en 480 combinaciones) y
> `34-contratos-frontend`, que revisa estáticamente las pantallas.

> **El pedido baja a la VARIANTE — y lo que llega se concilia contra ella**
> (`20260905_pedido_detallado.sql`, `utils/nodoPedido.util.js`,
> `compras/correccionEntrada.js`): una orden solo podía decir «100 cargadores»,
> nunca «50 de 25W y 50 de 20W». El detalle lo decidía el bodeguero al abrir la
> caja, así que **el pedido no tenía contra qué compararse** y de ahí salían tres
> mentiras silenciosas: si el proveedor mandaba otra variante, la recepción la
> atribuía a la línea pedida y la orden se marcaba cumplida sin que nadie se
> enterara; si llegaban de más, `_validarRecepcionContraOrden` respondía 400
> mandando a «recibirlas como compra aparte» —mientras `VistaEntrada` le prometía
> al bodeguero que el sobrante «queda anotado en la entrada», o sea que una de
> las dos mentía—; y si el bodeguero se equivocaba de talla, su única salida era
> cancelar la entrada COMPLETA y reteclearla con sus treinta IMEI.
>
> **No hay modelo nuevo: había un cable suelto.** `lineas_orden_compra.variante_id`
> y `.atributo_id` existen desde 20260806 y los leían cuatro consultas; lo que
> nunca existió fue un frontend que los escribiera. `ModalOrden` ni siquiera
> podía: su clave de deduplicación era `tipo-producto_id`, así que **el mismo
> producto no cabía dos veces en una orden**. La migración no agrega una sola
> columna a `lineas_orden_compra` ni a `lineas_compra`.
>
> **Las dos nociones nuevas se DERIVAN**, como el avance de la orden y la deuda
> de la red interna: `SUSTITUCIÓN` = la línea pedida trae nodo y la recibida trae
> otro; `EXCESO` = `recibida − pedida` cuando es positivo (y `AVANCE_POR_ORDEN` ya
> lo acota con `LEAST`, así que la orden no pasa del 100 %). Guardarlas dejaría un
> contador que cancelar o devolver jamás iría a corregir. **Que el usuario lo haya
> confirmado tampoco necesita columna**: sin `sustituye` / `excedente_ok` en la
> petición el backend responde **409**, así que la sola existencia de la fila ya
> prueba que alguien dijo que sí.
> Lo que sí se escribe es la **novedad** — en `novedades_proveedor`, que ya
> existía, ya es append-only y ya cuelga del **PROVEEDOR** y no de la orden: «este
> proveedor siempre me cambia las características» es la pregunta que importa, y
> con la bitácora dentro de la orden esa historia quedaría partida en pedazos.
> Las etiquetas van **CONGELADAS** (`pedido_etiqueta`, `recibido_etiqueta`):
> con un JOIN, renombrar la talla reescribiría el pasado.
>
> **La sustitución CUMPLE la línea pedida** (el proveedor respondió) y queda
> marcada. Dejarla pendiente obligaría a cerrar a mano una orden que ya se
> atendió; si de verdad todavía hace falta el 25W, se vuelve a pedir.
>
> **`ordenes_compra_detalle_nodo` es opt-in y exige `variantes_activo`** —el mismo
> prerrequisito que los códigos del proveedor con el código interno, y por la
> misma razón: sin árbol no hay nodo que pedir. Apagado, **todo se comporta
> exactamente como hoy**, incluida la recepción repartida por variante contra una
> orden pedida al producto, que NO es una sustitución (la sección 1 de la prueba
> es la que protege a los 28 negocios). Enciende la CAPACIDAD, no la obliga: una
> misma orden mezcla líneas al nodo y líneas al producto, porque el nodo en NULL
> ya significa «el producto en general».
> Se pide la **HOJA**, igual que en el despacho de la red interna y en las
> etiquetas: un contenedor con variantes debajo se rechaza (`NODO_CONTENEDOR`)
> porque obligaría a elegir a mano al recibir, que es el trabajo que esto quita.
> Un **serial no baja a nodo**: se pide por modelo y cantidad, porque el detalle
> de cada unidad solo se conoce al abrir la caja.
>
> **CORREGIR una entrada sin rehacerla** (`PATCH /compras/entradas/:id/corregir`):
> la frontera es **`factura_confirmada = false`**, que ya existía y es exactamente
> el límite correcto — hasta ahí lo que hay es stock provisional, no precios
> reales ni deuda cerrada. Después, el camino sigue siendo la devolución o
> `editarPreciosCompra`, cada uno con su rastro en la cuenta del proveedor.
> Es del **BODEGUERO** (supervisor): es su trabajo y es su error, y exigirle que
> espere a un admin para arreglar un dedazo es la fricción que hace que la gente
> deje el inventario mal.
> Cada operación es **reversa + reaplicación en UNA transacción**, nunca un
> `UPDATE` a pelo sobre `lineas_compra`: eso cambiaría el papel y dejaría el stock
> donde estaba, que es la forma más silenciosa de descuadrar un inventario.
> **`revertirCostoPromedio` (en `costoPromedio.util`) es la clave de que sea
> seguro**: una entrada se valoriza al último costo conocido del nodo, que es
> NEUTRO, así que con `P == C` la fórmula devuelve `C` y **no toca nada**; solo
> hace trabajo real cuando la entrada vino de una orden con `precio_estimado`, y
> ahí devuelve la cifra EXACTA. Cuando no puede reconstruirla (menos stock del que
> saca, o un resultado negativo) devuelve `null` y deja el promedio: un error
> acotado es mejor que escribir basura en el costo, que contaminaría la utilidad
> de cada venta futura.
> **La bitácora (`correcciones_entrada`) va DENTRO de la transacción**, al revés
> que `movimientos_ubicacion`, y a propósito: allá el log cuelga de la operación
> diaria de un módulo en producción y por eso la bandera se consulta ANTES de
> insertar; **aquí la operación nueva es la corrección entera**, y una corrección
> sin rastro es peor que no poder corregir. Sin la tabla, `hayCorreccionesEntrada()`
> apaga el endpoint (503) y recibir sigue igual. Todo va congelado menos
> `usuario_id`, que sí se une — quién es una persona es un dato vivo.
> **Una línea ya devuelta no se corrige aquí**: tiene su nota crédito y pisarla
> contaría la baja dos veces. **Quitar todas las líneas manda a cancelar**, que es
> lo que de verdad se está haciendo y tiene su propio endpoint y su estado.
>
> **Un TERCER desenlace: llegó algo que no se pidió** (`novedades_proveedor.tipo
> = 'no_pedido'`). Se piden 50 audífonos blancos y 50 verdes, y el proveedor
> manda además 20 rosados. No es sustitución —nadie dejó de mandar lo pedido— ni
> exceso de una línea —no hay línea de rosado contra la cual excederse—: es
> mercancía adicional, y entra en **la misma entrada** como línea suelta **sin
> `orden_linea_id`**. Ese NULL es exactamente lo que significa «esto no lo
> pediste», y es lo que impide que los rosados consuman el pendiente de los
> blancos. Un tipo propio y no `'exceso'` porque «¿qué me manda este proveedor
> que yo no pedí?» y «¿de qué me manda de más?» son dos preguntas distintas y
> con un solo tipo ninguna se puede responder.
> El backend ya lo aceptaba (`_validarRecepcionContraOrden` se salta las líneas
> sin `orden_linea_id`); lo que faltaba era la pantalla y la novedad. En las dos
> pantallas de recepción el botón vive **junto a su producto**, no en el buscador
> de arriba —el bodeguero está mirando la caja de los audífonos, no buscando un
> producto nuevo— y el selector **excluye los nodos que ya están en la entrada**:
> dos líneas del mismo nodo se sumarían al recibir y nadie sabría después por qué
> el inventario subió el doble.
> **`esExtra` es una marca explícita, no se deduce de «no tiene
> `orden_linea_id`»**: en una entrada SIN pedido todas las líneas carecen de él y
> ninguna es una novedad. Mismo criterio que `es_entrada`. Y una línea extra
> **jamás manda `sustituye`**: no responde a ninguna línea del pedido, así que
> atribuirle un pendiente sería falsear el avance de la orden.
>
> **El modal de CONFIRMAR no mostraba la variante** (reportado desde producción):
> con variantes activas, administración veía dos líneas idénticas —«Audífonos ·
> 40 uds» dos veces— y no tenía forma de saber cuál era la blanca y cuál la
> verde. Como cada variante puede costar distinto, eso no es cosmético: es **no
> poder confirmar la factura**. `getLineas` ya devolvía `variante_valor` y
> `atributo_valor` desde que existen las variantes; no hubo que tocar una línea
> de SQL, solo pintarlos. De paso marca las líneas que llegaron sin estar en el
> pedido, que es justo lo que administración puede decidir no pagar.
> Prueba: `38-pedido-detallado` (128 verificaciones; la sección 1 es la que hay
> que mirar primero —nada cambia con la feature apagada—, la 9 comprueba que el
> costo promedio vuelve EXACTO al corregir un caso no neutro, la 11 corre el caso
> de los audífonos completo, y la 12 revisa estáticamente que las pantallas no
> ofrezcan nada que el backend rechace).
> De paso: el fixture de `19-ordenes-compra` no tenía `factura_confirmada` ni
> `es_entrada` desde 20260828 y la suite reventaba antes de su primera
> verificación; con esas dos columnas vuelve a correr entera (118).

> **La lista de módulos está DUPLICADA a mano** (`backend/src/config/modulos.js`
> y `MODULOS`/`PERMISOS_BASE` en `UsuariosConfig.jsx`): el frontend no puede
> importar del backend y las dos copias se separaron. Al frontend le faltaba
> `red_interna` —la pestaña **«Bodega»**— en las dos listas. No era solo que
> faltara la casilla: `handleToggle` arma el arreglo nuevo desde el
> `PERMISOS_BASE` **del frontend**, así que a un usuario con permisos base le
> bastaba con que un admin tocara CUALQUIER otro módulo para perder Bodega en
> silencio, sin forma de devolvérsela desde la pantalla. Reportado desde
> producción. Prueba: `32-modulos-sincronizados`, que lee los dos archivos y
> falla si vuelven a separarse.

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

> **Exportar inventario — la opción "Incluir características"**
> (`ModalExportarInventario`, los tres `exportarInventario*.js`): el Excel sacó
> siempre las características de un serial **solo si estaban en la lista de
> Ajustes**, así que las de una configuración anterior o las que entraron por
> importación se perdían en silencio; y la hoja "Por Cantidad" mostraba el stock
> TOTAL del producto — 30 tallas en una fila, sin decir cuántas hay de cada una,
> aunque el backend ya manda el árbol (`cantidad[].atributos`).
> La opción es **por exportación**, no una clave de `config_negocio`: no toca la
> BD y se recuerda en `localStorage`. Apagada, el archivo sale **idéntico** al de
> siempre (es la primera sección de la prueba). Encendida hace dos cosas: las
> columnas de cada hoja salen de la **unión** de la lista configurada y las
> claves que traen esas unidades —calculadas por HOJA, para que un producto no
> arrastre columnas vacías de otro—, y aparece una hoja **Características** con
> una fila por nodo HOJA del árbol (la variante si la hay, si no el atributo):
> ahí es donde vive el stock de verdad, el del producto es la suma.
> Esa hoja **no se ordena por valor**: el backend ya los devuelve por el orden
> del tipo, y reordenar alfabéticamente pondría las tallas como L, M, S, XL.
> Prueba: `frontend/scripts/prueba-export-caracteristicas.mjs` (14
> verificaciones; genera el xlsx real con ExcelJS y le lee las celdas).

> **Los NUMERIC de Postgres llegan como STRING con decimales** (`InputMoneda`):
> node-postgres no castea `numeric` a number para no perder precisión, así que
> un precio de 7.000 viaja como `"7000.00"`. `InputMoneda` limpiaba el valor con
> `replace(/\D/g,'')` —a ciegas— y eso convertía `"7000.00"` en **700000**: el
> precio ×100. No era cosmético: al tocar el campo, ese display corrupto se
> volvía el valor real y **se guardaba así**. Ahora normaliza con `Number()`
> primero y solo cae a "dígitos sueltos" cuando eso da NaN (un string ya
> formateado). Cualquier campo que reciba un numeric crudo de la API pasa por
> ahí, así que el arreglo cubre los que aún no existen.
> Su `className` **reemplaza**, no suma: un `<InputMoneda />` sin clases salía
> como input del navegador —sin borde ni padding— al lado de campos con estilo.
> Por eso hay un `CLASES_BASE` que se usa solo cuando no se pasa `className`
> (sumarlas rompería a los 55 sitios que ya mandan las suyas).

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
> **El escaneo hacia el carrito es UN solo campo** (`/busqueda/escaneo/:codigo`,
> `useEscanerCarrito`, `BarraEscaneo`): el lector es un teclado y no dice qué
> leyó, así que el backend resuelve primero el **código único** (los tres
> niveles) y solo si no existe lo prueba como **IMEI** de un serial disponible
> —exacto, nunca LIKE: un match parcial agregaría al carrito un equipo que no es
> el del mostrador—. Gana el código porque lo asignó el usuario a propósito.
> La barra vive en el inventario **y encima del carrito**; la lógica está en el
> hook porque duplicarla dejaría a uno de los dos mintiendo tras el primer
> arreglo. El serial pasa por `anotarConsignacionSeriales`, o en un local de la
> red la tarifa se calcularía sobre el costo de la BODEGA. Solo el inventario
> puede abrir el árbol cuando el código es del producto y hay variantes activas
> (`onProducto`): el carrito es una columna, no una pantalla, y lo explica en
> vez de agregar a ciegas.

> **Etiquetas imprimibles — el símbolo manda sobre el texto** (`etiquetas/`,
> `utils/code128.util.js`, `utils/qr.util.js`): el código único ya se podía
> escanear, pero no había forma de ponerlo FÍSICAMENTE sobre la mercancía. Esto
> lo imprime, en masa y de a uno, con el mismo modal (`ModalEtiquetas`): abierto
> desde una tarjeta llega con `nodoInicial` y se salta la selección; abierto
> desde la barra de Inventario empieza por elegir qué etiquetar.
> **Lo que va dentro del símbolo es el código pelado**, nunca una URL ni un JSON:
> el lector de bodega es un teclado —teclea lo que lee y pulsa Enter— y ese texto
> cae en `BarraEscaneo`, que ya lo resuelve con `GET /busqueda/escaneo/:codigo`
> contra los tres niveles del árbol y contra los IMEI. Una URL rompería ese
> camino (el lector escribiría "https://…" en el buscador) y obligaría a mantener
> una segunda vía de resolución. Con el código pelado, el lector láser sobre el
> código de barras, el lector 2D sobre el QR y la cámara de un celular acaban
> todos en el mismo sitio.
> **Se etiqueta el nodo HOJA**, igual que en el despacho de la red interna: si un
> producto tiene atributos activos, "la correa" no existe en el estante —existen
> la 38MM y la 42MM, cada una con su stock—, y el código del contenedor obliga a
> elegir a mano, que es justo el trabajo que la etiqueta viene a quitar.
> **Code 128 y QR se dibujan como VECTORES** (un rectángulo por barra, uno por
> corrida de módulos), no como imagen: un PNG reescalado a 20 mm lleva los bordes
> de las barras al píxel más cercano, y ese redondeo es justo el margen que un
> lector láser necesita para distinguir una barra fina de una gruesa. El
> codificador Code 128 está escrito a mano —cabe en un archivo, no tiene
> dependencias y, sobre todo, **se puede decodificar de vuelta en la prueba**—;
> el QR usa `qrcode-generator` (cero dependencias) solo por su matriz.
> Alterna los juegos B y C porque no es cosmético: 8 dígitos ocupan 90 módulos en
> B y 57 en C, y en una etiqueta de 38 mm eso es la diferencia entre escanear y
> no escanear. Por eso los códigos que genera la asignación masiva son
> **numéricos puros**.
> **La regla que manda: el símbolo tiene que escanear.** Cuando no cabe todo se
> sacrifica el TEXTO —precio, encabezado, variante, nombre, en ese orden— y jamás
> el símbolo; el código LEGIBLE tampoco se cae nunca, porque es la salida de
> emergencia cuando la etiqueta se raya. Todo lo sacrificado se devuelve como
> aviso. Y si la barra fina baja de 0,25 mm (0,33 en QR), la pantalla lo dice
> ANTES de imprimir — un aviso ahí ahorra la plancha entera.
> **`etiquetas.layout.js` es geometría pura y lo comparten el PDF y la vista
> previa**; la previa del modal es además el PDF DE VERDAD recortado a una página
> (`limite`), no un dibujo hecho en el navegador. Es el mismo criterio con el que
> el importador corre el importador real dentro de una transacción que hace
> ROLLBACK en vez de escribir un validador paralelo. Por lo mismo, **el catálogo
> de formatos se sirve desde el backend** (`GET /etiquetas/formatos`) en vez de
> copiarse al frontend: las dos listas de módulos duplicadas a mano ya se
> separaron una vez.
> **La generación masiva de códigos es la puerta de entrada real**: un negocio
> que acaba de encender la feature tiene cientos de nodos en NULL y nadie los va
> a escribir a mano. **Nunca pisa un código existente** —uno ya impreso está
> pegado a la mercancía y cambiarlo convierte esas etiquetas en basura
> silenciosa—, **hereda antes de inventar** y **propaga** después, con los mismos
> `heredarCodigo` / `propagarCodigo` que usan el importador y el módulo de
> variantes. El consecutivo sale de `contadores_documento` con tipo
> `'codigo_producto'` (columna TEXT libre: sin migración), reservando el bloque
> entero en un `INSERT … ON CONFLICT … RETURNING`, y se siembra con `GREATEST`
> contra el mayor código numérico que ya exista — así un negocio que importó
> códigos por fuera no recibe números repetidos. Va por tandas de 200 desde el
> frontend porque axios corta a los 30 s.
> **Este módulo no selecciona NINGÚN costo**: una etiqueta lleva precio de venta
> y nada más, así que queda fuera del alcance de `costos_solo_admin` sin
> necesitar recorte propio. Imprimir hereda el permiso de `inventario` (el
> bodeguero ya puede); **generar códigos exige `admin_negocio`**, porque asignar
> el código de un atributo uno por uno ya lo exige y en masa no puede pedir
> menos. Feature opt-in: sin `codigo_producto_activo` las rutas responden 404.
> **Ojo con los template literals**: el SQL del repositorio vive dentro de uno, y
> una comilla invertida en un comentario SQL lo cierra a media consulta — el
> backend deja de arrancar entero. Ya pasó una vez.
> Prueba: `35-etiquetas` (70 verificaciones; la sección 1 **decodifica** 974
> códigos de barras generados y los compara contra el texto original — un código
> mal generado no se ve mal, se ve perfecto y no escanea; las 11 y 12 corren el
> SQL y la asignación de códigos contra un Postgres real).

> **La UBICACIÓN es una fila, no un atributo del producto**
> (`ubicaciones/`, `20260831_ubicaciones_estructura.sql`): 20260730 la puso como
> `TEXT` libre en `productos_cantidad` y `productos_serial`, y el catálogo se
> DERIVABA de lo que los productos tuvieran escrito. Eso responde «¿en qué
> estante está esto?» pero no lo contrario, y tenía tres techos: una ubicación
> **no podía estar vacía** (existía solo mientras alguien la nombrara, así que
> no hay mapa posible — un mapa que solo dibuja lo lleno no es un mapa);
> renombrar era un `UPDATE` masivo donde un typo bifurcaba el sitio en silencio
> (el `MODE()` elegía una grafía para MOSTRAR, pero el filtro compara exacto);
> y las coordenadas, la jerarquía y el tipo no tenían dónde vivir.
> **Las columnas `TEXT` NO se borran.** Siguen ahí de respaldo, el rollback es
> apagar `ubicacion_activa`, y `listarCatalogo` hace **lectura dual**: mezcla las
> filas nuevas con el texto legado que todavía no tenga fila. Por eso
> `GET /ubicaciones` conserva su forma `[{ubicacion, productos}]` y
> `InputUbicacion`, el filtro del inventario y los Excel **siguen funcionando
> sin tocarlos**. Invertir el modelo y rediseñar las pantallas dejan de ser el
> mismo riesgo.
> **Una ubicación contiene CUALQUIER MEZCLA**: el «Cajón B7» tiene la talla 38MM
> de la correa (una variante) y los estuches (un producto entero) y un IMEI
> suelto. La puente `ubicaciones_items` son cinco FK nullable con `CHECK` de
> exactamente una — el patrón de `abonos_remision`, elegido sobre una FK
> polimórfica porque conserva las claves reales: borrar una variante borra su
> asignación sola.
> **Se asigna en CUALQUIER nivel y se resuelve HACIA ABAJO.** Aquí está la
> diferencia con las remisiones: una remisión **mueve stock** y por eso exige el
> nodo hoja (`VARIANTE_REQUERIDA`) o descuadra; la ubicación solo **describe**, y
> «toda la correa está en el Estante A» es verdad y es útil. Igual con los IMEI:
> la referencia da el valor por defecto y **cada unidad puede sobrescribirlo**
> (vitrina vs. caja fuerte). Eso hace la granularidad personalizable **sin
> ningún interruptor nuevo**.
> **CUIDADO con la consulta INVERSA**: la asignación propia gana sobre la
> heredada **en las dos direcciones**. Si la referencia está en Vitrina y un IMEI
> se movió a Caja Fuerte, listar Vitrina tiene que EXCLUIRLO o el mismo equipo
> sale en dos sitios. El stock de una referencia cuenta solo las unidades que
> **heredan** (`NOT EXISTS` asignación propia); las demás salen como su fila.
> **El stock no se reparte** (fase 1): `cantidad` nace y se queda en `NULL`.
> Repartir unidades lo volvería un derivado y obligaría a que ventas, compras,
> entradas, remisiones, ajustes, importación y traslados decidieran de qué sitio
> sale cada unidad — más un invariante que se rompe en silencio, como pasó cuando
> el stock bajó a las variantes y la red interna siguió moviendo el nivel de
> arriba. La fase 2 es **quitar los cinco índices únicos parciales**, no un
> rediseño.
> **El backfill corre UNA vez por sucursal** (la guarda es «esta sucursal aún no
> tiene ubicaciones»). Sin eso, como el texto no se borra, un negocio que
> renombre un estante vería reaparecer el nombre viejo en cada arranque y lo que
> alguien desasignó volvería solo: una migración de datos que se pelea con el
> usuario es peor que no tenerla.
> **`BTRIM` NO colapsa los espacios internos** pero `ubicacion.util.js` sí, así
> que el backfill y el índice único normalizan con
> `REGEXP_REPLACE(..., '[[:space:]]+', ' ', 'g')` — con solo `BTRIM`,
> `Estante  A-3` nacía como sitio aparte con un nombre que la API no sabe
> reproducir. Se usa la clase POSIX y no `\s` porque este SQL vive replicado
> dentro de un **template literal** de `migrations.js`, donde la barra invertida
> se pierde (y donde una comilla invertida en un comentario tumba el arranque
> entero — pasó otra vez al escribir esto).
> **No se borra una ubicación con contenido**: `ubicaciones_items` es
> `ON DELETE CASCADE`, así que un `DELETE` desasignaría todo en silencio. Baja
> lógica y `409`. Tampoco se cuelga nada de su propia hija — el ciclo colgaría
> cualquier recorrido del árbol y no es expresable como constraint.
> **Este módulo no selecciona NINGÚN costo** y por eso queda fuera de
> `costos_solo_admin` sin recorte propio, igual que las etiquetas; el precio de
> venta sí viaja. Si algún día hace falta el costo aquí, tiene que pasar por
> `recortarSiToca` **en el backend**.
> Permisos: ver el mapa y **mover** un producto van con el módulo `inventario`
> (el bodeguero es supervisor y es su trabajo; no toca stock ni caja); **crear,
> renombrar, borrar y dibujar** exigen `admin_negocio`. Y las rutas literales
> (`/arbol`, `/sin-asignar`, `/items`, `/geometria`) van **ANTES de `/:id`**.
> **La pantalla es la pestaña «Ubicaciones» del Inventario** (opt-in con
> `ubicacion_activa`), colgada ahí por la misma razón que el catálogo web:
> dónde se guarda la mercancía es una decisión sobre el inventario y hereda su
> permiso, así que no cambia el acceso de nadie. Columna izquierda el espacio
> (árbol + la bandeja **«Sin ubicar»**), derecha lo que hay dentro; en móvil se
> navega en profundidad, que es como se usa entre estantes.
> **Escanear guarda en el sitio abierto** (`BarraEscanearAqui`): reusa
> `GET /busqueda/escaneo/:codigo`, que ya resuelve los tres niveles del árbol y
> los IMEI. A diferencia del carrito, aquí **no hace falta bajar al nodo hoja**
> —la ubicación describe, no mueve stock—, así que escanear el código del
> producto y decir «toda la correa está aquí» es una respuesta válida.
> Escribir a mano lo que ya está impreso en la caja no lo hace nadie dos días
> seguidos: sin esto el mapa se desactualiza en dos semanas.
> **No hay `useEffect` que sincronice estado**: el panel y el modal se
> **remontan por `key`**. Además de que el linter lo rechaza
> (`react-hooks/set-state-in-effect`), arrastrar los marcados de un estante al
> siguiente termina moviendo cosas que nadie quiso mover.
> **El icono se saca por acceso a propiedad, nunca de una función**
> (`ICONOS_UBICACION[tipo] ?? ICONO_POR_DEFECTO`): para el linter una llamada
> durante el render puede estar creando un componente nuevo cada vez
> (`react-hooks/static-components`). Y el icono se toma con un `const` en el
> cuerpo, no destructurando el parámetro del `map`: no hay
> `eslint-plugin-react`, así que el uso en JSX **no cuenta como referencia** y
> solo los `const` en mayúscula entran en `varsIgnorePattern`.
> El tope de lista (`TOPE_LISTA`) vive en el util porque la pestaña y el panel
> **comparten la queryKey** de «sin ubicar» —para que el contador no cueste una
> petición extra—: con límites distintos el contador diría 200 o 500 según cuál
> se montara primero.
> **El MAPA es una VISTA, no el modelo** (`MapaUbicaciones.jsx`): pestaña Mapa
> junto a Lista, sobre los mismos datos. Todo lo del mapa se puede hacer en la
> lista, que es la que funciona en un celular de 5" entre estantes, la que se
> navega con teclado y la que sirve aunque nadie haya dibujado nada. **El mapa
> nunca es requisito.**
> **La cámara, no un modal**: al tocar una ubicación el nivel actual se agranda
> hasta que esa caja llena la pantalla y entonces aparece lo de dentro — el
> rectángulo que tocaste crece hacia ti, así que no se pierde el hilo de dónde
> estás. Se anima con la **Web Animations API**, no con un efecto: `animate()`
> devuelve una promesa y el cambio de nivel se encadena desde el propio clic;
> con `useEffect` haría falta sincronizar estado en el efecto (cascada de
> renders, y el linter lo rechaza). `prefers-reduced-motion` corta la
> interpolación — un zoom a pantalla completa marea de verdad a parte de la
> gente. Y hay migas de pan permanentes: una animación dice cómo llegaste, no
> dónde estás.
> **Se dibuja SOLO el nivel actual.** Renderizar los cuatro a escala real haría
> que un bin dentro de un estante dentro de una bodega fuera una mota de tres
> píxeles. Un nivel del árbol = un nivel de zoom, así que agregar «Nivel 2»
> dentro de «Estante 1» no toca nada del mapa.
> **La geometría es OPCIONAL y en unidades relativas 0..1000**, nunca píxeles:
> cada ubicación es el lienzo de sus hijas. Lo que nadie ha colocado se acomoda
> solo en cuadrícula (raya discontinua) y **nunca pisa lo dibujado a mano** — se
> salta la casilla cuyo centro caiga dentro de un rectángulo ya puesto. Eso es
> lo que permite empezar hoy y dibujar el mapa el mes que viene.
> **Mirando, el encuadre se ajusta al contenido; editando, se ve el lienzo
> entero**: si el encuadre siguiera al contenido mientras se arrastra, mover una
> caja movería los límites y el mapa se escaparía debajo del dedo.
> La cámara **escala por `min`, no por `max`**: con `max` una caja alargada se
> sale por los lados justo al terminar la animación (600×120 en un lienzo de
> 1000 se iría de −2000 a 3000). Por eso la aritmética vive en
> `utils/ubicaciones.js` y no en el componente — un signo al revés no se ve
> leyendo el código, se ve como «la animación hace algo raro» en producción.
> Editar el mapa es un **modo aparte** (`admin_negocio`): mirando, un clic
> entra; editando, un clic arrastra. Fundirlos hace que el bodeguero mueva un
> estante sin querer. Se guarda **al soltar** y en lote, nunca por píxel.
> Prueba: `36-ubicaciones` (102 verificaciones; la 5 sostiene el invariante de
> los IMEI, la 10 revisa el JSON en busca de fugas de costo, la 14 compara el
> `.sql` contra la copia del runner **índice por índice, expresión incluida**, y
> la 15 vigila que el vocabulario de `nivel` y de `estado` no se separe entre
> backend y frontend — que es lo que ya pasó con las dos listas de módulos).
> La geometría del mapa se prueba aparte, en node puro:
> `frontend/scripts/prueba-mapa-ubicaciones.mjs` (74 verificaciones; comprueba
> que las cajas automáticas **no se encimen** ni entre ellas ni sobre las
> dibujadas, y que la cámara centre y **encuadre completa** cualquier caja).
>
> **Historial de movimientos** (`movimientos_ubicacion`,
> `20260901_movimientos_ubicacion.sql`): `ubicaciones_items` decía quién tocó
> por ÚLTIMA vez, no de dónde venía. En una bodega con tres personas esa es la
> pregunta que aparece cuando algo no está donde debería.
> **Registrar es un extra; mover es la operación diaria.** El INSERT del log
> corre DENTRO de la transacción del movimiento, así que si la tabla faltara
> abortaría la transacción entera y **mover una caja fallaría por culpa de su
> propia bitácora**. Por eso tiene bandera PROPIA (`hayMovimientosUbicacion`) y
> se consulta ANTES del INSERT en vez de envolverlo en try/catch: en una
> transacción abortada, atrapar el error no salva lo que viene después. Y por
> eso no entra en `TABLAS_UBICACIONES` — un despliegue donde solo fallara esta
> migración apagaría el módulo entero, que ya estaba operando.
> **Los nombres van CONGELADOS** (`etiqueta`, `desde_nombre`, `hacia_nombre`),
> por dos razones distintas: pintarlo con ids costaría un UNION de cinco ramas
> más dos JOIN en cada carga, y **`NULL` en `desde_id` es ambiguo** entre «venía
> de ningún sitio» y «esa ubicación ya no existe». Con el nombre al lado, la
> línea sigue contando la verdad aunque después renombren el estante — con un
> JOIN, renombrar reescribiría el pasado. Mismo criterio que
> `lineas_remision.costo_origen`. `usuario_nombre` **sí** se une, y a propósito:
> quién es una persona es un dato vivo.
> El origen sale del `DELETE ... RETURNING ubicacion_id` que ya hacía la
> asignación: preguntarlo aparte costaría una consulta y abriría una ventana
> entre leer y escribir. Y **volver a guardar algo donde ya estaba no se
> registra** — con un lector se escanea dos veces la misma caja constantemente,
> y esas líneas taparían las que sí cuentan.
> El filtro por ubicación mira los **dos extremos**: un estante tiene dos
> historias, lo que entró y lo que salió, y filtrar solo por destino escondería
> justo lo que alguien busca.
>
> **«¿Dónde está esto?» — la pregunta inversa** (`buscarNodos`,
> `GET /ubicaciones/buscar`): el módulo se construyó para responder «¿qué hay en
> este estante?», pero en una bodega grande la que más se hace es la contraria,
> y no tenía respuesta desde esta pantalla. Devuelve nodos **HOJA** (lo que de
> verdad se va a recoger) con la ubicación **ya resuelta hacia arriba**: si la
> talla no tiene sitio propio pero su producto sí, responde el del producto y lo
> marca `heredada`. **La respuesta nunca es «no sé».**
> Las **unidades sueltas** solo salen si su IMEI coincide o si tienen sitio
> propio: listar los 300 equipos de una referencia al buscar su nombre
> enterraría el resultado que se busca. Lo que **sí** tiene sitio se ordena
> primero — quien pregunta «¿dónde está?» quiere una respuesta, no una lista de
> cosas que tampoco están ubicadas. Mínimo **2 caracteres**: con una letra la
> respuesta es media bodega y le cuesta una pasada a una base compartida.
> El **nombre y la ruta de la ubicación NO se resuelven en SQL**: la pantalla ya
> tiene el árbol en memoria y los saca de ahí con `rutaDe`. Un `WITH RECURSIVE`
> por fila para pintar migas de pan sería justo la consulta correlacionada que ya
> se comió el 96 % del CPU de esta base una vez.
> **La IMPORTACIÓN crea las ubicaciones y asigna el producto**
> (`_asignadorDeUbicaciones` en `importacion.service.js`): la columna
> «Ubicacion» de la plantilla existía desde 20260730 pero solo escribía el
> TEXTO. Con el modelo invertido eso dejaba a los 400 productos importados
> **fuera del mapa** —el texto estaba, el sitio no existía— y había que crearlos
> y asignarlos uno por uno, justo el trabajo que la importación viene a quitar.
> **Se busca en TODA la sucursal antes de crear**, no solo en la raíz: si ya
> existe «Estante 1» dentro de «Bodega A», el Excel que lo nombra tiene que caer
> ahí y no fabricar un duplicado suelto. Si el nombre está repetido en dos ramas
> (legítimo), **no se adivina**: el texto se escribe pero no se asigna, y se
> reporta como **aviso** (`UBICACION_AMBIGUA`) — la fila entra, así que no es
> conflicto. Lo nuevo nace en la RAÍZ porque la plantilla no puede expresar
> jerarquía; moverlo después a su bodega no desasigna nada.
> El caché es **por importación**: la columna repite el mismo estante en cientos
> de filas y no puede costar cientos de consultas. Y **no se registra en
> `movimientos_ubicacion`** a propósito: 400 líneas de importación taparían los
> movimientos de personas, que es lo que ese historial existe para contar.
> Sin las tablas del mapa (`hayUbicaciones()` en falso) el importador escribe el
> texto y **nada más** — el INSERT corre dentro de su transacción y contra una
> tabla ausente perdería el archivo entero. La sección 18 de `18-importacion`
> empieza comprobando justo eso.
> **`padreId` (el nivel de la cámara) vive en `TabUbicaciones`, no en el mapa**:
> el buscador tiene que poder llevar el mapa hasta un estante concreto. Con el
> estado dentro del mapa haría falta un efecto que lo sincronizara desde fuera.
> Y aterriza en el nivel del **PADRE** con la caja marcada, no dentro: entrar ya
> escondería el contexto que se busca («está en el Estante 1, que está en la
> Bodega A»).
>
> **La RUTA DE RECOGIDA cuelga del CARRITO** (`ModalRutaRecogida`,
> `POST /ubicaciones/ruta`, `agruparPorRuta`): en una bodega grande, juntar ocho
> productos en el orden en que se escribieron significa cruzarla ocho veces.
> Se engancha al carrito y **no a una pantalla propia** porque el carrito ya es
> la lista compartida del sistema —lo llenan ventas, préstamos y traslados—: una
> lista aparte obligaría a teclear otra vez lo que ya está escrito, y entonces
> nadie la usaría. Por lo mismo no se colgó de la red interna, que es opt-in.
> `nodoDeItemCarrito` es el **contrato entre los dos mundos** y vive en el util:
> el carrito lo llenan nueve pantallas y ninguna sabe de ubicaciones. Baja
> siempre al nodo **más específico** que traiga la línea (variante > atributo >
> producto), así que la ruta lleva al cajón de esa talla y no al del producto.
> Los ítems viejos de `localStorage` sin ids devuelven `null` y se quedan fuera
> en vez de reventar la pantalla.
> El **orden lo calcula el frontend**, no el SQL: recorrido en profundidad (se
> termina una bodega antes de pasar a la siguiente) y, dentro de un nivel,
> arriba-abajo e izquierda-derecha **solo si están dibujadas TODAS** — con la
> mitad colocada a mano y la mitad automática, ordenar por posición sería un
> zigzag sin sentido, así que se cae al orden del árbol, que el admin controla.
> **Lo que no tiene ubicación va al FINAL, en su propia parada**: es lo que hay
> que buscar a ojo y enterrarlo entre lo demás haría perder justo lo que más
> tiempo cuesta.
> El endpoint va por **POST** aunque sea una lectura: un carrito de treinta
> líneas no cabe con holgura en una URL y el navegador la corta sin avisar. Y
> resuelve **una consulta por NIVEL presente**, no una por línea.
> Prueba: la 19 de `36-ubicaciones` (backend, con la herencia y el aislamiento)
> y las secciones 8-10 de `prueba-mapa-ubicaciones.mjs` (el orden del recorrido
> y la traducción desde el carrito).


> **La línea de entrega por CANTIDAD es un LOTE — FIFO por nodo**
> (`20260823_lotes_cantidad.sql`, `repo.consumirLotesFIFO`): un SERIAL tiene
> identidad y por eso todo es exacto — `serial_id` une la entrega con la
> devolución y marcar esa línea `'Devuelta'` saca su valor del cargo. La
> mercancía por CANTIDAD **no tiene identidad**, y el sistema lo resolvía con
> agregados por PRODUCTO y promedios ponderados. Tres defectos, los tres
> silenciosos y los tres sobre dinero: devolver una talla que la bodega **nunca
> envió** bajaba la deuda (el producto tenía pendientes en otra talla); se
> acreditaba el promedio de todos los envíos, un precio que no era el de ninguna
> unidad real; y lo reclamable de cada línea se medía contra el stock completo,
> así que con dos envíos de la misma talla se podía reclamar **el doble** de lo
> que había.
> Ahora cada línea de entrega es un **lote** (cantidad + su valor propio) y
> `cantidad_devuelta` es el equivalente fungible del `'Devuelta'`: devolver
> consume lotes **del más viejo al más nuevo** y el cargo de cada envío baja solo
> por lo que salió de él y **a su precio**. **Sin contra-asiento** — un `Ajuste`
> además sería cobrárselo dos veces al revés, igual que con un serial. Lo que no
> calce contra ningún lote es del local: no se acredita salvo que la bodega
> decida comprárselo (`genera_saldo_favor`), y ahí sí va como saldo a favor
> porque no hay cargo que bajar.
> `reclamable` de una línea = su pendiente, acotado al stock del nodo **menos lo
> que los lotes más viejos ya comprometen** — sin ese tercer tope vuelve el
> sobre-reclamo.
> Prueba: `26-lotes-cantidad` (16 verificaciones; la sección 4 es la que hay que
> vigilar: devolver más de lo que queda en un lote cruza al siguiente y cobra
> cada tramo a su propio precio).

> **El reclamo por faltante también cubre la mercancía por CANTIDAD**
> (`getLineasDetalladas.reclamable`, `ModalReportarFaltante`): `estado_unidad`
> solo existe para SERIALES — el motor de estados sigue unidad por unidad
> (vendida, prestada, dónde está hoy) y eso no se puede hacer con mercancía
> fungible. La pantalla de reclamo filtraba por `tipo === 'serial'`, así que las
> líneas de cantidad no eran ni candidatas ni bloqueadas: **desaparecían**, y un
> negocio con el catálogo por variantes no podía reclamar nada. Encima el mensaje
> de vacío afirmaba «todo ya se vendió» sin haber mirado si había algo vendido.
> Ahora una línea de cantidad se reclama **por unidades**: `reclamable` = lo que
> entregó la línea acotado a lo que el local todavía tiene **de ese nodo** (un
> reclamo saca del local unidades que nunca llegaron; si ya las vendió, no hay
> nada que sacar). El stock se mira en la talla, no en el producto: el del
> producto es la suma de todas y no dice nada de esta.
> El circuito no cambia — sigue siendo el de la devolución, la línea queda
> `'Devuelta'` y el «nunca llegó» vive en `remisiones.motivo` — y la deuda del
> local **no baja hasta que la bodega confirma**.
> Prueba: `25-reclamo-faltante` (18 verificaciones; las secciones 5 y 6 son las
> que sostienen el mensaje: lo vendido queda bloqueado con motivo, y solo cuando
> de verdad no queda nada la pantalla dice que todo se vendió).

> **La línea de remisión mueve un NODO, no un producto**
> (`20260823_remision_variantes.sql`, `redInterna.service._resolverNodoOrigen`):
> la red interna se escribió cuando el stock de un producto por cantidad vivía en
> `productos_cantidad.stock`. La feature «Variantes» lo bajó a
> `atributos_producto` / `variantes_atributo` y convirtió el del producto en un
> **derivado**; la red interna no se enteró y siguió moviendo el nivel de arriba.
> En un catálogo por variantes eso hacía cuatro daños **silenciosos**: no se
> podía decir qué talla se despachaba; tras recibir, el producto decía 5 y sus
> variantes sumaban 0; el valor interno se escribía como costo del producto y no
> de la variante, así que la tarifa del local se quedaba sin base; y el primer
> ajuste sobre CUALQUIER variante disparaba `sincronizarStockProducto`, que
> recalcula producto = Σ variantes y **borraba lo recibido** mientras el local lo
> seguía debiendo.
> **La regla: el stock se mueve siempre en la HOJA (variante > atributo >
> producto) y el producto se recalcula después.** Si el producto tiene variantes
> activas, la línea está obligada a decir cuál (`VARIANTE_REQUERIDA`) — antes se
> aceptaba en silencio y de ahí salía todo el descuadre.
> La línea guarda el nodo de origen y el de destino; entre sedes la identidad es
> el **valor** («38MM»), nunca el id, y `_resolverNodoDestino` lo crea si falta.
> El buscador del despacho y el escaneo por código devuelven **nodos**: cada rama
> excluye a los que tienen hijos activos, porque un contenedor no es despachable.
> El historial de stock ya tenía `atributo_id`/`variante_id` —los ajustes
> normales los llenaban— y el traslado no: ahí se cortaba el rastro.
> Es el mismo error que tuvo el código escaneable, en el mismo sitio y por la
> misma razón: algo que vivía en el producto tuvo que bajar a los tres niveles.
> Prueba: `24-remision-por-variante` (24 verificaciones, día completo: despacho →
> recepción → tarifa → ajuste → devolución, con el invariante
> `producto = Σ variantes` comprobado en las dos sedes en cada paso).

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
> **Las DOS utilidades de la misma operación** (`utils/costoRed.util.js`,
> `reportes.getVentasALocales`): la bodega compra barato y le despacha caro al
> local; el local vuelve a vender. Son dos márgenes y hay que reportar los dos.
> El del LOCAL ya salía bien en ventas; faltaban tres cosas y ya están:
> **(1)** `getValorInventario` valoraba su vitrina al costo de la BODEGA —
> subvaluando justo lo que ya debe— y de paso listaba como «sin costo» las
> unidades consignadas cuya bodega nunca registró el suyo, invitando a
> «corregirlas»; **(2)** ese arreglo escribía en `seriales.costo_compra`, o sea
> pisaba la verdad del negocio **sin mover una cifra de lo que el local ve**
> (sus reportes ya usan el valor interno), así que el usuario creía que no se
> guardaba y lo repetía: hoy responde **409 `COSTO_DE_BODEGA`** y manda a
> corregir el valor de la LÍNEA, que tiene su circuito; **(3)** el `costo_compra`
> de la bodega solo viaja al `admin_negocio` (`_recortarCostos` en el export;
> `buscarPorIMEI` ya lo hacía) — para los demás, como mucho, el valor interno, y
> ni eso con `red_interna_ocultar_costos`.
> El de la BODEGA no existía en ningún reporte: despachar es venderle al local
> pero no hay factura, así que su inventario salía y su utilidad no subía. Sale
> como grupo propio en la pestaña **Ventas** (`red_interna`, arriba de
> préstamos), **nunca sumado a `resumen`**:
> son ventas sin factura y el total dejaría de cuadrar con la lista de arriba.
> Cuenta lo mismo que le genera cargo al local —líneas `'Recibida'` menos lo
> devuelto, la misma expresión de `SQL_CARGO_ENVIO`, o la bodega reportaría una
> venta que el local no debe— con fecha de **recepción**, que es cuando nace la
> deuda. El costo de un serial se lee **en vivo** de `costo_compra` (así una
> corrección se refleja sola); el de cantidad **se congela** en
> `lineas_remision.costo_origen` al despachar (20260824), porque el promedio
> ponderado del nodo se mueve con la siguiente compra y después no hay cómo
> reconstruirlo. Los totales se arman **por línea, no por envío**: descartar un
> envío entero porque una línea no tiene costo botaría la utilidad de las demás.
> **La utilidad de la bodega se realiza cuando el local PAGA, no cuando
> recibe** — es una venta a crédito y se mide con la misma fórmula que un
> crédito a un cliente (`utilidad = MAX(0, cobrado − costo)`: lo que entra cubre
> primero el costo y solo el excedente es ganancia). Un envío entregado y no
> pagado no le ha dejado un peso: contarlo sería reportar plata que está en la
> calle. Por eso el resumen trae **dos** cifras, `utilidad_realizada` y
> `utilidad_pendiente`, y cada envío se puede abrir para ver el desglose por
> producto (qué costó, a cuánto se le pasó al local, cuánto deja).
> `SQL_ABONOS_EFECTIVOS` se **importa** de `redInterna.repository`, no se copia:
> una remesa en tránsito reserva el envío pero no lo paga, y dos definiciones
> separadas acabarían diciendo que la bodega cobró algo que el local no ha
> pagado. Todo se refresca solo — el `MutationCache` global de `main.jsx`
> invalida `ventas-rango` tras cualquier mutación, incluidos los pagos que se
> registran desde las pantallas de Red interna.
> Prueba: `27-costo-y-utilidad-bodega` (42 verificaciones; la sección 9 recorre
> el envío desde sin pagar hasta saldado, y la 10 comprueba que una remesa en
> tránsito no realiza utilidad).

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

> **El local PIDE a la bodega — el sentido inverso** (`redInterna.pedidos.*`,
> `20260904_pedidos_internos.sql`): el circuito nació en una sola dirección —la
> bodega decide qué mandar, despacha, y el local confirma—, y eso funciona
> mientras alguien en la bodega sepa qué le falta a cada local, que es justo lo
> que deja de ser cierto con más de dos. Ahora: **el local pide → la bodega
> despacha (o cierra con una razón) → el local recibe**.
> **El pedido se pone ENCIMA de la remisión: un pedido, N remisiones.** Es la
> misma decisión que tomó `ordenes_compra` frente a `compras` y por la misma
> razón: `despachar()` YA emite el documento, resuelve el nodo y la referencia
> de destino, valoriza, bloquea los $0 y sabe anularse; `recibir()` YA mueve el
> inventario y genera la deuda. Un segundo circuito de mercancía sería una
> segunda verdad sobre el stock. Despacho parcial = N despachos contra un
> pedido, sin una línea nueva de lógica de inventario ni de cuenta.
> **El avance se DERIVA, nunca se guarda** (`AVANCE_POR_LINEA`): a una línea
> despachada le pueden pasar cuatro cosas —anular la remisión, quedar
> `'Faltante'` al recibir, quedar `'Devuelta'`, o subir su `cantidad_devuelta`—
> y ninguna iría a corregir un contador. Guardado, el pedido se quedaría
> "completo" para siempre y nunca volvería a pedir lo que no llegó. Por eso
> `pedidos_internos.estado` solo guarda DECISIONES humanas (Borrador / Enviado /
> Cerrado / Anulado) y Pendiente/Parcial/Despachado se calculan al leer — y por
> eso la bandeja de la bodega se vacía sola y se vuelve a llenar sola.
> Ojo con las tres trampas del `LEFT JOIN` que ya costaron en `ordenes_compra`:
> las condiciones van en el JOIN (en el WHERE lo vuelven INNER y desaparecen las
> líneas sin despachar), pero un JOIN que no empareja **no descarta** la fila —
> por eso el `FILTER (WHERE r.id IS NOT NULL)`, y sobre `r.id`, no sobre el
> estado.
> **La atribución la hace el BACKEND**, no la pantalla: el despacho puede salir
> del modal del pedido, del carrito o del escáner, y las tres tienen que unir
> igual. Cascada: `pedido_linea_id` explícito → mismo NODO exacto → mismo
> PRODUCTO cuando el pedido no bajó a la talla (pidieron "la correa", sale la
> 38MM, y eso es la respuesta correcta). El texto libre **no se atribuye solo**.
> **Un VENDEDOR puede pedir**: recibir una remisión ya lo puede hacer y recibir
> GENERA la deuda; pedir no compromete un peso y no pasa nada hasta que la
> bodega despacha. Exigir supervisor para pedir y no para recibir sería exigir
> más para lo que menos pesa. Cerrar y reabrir sí son de la bodega.
> **No se exige la variante**, al revés que una remisión: esa mueve stock
> (`VARIANTE_REQUERIDA`) y un pedido solo DESCRIBE — es el mismo criterio de la
> ubicación. Y el **pedido a texto libre** (`producto_id NULL`) existe porque un
> local pide cosas que la bodega todavía no tiene en catálogo; sin esa puerta el
> pedido solo serviría para reponer, que es la mitad del problema.
> **El catálogo que ve el local NO trae costos**, y no por recorte: el SQL ni
> los selecciona (`_sqlNodosCantidad({ conCosto: false })`). Tampoco exige stock
> —lo que se acabó es justamente lo que hay que pedir—. La plantilla se comparte
> con `buscarCantidadDisponible` en vez de copiarse.
> **`red_interna_pedidos` ausente = ENCENDIDO**, al revés que casi todo: la red
> interna ya es opt-in, así que quien llegó aquí la activó a mano, y pedir no
> compromete nada. El interruptor es para la bodega que no quiere que le pidan.
> **La detección va en `columnas.js`, no en `_hayInfra`**: la feature agrega dos
> columnas (`remisiones.pedido_id`, `lineas_remision.pedido_linea_id`) que
> escribe CADA despacho. Si la migración fallara y el repositorio ya las
> nombrara, no se caería una pantalla nueva sino DESPACHAR, la operación diaria
> de un módulo que ya está en producción — por eso `crearRemision` e
> `insertarLineaRemision` las interpolan solo si existen, y por eso la bandera
> es la misma que abre las rutas (dos detecciones separadas podrían discrepar y
> se aceptaría un pedido que ningún despacho podría responder).
> La `respuesta` al cerrar no es decorativa: sin ella, cerrar se ve desde el
> local exactamente igual que ignorarlo, y vuelve a pedir lo mismo. El local
> puede **anular** solo mientras nada haya salido; con mercancía despachada el
> backend responde `PEDIDO_CON_ENVIOS` y manda a pedirle a la bodega que lo
> cierre — anularlo dejaría una remisión viva colgando de un documento anulado.
> Los avisos salen de `redInterna.avisos.js`, extraído del service para que los
> pedidos no tuvieran que importarlo entero y quedaran los dos en ciclo.
> Prueba: `37-pedidos-a-bodega` (74 verificaciones; las secciones 5, 6 y 7 hacen
> pasar las cuatro cosas que reabren el pendiente, la 2 revisa el JSON del
> catálogo en busca de fugas de costo, y la 11 comprueba que despachar SIN
> pedido —el único flujo que existe hoy en los 28 negocios— no cambió).

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
