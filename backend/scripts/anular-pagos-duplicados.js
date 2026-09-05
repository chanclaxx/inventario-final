/**
 * Anula los PAGOS TOTALES que entraron dos (o tres) veces por un doble clic.
 *
 * EL PROBLEMA
 * Hasta el arreglo de septiembre, el botón "Registrar pago total" no se
 * deshabilitaba mientras la petición viajaba, y la baranda del backend miraba
 * desde FUERA de la transacción: no veía al hermano sin commitear. Resultado:
 * el mismo pago se repartía dos o tres veces y al cliente se le borraba deuda
 * que sí debe. El caso grande es FACTURA JUANSHOP, con tres pagos de
 * $100.000.000 en 2,8 segundos el 29-ago-2026.
 *
 * CÓMO SE IDENTIFICA UN DUPLICADO — y por qué NO por el tiempo
 * Dos pagos del mismo valor separados por segundos pueden ser reales: un
 * mayorista que abona $2.000.000 dos veces seguidas existe, y de hecho hay 67
 * parejas así en la base. Lo que no puede pasar es que los DOS hayan repartido
 * exactamente lo mismo sobre exactamente los mismos préstamos: el primero ya
 * habría bajado esos saldos, así que el segundo tendría que haber caído en
 * otros. Reparto idéntico = el formulario se envió dos veces.
 *
 * Por eso el criterio es el REPARTO, no el gap. Con la ventana sola (90 s) se
 * marcarían pagos legítimos, y con un gap más corto se escaparía el par de JUAN
 * DUQUE, cuyo id mayor tiene la fecha ANTERIOR por 4 milésimas.
 *
 * QUÉ HACE
 * De cada grupo de pagos idénticos conserva el PRIMERO y anula los demás, por
 * el mismo camino que usa la pantalla (`prestamos.anularAbonoTotal`): marca los
 * abonos con su motivo, baja `total_abonado`, reabre el préstamo si dejó de
 * estar cubierto, cancela la factura que se hubiera generado y devuelve el
 * equipo a inventario. No se borra nada: la fila queda en el estado de cuenta
 * explicando por qué la cuenta cambió.
 *
 * OJO: ANULAR SUBE LA DEUDA DEL CLIENTE. Es la deuda correcta —esa plata nunca
 * entró— pero es una conversación comercial. Por eso el script SIMULA por
 * defecto.
 *
 * A QUIÉN SE LE TOCA — decisión del negocio, sep-2026
 * Solo a las personas cuyo ESTADO DE CUENTA no cuadra con la deuda de la
 * tarjeta. A quien le cuadran las dos cifras se le deja como está, aunque tenga
 * un duplicado vivo: ahí la plata de más cayó entera sobre saldos que sí se
 * debían, las dos cifras bajaron juntas y la cuenta es consistente. Corregirlo
 * le subiría la deuda a un cliente sin que ningún número en pantalla estuviera
 * en conflicto, y eso es una conversación comercial, no un arreglo técnico.
 * `--todos` levanta ese filtro; sin la bandera, el filtro manda.
 *
 *   node scripts/anular-pagos-duplicados.js                  # simula
 *   node scripts/anular-pagos-duplicados.js --todos          # incluye a los que cuadran
 *   node scripts/anular-pagos-duplicados.js --aplicar
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');
const prestamos = require('../src/modules/prestamos/prestamos.service');

const APLICAR = process.argv.includes('--aplicar');
const TODOS   = process.argv.includes('--todos');
const DESDE   = (process.argv.find((a) => a.startsWith('--desde=')) || '').split('=')[1] || null;
const MOTIVO  = 'el mismo pago se registró dos veces por un doble clic';

const cop = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');

/** Pagos totales del mismo valor y método sobre la misma persona, en media hora. */
const SQL_CANDIDATOS = `
  SELECT a.id AS a, b.id AS b, a.tipo_persona, a.persona_id, a.valor_total::numeric AS valor,
         LEAST(a.fecha, b.fecha) AS fecha, su.negocio_id,
         COALESCE(pr.nombre, cl.nombre) AS persona
    FROM abonos_totales a
    JOIN abonos_totales b
      ON b.tipo_persona = a.tipo_persona AND b.persona_id = a.persona_id AND b.id > a.id
     AND b.valor_total = a.valor_total
     AND COALESCE(b.metodo, '') = COALESCE(a.metodo, '')
     -- En ABSOLUTO: dos inserciones concurrentes pueden recibir los ids en un
     -- orden y las marcas de tiempo en el otro (pasó con el par 2143/2144).
     AND ABS(EXTRACT(EPOCH FROM (b.fecha - a.fecha))) <= 1800
    JOIN sucursales su ON su.id = a.sucursal_id
    LEFT JOIN prestatarios pr ON pr.id = a.persona_id AND a.tipo_persona = 'prestatario'
    LEFT JOIN clientes     cl ON cl.id = a.persona_id AND a.tipo_persona = 'cliente'
   WHERE COALESCE(a.destino, 'prestamo') = 'prestamo'
     AND ($1::date IS NULL OR LEAST(a.fecha, b.fecha) >= $1::date)
   ORDER BY LEAST(a.fecha, b.fecha), a.id`;

/**
 * Las DOS cifras de una persona, calculadas como las calcula la pantalla:
 * la tarjeta suma solo los ACTIVOS; el extracto es el saldo corrido del último
 * movimiento que cuenta. Un préstamo sobrepagado sale de la primera (pasa a
 * Saldado) pero sigue restando en la segunda: ahí está el desfase.
 */
const dosCifras = async (negocioId, tipo, personaId) => {
  const col = tipo === 'cliente' ? 'cliente_id' : 'prestatario_id';
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(valor_prestamo - total_abonado), 0)::numeric d
       FROM prestamos WHERE ${col} = $1 AND estado = 'Activo'`, [personaId]);
  const movs = await prestamos.getEstadoCuenta(negocioId, tipo, personaId, null);
  const con  = movs.filter((m) => m.saldo !== null);
  return {
    deuda:    Number(rows[0].d),
    extracto: con.length ? Number(con[con.length - 1].saldo) : 0,
  };
};

/** La huella del reparto: qué préstamos tocó y con cuánto. */
const repartoDe = async (abonoTotalId) => {
  const { rows } = await pool.query(
    `SELECT prestamo_id, valor::numeric AS valor FROM abonos_prestamo
      WHERE abono_total_id = $1 ORDER BY prestamo_id`, [abonoTotalId]);
  return rows.map((r) => `${r.prestamo_id}:${Math.round(Number(r.valor))}`).join(',');
};

(async () => {
  const { rows: pares } = await pool.query(SQL_CANDIDATOS, [DESDE]);

  // Un pago que aparece con varios hermanos (el triple de JUANSHOP) se agrupa
  // por su huella de reparto: el grupo entero es UN solo pago repetido N veces.
  const grupos = new Map();
  for (const par of pares) {
    const [ra, rb] = [await repartoDe(par.a), await repartoDe(par.b)];
    if (!ra || ra !== rb) continue;              // repartos distintos = pagos reales
    const clave = `${par.tipo_persona}:${par.persona_id}:${par.valor}:${ra}`;
    if (!grupos.has(clave)) {
      grupos.set(clave, { ...par, ids: new Set([Number(par.a)]), lineas: ra.split(',').length });
    }
    grupos.get(clave).ids.add(Number(par.b));
  }

  if (!grupos.size) {
    console.log('No hay pagos totales duplicados con este criterio.');
    await pool.end();
    return;
  }

  console.log(`\n${APLICAR ? '⚠  APLICANDO' : '◦ SIMULACIÓN (usa --aplicar para escribir)'}`);
  console.log(`${DESDE ? `Desde ${DESDE}` : 'Toda la historia'}`);
  console.log(TODOS
    ? 'Incluyendo a las personas cuyas dos cifras ya cuadran (--todos)\n'
    : 'Solo las personas cuyo extracto NO cuadra con la deuda de la tarjeta\n');
  console.log('fecha         persona                    valor c/u  veces  de más          extracto vs deuda      a anular');
  console.log('─'.repeat(118));

  let totalDeMas = 0;
  const aAnular = [], omitidos = [];
  for (const g of [...grupos.values()].sort((x, y) => new Date(x.fecha) - new Date(y.fecha))) {
    const ids    = [...g.ids].sort((a, b) => a - b);
    const extras = ids.slice(1);                  // se conserva el primero

    // Solo cuenta lo que de verdad sigue vivo: parte de agosto ya se corrigió.
    const { rows: [viv] } = await pool.query(
      `SELECT COALESCE(SUM(valor - COALESCE(valor_anulado, 0)), 0)::numeric AS vivo
         FROM abonos_prestamo WHERE abono_total_id = ANY($1::int[])`, [extras]);
    const vivo = Number(viv.vivo);
    if (vivo <= 0) continue;                      // ya estaba anulado

    const { deuda, extracto } = await dosCifras(g.negocio_id, g.tipo_persona, g.persona_id);
    const desfase = Math.round(extracto - deuda);
    const cuadra  = desfase === 0;

    const fila =
      `${String(g.fecha).slice(4, 15).padEnd(13)} ` +
      `${String(g.persona || '?').slice(0, 24).padEnd(24)} ${cop(g.valor).padStart(14)}  ` +
      `${String(ids.length).padStart(4)}  ${cop(vivo).padStart(14)}   ` +
      `${(cuadra ? 'cuadra' : cop(desfase)).padStart(17)}   `;

    if (cuadra && !TODOS) {
      omitidos.push({ ...g, vivo });
      console.log(`${fila}—  se deja como está`);
      continue;
    }
    totalDeMas += vivo;
    aAnular.push({ ...g, extras, vivo, desfase });
    console.log(`${fila}#${extras.join(', #')}`);
  }

  console.log('─'.repeat(118));
  console.log(`${aAnular.length} pagos a anular · ${cop(totalDeMas)} acreditados de más`);
  if (omitidos.length) {
    console.log(`${omitidos.length} se dejan intactos (sus dos cifras ya cuadran): `
      + omitidos.map((o) => o.persona).join(', '));
  }
  console.log('');

  if (!aAnular.length) {
    console.log('Nada que hacer.');
    await pool.end();
    return;
  }

  if (!APLICAR) {
    console.log('Nada se escribió. Para aplicarlo:');
    console.log('  node scripts/anular-pagos-duplicados.js --aplicar'
      + (DESDE ? ` --desde=${DESDE}` : ''));
    await pool.end();
    return;
  }

  // Respaldo de las filas que se van a tocar, ANTES de tocarlas. La anulación
  // no borra nada, pero deshacerla a mano sin saber cómo estaban los estados y
  // los `total_abonado` originales sería adivinar.
  const idsExtras = aAnular.flatMap((g) => g.extras);
  const respaldo = {
    fecha: new Date().toISOString(),
    motivo: MOTIVO,
    pagos_totales: idsExtras,
    abonos: (await pool.query(
      `SELECT * FROM abonos_prestamo WHERE abono_total_id = ANY($1::int[])`, [idsExtras])).rows,
    prestamos: (await pool.query(
      `SELECT id, numero, valor_prestamo, total_abonado, estado, imei, sucursal_id
         FROM prestamos WHERE id IN (
           SELECT DISTINCT prestamo_id FROM abonos_prestamo WHERE abono_total_id = ANY($1::int[]))`,
      [idsExtras])).rows,
  };
  const archivo = path.join(__dirname, `respaldo-anulacion-${Date.now()}.json`);
  fs.writeFileSync(archivo, JSON.stringify(respaldo, null, 1));
  console.log(`Respaldo escrito en ${archivo}`);
  console.log(`  ${respaldo.abonos.length} abonos y ${respaldo.prestamos.length} préstamos\n`);

  console.log('Anulando…\n');
  let anulados = 0, reabiertos = 0, errores = 0;
  for (const g of aAnular) {
    for (const id of g.extras) {
      try {
        const r = await prestamos.anularAbonoTotal(g.negocio_id, id, {
          motivo: MOTIVO, usuario_id: null, sucursal_id: null,
        });
        anulados++;
        reabiertos += r.reabiertos;
        console.log(`  ✓ pago #${id} (${g.persona}): ${cop(r.valor)} en ${r.pedazos} abonos`
          + (r.reabiertos ? `, ${r.reabiertos} préstamos reabiertos` : ''));
      } catch (e) {
        errores++;
        console.log(`  ✗ pago #${id} (${g.persona}): ${e.message || e}`);
      }
    }
  }

  console.log(`\n${anulados} pagos anulados · ${reabiertos} préstamos reabiertos`
    + (errores ? ` · ${errores} con error` : ''));
  await pool.end();
})().catch((e) => { console.error('ERROR:', e.stack || e.message); process.exit(1); });
