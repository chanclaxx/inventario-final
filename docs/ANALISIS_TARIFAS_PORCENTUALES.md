# Análisis de implementación — Tarifas porcentuales sobre el costo

> **Estado:** **Fase 1 implementada** (29-jul-2026), **compatible con red interna**.
> Fases 2 y 3 pendientes.
>
> Decisiones tomadas al implementar, respecto a la propuesta original:
> - Modo por defecto **recargo** (`costo × (1 + %)`), con opción de margen en Ajustes.
> - **Red interna y tarifas SÍ se combinan** — corrige lo que decía §6.5, que era
>   demasiado amplio. Ver §10.
> - El porcentaje **se oculta al rol `vendedor`** salvo que se active
>   `tarifas_ver_porcentaje`; y con `red_interna_ocultar_costos` activo queda
>   oculto **siempre**, la red manda (§6.1, §10).
> - `tarifas_activo = '1'` sin ninguna tarifa configurada cuenta como apagado.
> - Los ids de tarifa son slugs derivados del nombre, estables ante renombrados.
> - Una sola lista de tarifas por negocio (bodega y locales comparten la lista).
> **Objetivo:** que el vendedor pueda aplicar, con un toque, un porcentaje pregrabado
> sobre el costo del producto para fijar el precio de venta (ej. "Frecuente +5%",
> "Ocasional +10%"), como **feature opt-in por negocio** y **100% aditiva**.

---

## 1. Qué se pidió y cómo lo interpreto

**Pedido literal:** valores porcentuales pregrabados, calculados a partir del costo, que el
vendedor elige según la actividad y frecuencia del cliente.

**Interpretación:** se configuran N **tarifas** con nombre y porcentaje. En el momento de la
venta el vendedor elige una y el precio se recalcula desde el costo del producto. Aplica
igual a **facturas** y a **préstamos** (un préstamo es, técnicamente, una venta de producto
con pago diferido).

### 1.1 Ambigüedades que hay que cerrar antes de codificar

| # | Duda | Opciones | Mi recomendación |
|---|------|----------|------------------|
| A | ¿"5% del costo" es recargo o margen? | `precio = costo × 1,05` (recargo/markup) **vs** `precio = costo ÷ 0,95` (margen sobre venta) | **Recargo.** Es lo que describió. Guardar el modo en config por si algún día se necesita el otro. |
| B | ¿La tarifa reemplaza el precio de lista? | Reemplaza / convive | **Convive.** El `precio` del producto sigue siendo el valor por defecto; la tarifa es un botón alternativo. Nunca sobreescribir `productos_*.precio`. |
| C | ¿El vendedor puede editar el precio después de aplicar la tarifa? | Sí / no / solo hacia arriba | **Sí, libre** (fase 1). Es como funciona hoy y no rompe nada. Toggle para bloquear en fase 2. |
| D | ¿El vendedor ve el porcentaje? | Sí / solo el nombre | **Solo el nombre** para rol `vendedor`. Ver riesgo #1. |
| E | ¿Tarifa atada al cliente? | Manual siempre / cliente trae su tarifa por defecto | **Manual en fase 1.** El cliente se elige *después* del carrito, así que atarla requiere rediseñar el flujo (ver §6.9). |
| F | ¿Redondeo? | Sin redondeo / a $100 / $500 / $1.000 | **A $100 por defecto**, configurable. |
| G | ¿Bloquear venta por debajo del costo? | Bloquear / avisar / nada | **Avisar** (fase 1). Hoy el backend no valida ningún precio; bloquear sería el primer control y merece decisión aparte. |

> ⚠️ **Nota de negocio sobre (A):** con 5% de recargo, un equipo de $1.000.000 se vende a
> $1.050.000 → utilidad $50.000. Es realista para distribución mayorista de celulares, pero
> conviene confirmarlo con el cliente: si él piensa en "margen del 5%", la fórmula es otra.

---

## 2. Cómo funciona hoy el sistema

### 2.1 El precio de venta tiene un solo camino

Este es el hallazgo más importante del análisis y es lo que hace la feature barata:

```
producto/serial/variante  →  carrito (item.precio)  →  item.precioFinal (editable)
                                                              │
                                       ┌──────────────────────┴──────────────────────┐
                                       ▼                                             ▼
                          ModalFactura → POST /facturas               ModalPrestamo → POST /prestamos
                          (lineas[].precio)                           (valor_prestamo = precioFinal × cant)
```

**El carrito (`frontend/src/store/carritoStore.js`) es el único punto por el que pasa el
precio de las dos operaciones.** No hay una tercera vía. Esto significa que casi toda la
feature vive en un solo sitio.

### 2.2 De dónde sale el `precio` que entra al carrito

| Origen | Columna del precio | Archivo:línea del `agregarItem` |
|---|---|---|
| Producto por cantidad (simple) | `productos_cantidad.precio` (fallback `costo_unitario`) | `ProductosCantidad.jsx:277-288` |
| Ídem, vía escáner de código | igual | `ProductosCantidad.jsx:329-338` |
| Unidad serial (IMEI) | `seriales.precio` ?? `productos_serial.precio` | `ProductosSerial.jsx:892-906` |
| Atributo (árbol nivel 1) | `atributos_producto.precio` | `VistaArbolProducto.jsx:248-261`, `VistaVariantesProducto.jsx:400-408` |
| Variante (árbol nivel 2) | `variantes_atributo.precio` | `VistaArbolProducto.jsx:263-278`, `VistaVariantesProducto.jsx:416-426` |
| Producto con árbol, sin variantes | `productos_cantidad.precio` | `VistaArbolProducto.jsx:419-425`, `VistaVariantesProducto.jsx:617-623` |

Son **8 puntos de entrada** al carrito. Todos construyen el mismo objeto y ninguno copia el costo.

### 2.3 Qué hace el carrito

`carritoStore.js`:
- `agregarItem` → `{ ...item, precioFinal: item.precio }` (línea 13)
- `agregarOIncrementar` → igual, pero suma cantidad si ya existe (línea 19)
- `actualizarPrecio(key, precioFinal)` → edición manual (línea 36)
- Persistido en `localStorage` con clave `carrito-inventario` (línea 68)

### 2.4 Consumidores del precio

| Consumidor | Qué hace | Archivo |
|---|---|---|
| Factura | `lineas[].precio = item.precioFinal` | `ModalFactura.jsx:106-117` |
| Resumen editable de factura | `InputMoneda` sobre `precioFinal` | `ModalFactura.jsx:1153-1170` |
| Préstamo | `valor_prestamo = precioFinal × cantidad` | `ModalPrestamo.jsx:383-393` |
| Resumen editable de préstamo | `ResumenCarrito` | `ModalPrestamo.jsx:229-290` |
| Despacho red interna | **usa el costo, no el precio** (`precio_carrito` viaja solo como sugerencia) | `Carrito.jsx:86-98` |
| Traslado | no usa precio | `ModalTraslado.jsx` |

En el backend, `facturas.service.crearFactura` inserta `linea.precio` **tal cual, sin
validar nada** contra el producto (`facturas.service.js:191-201`). Lo mismo
`prestamos.repository.create`. El precio es, hoy, autoritativo desde el cliente.

### 2.5 Dónde vive el costo (crítico para esta feature)

| Tipo | Columna del costo | ¿Ya llega al frontend? |
|---|---|---|
| Cantidad simple | `productos_cantidad.costo_unitario` | ✅ sí — `productosCantidad.repository.js:8` |
| Atributo | `atributos_producto.costo_unitario` | ✅ sí — `variantes-producto.repository.js:9` |
| Variante | `variantes_atributo.costo_unitario` | ✅ sí — `variantes-producto.repository.js:22` |
| Unidad serial | `seriales.costo_compra` | ✅ sí — `getSeriales` hace `SELECT s.*` |
| Producto serial (cabecera) | ❌ **no existe** costo a nivel producto | — |

**Conclusión:** el costo ya viaja al navegador en todos los casos que importan. El cambio
estructural mínimo es **copiarlo al ítem del carrito**. No hace falta ningún endpoint nuevo.

### 2.6 El costo es información sensible (contexto existente)

El sistema ya trata el costo como dato reservado:

- `backend/src/middlewares/redInterna.middleware.js:25` → clave `red_interna_ocultar_costos`,
  **activa por defecto** (`!== '0'`).
- `backend/src/modules/red-interna/redInterna.service.js:55-65` → el recorte se hace en el
  **backend**, con el comentario explícito de que esconderlo solo en pantalla no sirve porque
  el dato viajaría igual.

Esto choca de frente con la feature nueva (ver riesgo #1) y hay que decidirlo con el cliente.

### 2.7 La configuración es clave-valor → 0 migraciones

`config_negocio(negocio_id, clave, valor)` con `ON CONFLICT ... DO UPDATE`
(`config.repository.js:37-43`). Ya hay tres features opt-in construidas exactamente así:

- `codigo_producto_activo` + validación en service
- `colores_serial_activo` + `colores_serial_lista` (JSON string)
- `caracteristicas_serial_activo` + `caracteristicas_serial_lista`
- `vendedores_activo` (leído dentro de `facturas.service.js:145-153`)

Todas siguen el patrón **"clave ausente = apagado"** (`valor === '1'`). La feature de tarifas
encaja aquí sin tocar el esquema en fase 1.

---

## 3. Diseño propuesto

### 3.1 Claves nuevas en `config_negocio` (sin migración)

| Clave | Valores | Default (ausente) |
|---|---|---|
| `tarifas_activo` | `'1'` / `'0'` | apagado |
| `tarifas_lista` | JSON string (ver abajo) | `[]` |
| `tarifas_modo` | `'markup'` / `'margen'` | `'markup'` |
| `tarifas_redondeo` | `'0'` / `'100'` / `'500'` / `'1000'` | `'100'` |
| `tarifas_default_id` | id de la tarifa preseleccionada | ninguna |
| `tarifas_ver_porcentaje` | `'1'` / `'0'` — ¿el rol vendedor ve el `%`? | `'0'` (solo nombre) |
| `tarifas_avisar_bajo_costo` | `'1'` / `'0'` | `'1'` |

```json
// tarifas_lista
[
  { "id": "t1", "nombre": "Frecuente", "porcentaje": 5,  "color": "green" },
  { "id": "t2", "nombre": "Ocasional", "porcentaje": 10, "color": "blue"  },
  { "id": "t3", "nombre": "Mostrador", "porcentaje": 20, "color": "gray"  }
]
```

`id` es un slug estable generado al crear la tarifa (no el índice del array), para que
renombrar o reordenar no rompa la trazabilidad de fase 2.

### 3.2 Fórmula

```js
// markup (recomendado)
precio = costo * (1 + p / 100)
// margen (alternativa)
precio = costo / (1 - p / 100)          // exige p < 100

// redondeo final
precio = r > 0 ? Math.round(precio / r) * r : Math.round(precio)
```

Casos que la función debe manejar sin explotar: `costo == null`, `costo <= 0`,
`p` no numérico, `p >= 100` en modo margen. En todos ellos devuelve `null` y la UI
deshabilita la tarifa con un motivo legible — nunca $0 ni `NaN`.

### 3.3 Dónde se aplica en la UI

**En el carrito**, porque es el único punto compartido por factura y préstamo:

```
┌─ Carrito ────────────────────────────────┐
│  Tarifa:  [Frecuente] [Ocasional] [Mostrador]  ← aplica a TODOS los ítems
│  ────────────────────────────────────────│
│  iPhone 13 · IMEI 3521…                  │
│     [Frecuente ▾]        $ 1.050.000     │  ← chip por ítem (caso mixto)
│  Cargador tipo C                         │
│     [Manual ▾]           $    25.000     │
└──────────────────────────────────────────┘
```

Reglas:
- Aplicar una tarifa **escribe** `precioFinal`; no lo bloquea. Sigue siendo editable.
- Si el vendedor edita a mano, el chip pasa a **"Manual"** y se olvida la tarifa.
- Si un ítem no tiene costo, su chip queda deshabilitado con tooltip
  *"Este producto no tiene costo registrado"*.
- El mismo chip se repite (solo lectura o editable, a decidir) en el resumen de
  `ModalFactura` y de `ModalPrestamo`, para corregir sin volver atrás.
- Si `tarifas_activo !== '1'`, **nada de esto se renderiza** y el carrito es idéntico a hoy.

### 3.4 Trazabilidad (fase 2, opcional)

Guardar qué tarifa se aplicó permite el reporte *"ventas por tarifa"* y auditar al vendedor:

- `lineas_factura.tarifa_id TEXT NULL`, `lineas_factura.tarifa_porcentaje NUMERIC(6,2) NULL`
- `prestamos.tarifa_id TEXT NULL`, `prestamos.tarifa_porcentaje NUMERIC(6,2) NULL`
- `clientes.tarifa_id TEXT NULL` (tarifa por defecto del cliente — fase 3)

Todas nullable, `ADD COLUMN IF NOT EXISTS`, siguiendo `backend/migrations/20260714_codigo_producto.sql`.

---

## 4. Cambios en el backend

Muy pocos: la config ya es clave-valor y el precio ya es autoritativo desde el cliente.

### Fase 1

1. **`backend/src/modules/config/config.service.js`** — añadir validación de forma para
   `tarifas_lista` antes de persistir, siguiendo el patrón de `CLAVES_A_HASHEAR`:
   - JSON parseable y array
   - máx. ~20 tarifas
   - `nombre` no vacío, `porcentaje` numérico en `[0, 1000]`, `id` único
   - rechazar con `400` si no cumple

   Es la única defensa real: hoy `saveConfig` guarda cualquier cosa y un JSON corrupto haría
   que el carrito reviente en producción.

2. **Nada más.** `config.repository.getMap` ya devuelve todas las claves no privadas.
   No hay endpoints nuevos, no hay cambios de contrato, no hay migración.

### Fase 2 (trazabilidad)

3. `backend/migrations/2026xxxx_tarifas.sql` + registro en `backend/src/config/migrations.js`
   (auto-aplicable al arrancar, idempotente).
4. `facturas.repository.insertarLinea` → dos columnas más, `|| null`.
   `facturas.service.crearFactura` (línea ~191) → pasar `linea.tarifa_id`, `linea.tarifa_porcentaje`.
5. `prestamos.repository.create` (línea ~120) → idem.
6. `reportes.service.js` → agrupación opcional por tarifa.

### Decisiones de seguridad a tomar (no código todavía)

7. ¿Se restringe la lectura de `tarifas_lista` para rol `vendedor` (devolver nombres sin `%`)?
   `config.repository.getMap` ya tiene el mecanismo (`CLAVES_PRIVADAS`), pero es binario:
   habría que devolver una versión recortada, no ocultarla entera.
8. ¿Se valida en servidor que `precio >= costo` cuando la feature está activa? Hoy no existe
   ninguna validación de precio en el backend. Fuera de fase 1.

---

## 5. Cambios en el frontend

### Archivos nuevos

| Archivo | Qué contiene |
|---|---|
| `frontend/src/utils/tarifas.js` | `parsearTarifas(config)`, `calcularPrecioTarifa(costo, tarifa, { modo, redondeo })`, `redondear()`. Puro y testeable. |
| `frontend/src/hooks/useTarifas.js` | Lee el query `['config']` ya existente y devuelve `{ activo, tarifas, modo, redondeo, defaultId, verPorcentaje }`. Devuelve `activo:false` si la clave no existe → todo lo demás se apaga solo. |
| `frontend/src/components/ui/SelectorTarifa.jsx` | Chips de selección. Recibe `tarifas`, `valor`, `onChange`, `disabled`, `motivoDisabled`. |
| `frontend/src/pages/configuracion/TarifasConfig.jsx` | CRUD de la lista en Ajustes. Copiar la estructura de `ColoresSerialConfig` (`ConfigPage.jsx:542-619`). |

### Archivos modificados

**`store/carritoStore.js`** *(el cambio de fondo)*
- `agregarItem` / `agregarOIncrementar`: conservar `costo` y sembrar `tarifa_id: null`,
  `origen_precio: 'lista'`.
- `actualizarPrecio`: marcar `origen_precio: 'manual'`, `tarifa_id: null`.
- Nuevas acciones: `aplicarTarifa(key, tarifa, opts)` y `aplicarTarifaATodos(tarifa, opts)`.
- ⚠️ **`persist`**: los carritos que ya están en `localStorage` no traen `costo`. El código
  debe tolerar `costo == null` sin calcular `NaN`. No hace falta migrar el storage ni
  versionar la clave.

**Los 8 `agregarItem` → añadir `costo`**

| Archivo:línea | Añadir |
|---|---|
| `ProductosCantidad.jsx:277-288` | `costo: Number(producto.costo_unitario) || null` |
| `ProductosCantidad.jsx:329-338` (escáner) | ídem |
| `ProductosSerial.jsx:892-906` | `costo: Number(serial.costo_compra) || null` |
| `VistaArbolProducto.jsx:248-261` | `costo: Number(atributo.costo_unitario) || null` |
| `VistaArbolProducto.jsx:263-278` | `costo: Number(variante.costo_unitario) || null` |
| `VistaArbolProducto.jsx:419-425` | `costo: Number(producto.costo_unitario) || null` |
| `VistaVariantesProducto.jsx:400-408` | atributo |
| `VistaVariantesProducto.jsx:416-426` | variante |
| `VistaVariantesProducto.jsx:617-623` | producto |

**Resto**

| Archivo | Cambio |
|---|---|
| `pages/inventario/Carrito.jsx` | Selector global + chip por ítem, tras el bloque de precio (~línea 221-230). Solo si `tarifas_activo`. |
| `pages/facturas/ModalFactura.jsx` | Chip de tarifa en el resumen de productos (~1153-1170). |
| `pages/prestamos/ModalPrestamo.jsx` | Chip en `ResumenCarrito` (229-290). |
| `pages/configuracion/ConfigPage.jsx` | Nuevo tab en `TABS_CATALOGO` (línea 38-45): `{ id: 'tarifas', label: 'Tarifas', Icn: Percent }` + render en `SeccionCatalogo` (~1348). |

Total: **4 archivos nuevos + 8 modificados**, ninguno de ellos en el backend crítico.

---

## 6. Riesgos y puntos delicados

### 6.1 🔴 El vendedor puede deducir el costo *(el riesgo principal de diseño)*

Si ve "Frecuente" y el precio $1.050.000, sabiendo que Frecuente es +5%, deduce que el costo
es $1.000.000. El sistema hoy considera el costo información reservada y lo recorta **en el
backend** para vendedores en red interna (`redInterna.service.js:55-65`), con
`ocultar_costos` activo por defecto.

**Mitigaciones posibles:**
- (a) Mostrar solo el **nombre** de la tarifa al rol `vendedor`, nunca el `%` — clave
  `tarifas_ver_porcentaje`. Reduce el riesgo pero no lo elimina (comparando dos ventas se
  despeja el %).
- (b) Asumirlo: si el dueño activa la feature, acepta que su equipo conozca los costos.
- (c) Enviar al frontend precios ya calculados por el servidor sin el `%` ni el costo —
  mucho más caro, exige endpoint nuevo y rompe el cálculo instantáneo.

**Recomiendo (a) + (b) documentado**: el toggle por defecto oculta el porcentaje, y el texto
de Ajustes advierte explícitamente que activar tarifas revela indirectamente los costos.

### 6.2 Productos sin costo

`costo_unitario` es nullable en `productos_cantidad` (`create` lo guarda como
`costo_unitario || null`). Muchos productos heredados no lo tienen. Sin costo no hay tarifa.
→ Chip deshabilitado con motivo. **Nunca calcular $0.**

### 6.3 El costo promedio se mueve solo

`calcularCostoPromedio` recalcula `costo_unitario` en cada compra y en cada retoma que
ingresa a inventario (`facturas.service.js:371-378`, `compras.service.js:198-201`). El precio
sugerido por tarifa **cambia con él**. Es el comportamiento deseado, pero el negocio debe
saber que una compra cara sube automáticamente los precios sugeridos.

✅ Lo ya facturado no cambia: `lineas_factura.precio` queda congelado.

### 6.4 En seriales el costo es por unidad

Dos equipos del mismo `productos_serial` pueden tener `costo_compra` distinto → misma tarifa,
precios distintos. Es correcto, pero visualmente confuso. El precio debe mostrarse **por ítem
del carrito**, nunca agregado por producto.

### 6.5 Red interna: la base del cálculo cambia según la sucursal

> ⚠️ **Corregido.** La primera versión de esta sección declaraba las dos features
> incompatibles. Era un diagnóstico demasiado amplio: el conflicto solo existía para
> seriales, y es resoluble. **Ya está implementado.** Ver §10.

Para un local de la red, el costo real es el `valor_interno` de la remisión, no el
`costo_compra` de la bodega.

### 6.6 Retomas que ingresan al inventario

Entran con `costo_compra = valor_retoma` (`facturas.service.js:357-362`). Aplicarles +5%
sobre lo que se reconoció en la retoma casi siempre da un precio irreal. → Advertencia
visual, no bloqueo.

### 6.7 Vista global de inventario

En la vista sin sucursal seleccionada los productos se agrupan por nombre y no tienen un
costo único (`productosCantidad.repository.js:39-74`). El escáner ya se deshabilita ahí por
la misma razón (`ProductosCantidad.jsx:314-318`). Las tarifas deben deshabilitarse igual.

### 6.8 Préstamos: `valor_prestamo` es el total, no el unitario

Documentado en `prestamos.service.js:152-159`. `buildItems` ya multiplica
(`ModalPrestamo.jsx:389`). La tarifa se aplica al **unitario** y luego se multiplica — misma
fórmula que hoy. Ojo al mostrarlo en pantalla para no confundir.

### 6.9 El cliente se elige *después* del carrito

Flujo actual: carrito → "Hacer Factura" → recién ahí se captura cédula/nombre
(`ModalFactura.jsx`). Si en el futuro la tarifa depende del cliente (fase 3), hay que decidir:
- recalcular los precios al seleccionar el cliente en el modal (puede sorprender al vendedor), o
- mover la selección de cliente antes del carrito (cambio grande de UX).

Ya existe la tabla `clientes_frecuentes(sucursal_id, cliente_id)` — insumo natural para
"qué tan frecuente es".

### 6.10 Edición posterior de facturas

`ModalEditarFactura` y `facturas.service.editarFactura` cambian precios sin pasar por el
carrito. Fase 1: esas ediciones quedan como "manual". Fase 2: **no recalcular** al editar —
una factura emitida es un documento histórico.

### 6.11 Caché de config

`/api/config` cachea 5 min en la PWA y varios componentes usan `staleTime: 5 * 60 * 1000`
(ej. `Carrito.jsx:70`). Al guardar tarifas, `ConfigPage.jsx:1447` invalida el query **en el
navegador del admin**, no en el del vendedor: este puede tardar hasta 5 minutos en verlas.
→ Documentarlo, o bajar el `staleTime` de la config de tarifas.

### 6.12 Redondeo

Sin redondeo se generan cifras feas ($1.417.483). Con $100 queda $1.417.500. Para pesos
colombianos, **$100 por defecto** y opción de $500/$1.000.

---

## 7. Checklist de aditividad — por qué no afecta a los demás negocios

- [x] **0 migraciones en fase 1.** `config_negocio` es clave-valor; un negocio que nunca abra
      la pestaña no tiene ni una fila nueva.
- [x] **Clave ausente = apagado.** `tarifas_activo !== '1'` → todos los componentes nuevos
      devuelven `null`. Mismo patrón ya probado con `codigo_producto_activo`,
      `vendedores_activo`, `colores_serial_activo`.
- [x] **El payload a `/facturas` y `/prestamos` no cambia** en fase 1. El backend no se entera
      de que la feature existe.
- [x] **Ningún endpoint nuevo, ningún cambio de contrato.**
- [x] El único cambio en código compartido es la clave `costo` en el ítem del carrito: un
      campo extra en un objeto en memoria/`localStorage` que ningún otro consumidor lee.
      `ModalTraslado` y `ModalDespachar` ignoran las claves que no conocen.
- [x] **Fase 2:** columnas todas `NULL` con `ADD COLUMN IF NOT EXISTS`, patrón de
      `20260714_codigo_producto.sql`. Un negocio sin la feature guarda `NULL` y nada cambia.
- [x] Riesgo residual: si `tarifas_lista` guarda JSON corrupto, el parseo debe caer a `[]`
      en silencio (igual que `ColoresSerialConfig`, `ConfigPage.jsx:544-547`). Cubierto por la
      validación del backend (§4.1) **y** el `try/catch` del frontend.

---

## 8. Plan por fases

### Fase 1 — Núcleo funcional *(sin tocar la base de datos)*
1. `utils/tarifas.js` + tests de la fórmula (casos borde: costo null, 0, negativo, p≥100).
2. Validación de `tarifas_lista` en `config.service.js`.
3. `TarifasConfig.jsx` + tab en Ajustes.
4. `useTarifas.js` + `SelectorTarifa.jsx`.
5. `costo` en los 8 `agregarItem`.
6. Acciones nuevas en `carritoStore`.
7. Selector en `Carrito.jsx` + chips en `ModalFactura` y `ModalPrestamo`.
8. Pruebas manuales: negocio con la feature apagada (regresión completa: vender, prestar,
   trasladar, despachar) y negocio con la feature encendida.

### Fase 2 — Trazabilidad
9. Migración aditiva `tarifa_id` / `tarifa_porcentaje` en `lineas_factura` y `prestamos`.
10. Persistir desde `facturas.service` / `prestamos.repository`.
11. Mostrar la tarifa en el detalle de factura y en el PDF.
12. Reporte "ventas por tarifa" y "margen real por tarifa".

### Fase 3 — Automatización
13. `clientes.tarifa_id` — tarifa por defecto del cliente.
14. Sugerencia automática usando `clientes_frecuentes`.
15. Tarifas distintas por línea de producto (accesorios ≠ equipos).

---

## 9. Preguntas para el cliente antes de codificar

1. ¿"5%" es **recargo sobre el costo** (costo × 1,05) o **margen sobre la venta** (costo ÷ 0,95)?
2. ¿Cuántas tarifas espera tener y con qué nombres/porcentajes reales?
3. ¿El vendedor puede modificar a mano el precio después de aplicar la tarifa?
4. ¿El vendedor debe **ver el porcentaje**, o solo el nombre de la tarifa?
   (Ver riesgo 6.1: activar esto revela los costos al equipo.)
5. ¿Redondeo a $100, $500, $1.000 o exacto?
6. ¿Las tarifas son iguales para todas las sucursales del negocio?
7. ¿Aplica también a **préstamos**? (Asumo que sí.)
8. ¿Qué debe pasar con productos que **no tienen costo registrado**?
9. ¿Este negocio usa o va a usar **red interna** (bodega → locales)? Define si hay conflicto.
10. ¿Quiere ver después un **reporte de ventas por tarifa**? (Decide si vamos a fase 2.)

---

## 10. Tarifas × Red interna (implementado)

### 10.1 El conflicto era más estrecho de lo que parecía

| Tipo | Costo que ve un local | ¿Ya era el valor interno? |
|---|---|---|
| Cantidad (simple, atributo, variante) | `productos_cantidad.costo_unitario` | ✅ **Sí** — al recibir la remisión, `recibir()` reescribe el costo del destino con el promedio ponderado sobre `valor_interno` (`redInterna.service.js:455-465`) |
| Serial | `seriales.costo_compra` | ❌ **No** — `moverSerial` solo cambia `producto_id`; `costo_compra` se conserva a propósito porque es la verdad del costo para los reportes |

Y la divergencia entre `valor_interno` y `costo_compra` es real, no teórica: la bodega puede
forzar el valor línea por línea al despachar (`_valorLinea`, expuesto en `ModalDespachar`), y
`correcciones_remision` permite corregirlo después de recibido.

### 10.2 Decisiones tomadas

| # | Decisión | Elegido |
|---|---|---|
| 1 | Base de cálculo en un local | **Valor interno de la remisión** — el porcentaje mide la ganancia real del local. Deja serial y cantidad midiendo lo mismo. |
| 2 | Visibilidad del porcentaje | **La red manda**: con `red_interna_ocultar_costos` activo (default), el vendedor ve solo el nombre de la tarifa, aunque `tarifas_ver_porcentaje` esté encendido. |
| 3 | Alcance de las tarifas | **Una sola lista por negocio.** Bodega y locales comparten las mismas tarifas. |
| 4 | Unidades propias del local | **No admiten tarifa.** El chip queda deshabilitado con el aviso “Viene de retoma o compra del local, no de bodega — pon el precio a mano”. |

### 10.3 Cómo se resuelve

`anotarConsignacionSeriales(seriales, { negocioId, sucursalId })` en
`redInterna.service.js`, invocado desde `productosSerial.service.getSeriales`:

- Devuelve la lista **sin una sola clave nueva** si: el negocio no tiene red, no hay bodega
  definida, la sucursal **es** la bodega, o la consulta falla. En todos esos casos el
  frontend cae a `costo_compra`, que es lo correcto.
- Si la sucursal es un **local**, cada serial recibe `origen_red` (`'bodega'`/`'propio'`) y
  `costo_tarifa` (el `valor_interno`, o `null` si es propia).

La consulta (`getValorConsignacionSeriales`) solo considera unidades **en consignación
viva**: línea de entrega `Recibida`, remisión no anulada, y **sin** una factura de esa
sucursal por ese IMEI posterior al despacho. Consecuencias buscadas:

- Un equipo vendido que volvió como retoma **deja de ser consignado** → precio manual.
- Si esa factura se **cancela**, vuelve a ser mercancía de bodega y recupera su valor
  interno. Se corrige solo, igual que el resto del modelo de consignación.
- El cruce `lineas_remision → seriales` va por `serial_id`, nunca por IMEI (fan-out).
  El único cruce por IMEI es contra `lineas_factura`, acotado a la sucursal destino y a
  fechas posteriores al despacho — el mismo criterio que `SQL_UNIDADES`.

### 10.4 Limitación conocida: productos por cantidad

En un local, el stock por cantidad de una referencia es **fungible**: la mercancía
consignada y la propia comparten una sola fila con un costo promedio ponderado. No es
posible separarlas, así que la decisión 4 (“las propias no admiten tarifa”) **solo aplica a
seriales**. Para cantidad, la tarifa se calcula sobre ese promedio — que es lo único que
existe, y que ya está dominado por el valor interno de las remisiones.

### 10.5 Verificación

`backend/scripts/pruebas-red-interna/08-tarifas-porcentuales.mjs` — 22 verificaciones contra
Postgres real (PGlite), incluidas la aditividad para negocios sin red y la degradación
cuando falta la bodega o la infraestructura.

---

## Anexo — Mapa rápido de archivos

**Backend**
```
src/modules/config/config.service.js            ← validación de tarifas_lista
src/modules/config/config.repository.js         ← sin cambios
src/modules/red-interna/redInterna.repository.js ← getValorConsignacionSeriales
src/modules/red-interna/redInterna.service.js    ← anotarConsignacionSeriales
src/modules/productos/productosSerial.service.js ← anota getSeriales
scripts/pruebas-red-interna/08-tarifas-porcentuales.mjs ← suite PGlite
src/config/migrations.js                        ← fase 2
src/modules/facturas/facturas.service.js:191    ← insertarLinea (fase 2)
src/modules/prestamos/prestamos.repository.js:120 ← create (fase 2)
```

**Frontend — nuevos**
```
src/utils/tarifas.js
src/hooks/useTarifas.js
src/components/ui/SelectorTarifa.jsx
src/pages/configuracion/TarifasConfig.jsx
```

**Frontend — modificados**
```
src/store/carritoStore.js
src/pages/inventario/Carrito.jsx
src/pages/inventario/ProductosCantidad.jsx      (2 sitios)
src/pages/inventario/ProductosSerial.jsx        (1 sitio)
src/pages/inventario/VistaArbolProducto.jsx     (3 sitios)
src/pages/inventario/VistaVariantesProducto.jsx (3 sitios)
src/pages/facturas/ModalFactura.jsx
src/pages/prestamos/ModalPrestamo.jsx
src/pages/configuracion/ConfigPage.jsx
```
