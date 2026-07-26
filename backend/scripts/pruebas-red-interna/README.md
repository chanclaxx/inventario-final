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

node scripts/pruebas-red-interna/01-circuito-completo.mjs
node scripts/pruebas-red-interna/02-seguridad-produccion.mjs
```

Ambos salen con código 0 si todo pasa.

> Si `npm install --no-save` falla por el estado del lockfile, sirve instalar en
> una carpeta aparte y copiar `node_modules/@electric-sql/pglite` dentro de
> `backend/node_modules/`. La dependencia solo se usa para correr estas pruebas.

## Qué cubre cada una

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

## Nota sobre `esquema.sql`

Es un recorte del esquema real: solo las tablas y columnas que tocan las
consultas bajo prueba. Si en producción cambia alguna de esas columnas, hay que
reflejarlo aquí o las pruebas dejarán de representar la realidad.
