import { useState } from 'react';
import { escanearCodigo } from '../api/busqueda.api';
import useCarritoStore from '../store/carritoStore';

// ─────────────────────────────────────────────────────────────────────────────
// Escaneo hacia el carrito — un solo campo para los DOS catálogos.
//
// El lector USB/Bluetooth es un teclado: teclea la cadena y manda Enter. Lo que
// escanea puede ser el código único de un producto por cantidad (o de una de
// sus variantes) o el IMEI de un serial, y el lector no dice cuál: quien lo
// resuelve es el backend (`/busqueda/escaneo/:codigo`), en ese orden.
//
// La lógica vive aquí y no en la pantalla porque hay DOS sitios que escanean
// —el inventario y el carrito— y duplicarla significaría que un arreglo en uno
// deja el otro mintiendo.
//
// Opciones:
//   variantesActivo → con la feature encendida, el código del PRODUCTO no dice
//                     qué talla se vende: hay que abrir el árbol.
//   onProducto      → qué hacer en ese caso (el inventario abre el árbol). Sin
//                     él —el carrito no puede abrirlo— se explica y ya.
//   resolverLocal   → atajo opcional: la pantalla que ya tiene la lista en
//                     memoria resuelve el caso simple sin ir al servidor.
// ─────────────────────────────────────────────────────────────────────────────
export function useEscanerCarrito({
  variantesActivo = false,
  onProducto      = null,
  resolverLocal   = null,
} = {}) {
  const [scan,     setScan]     = useState('');
  const [scanMsg,  setScanMsg]  = useState(null); // { tipo: 'ok' | 'error', texto }
  const [buscando, setBuscando] = useState(false);

  // Del store se toman solo las acciones (identidad estable). Los ítems NO se
  // suscriben: se consultan con getState() dentro del handler, o el inventario
  // entero se re-renderizaría cada vez que cambia el carrito.
  const agregarItem         = useCarritoStore((s) => s.agregarItem);
  const agregarOIncrementar = useCarritoStore((s) => s.agregarOIncrementar);

  // ── Serial: una unidad concreta, identificada por su IMEI ────────────────
  const _agregarSerial = (serial) => {
    const etiqueta = [serial.producto_nombre, serial.imei].filter(Boolean).join(' · ');

    if (serial.prestado) {
      setScanMsg({
        tipo:  'error',
        texto: `${serial.imei} está prestado${serial.prestado_a ? ` a ${serial.prestado_a}` : ''}`,
      });
      return;
    }

    // Un serial es UNA unidad: no se incrementa, y volver a escanearlo no es un
    // error del sistema sino del mostrador — hay que decirlo.
    if (useCarritoStore.getState().items.some((i) => i.key === serial.imei)) {
      setScanMsg({ tipo: 'error', texto: `${serial.imei} ya está en el carrito` });
      return;
    }

    agregarItem({
      key:         serial.imei,
      tipo:        'serial',
      nombre:      serial.producto_nombre,
      imei:        serial.imei,
      precio:      Math.round(Number(serial.precio_serial ?? serial.precio_producto ?? 0)),
      // El costo de un serial es por UNIDAD. En un local de la red interna el
      // backend manda `costo_tarifa` con el valor interno de la remisión (o
      // null si la unidad es del local); fuera de ese caso la clave no viene y
      // se usa el costo de compra propio.
      costo:       serial.costo_tarifa !== undefined
        ? serial.costo_tarifa
        : (Number(serial.costo_compra) || null),
      motivo_sin_tarifa: serial.origen_red === 'propio'
        ? 'Viene de retoma o compra del local, no de bodega — pon el precio a mano'
        : null,
      cantidad:    1,
      serial_id:   serial.id,
      marca:       serial.marca    || null,
      modelo:      serial.modelo   || null,
      linea_id:    serial.linea_id || null,
    });

    // Apalabrado en un borrador: el modal de conflicto ya está preguntando qué
    // hacer y el ítem todavía NO entró. Decir "en el carrito" sería mentir.
    if (useCarritoStore.getState().conflicto) {
      setScanMsg(null);
      return;
    }
    setScanMsg({ tipo: 'ok', texto: `✓ ${etiqueta} — en el carrito` });
  };

  // ── Cantidad: el nodo puede ser el producto, un atributo o una variante ──
  const _agregarNodo = (nodo) => {
    // Vista global (todas las sucursales): los grupos no tienen id de producto.
    if (!nodo.id) {
      setScanMsg({ tipo: 'error', texto: 'Selecciona una sucursal para agregar con el escáner' });
      return;
    }

    // El código es de una VARIANTE: identifica exactamente qué se vende, así
    // que va derecho al carrito con la misma `key` que arma el árbol — dos
    // claves distintas guardarían dos líneas para la misma variante.
    if (nodo.atributo_id) {
      const etiqueta = [nodo.nombre, nodo.atributo_valor, nodo.variante_valor].filter(Boolean).join(' · ');
      if (!nodo.stock || Number(nodo.stock) <= 0) {
        setScanMsg({ tipo: 'error', texto: `"${etiqueta}" está sin stock` });
        return;
      }
      const res = agregarOIncrementar({
        key:            nodo.variante_id ? `cant-${nodo.id}-v-${nodo.variante_id}` : `cant-${nodo.id}-a-${nodo.atributo_id}`,
        tipo:           'cantidad',
        nombre:         nodo.nombre,
        producto_id:    nodo.id,
        atributo_id:    nodo.atributo_id,
        variante_id:    nodo.variante_id || undefined,
        atributo_label: nodo.atributo_valor || undefined,
        variante_label: nodo.variante_valor || undefined,
        precio:         Math.round(Number(nodo.precio || nodo.costo_unitario || 0)),
        costo:          Number(nodo.costo_unitario) || null,
        stock:          nodo.stock,
        cantidad:       1,
        linea_id:       nodo.linea_id || null,
      });
      if (res === 'reservado') { setScanMsg(null); return; }
      setScanMsg(res === 'sin_stock'
        ? { tipo: 'error', texto: `"${etiqueta}": ya está todo el stock en el carrito` }
        : { tipo: 'ok', texto: `✓ ${etiqueta} — en el carrito` });
      return;
    }

    // El código es del PRODUCTO. Con variantes activas no dice cuál se vende.
    if (variantesActivo) {
      if (onProducto) { setScanMsg(null); onProducto(nodo); return; }
      setScanMsg({
        tipo:  'error',
        texto: `"${nodo.nombre}" se vende por variantes: escanea el código de la talla o elígela en el inventario`,
      });
      return;
    }
    if (!nodo.stock || Number(nodo.stock) <= 0) {
      setScanMsg({ tipo: 'error', texto: `"${nodo.nombre}" está sin stock` });
      return;
    }

    const res = agregarOIncrementar({
      key:         `cant-${nodo.id}`,
      tipo:        'cantidad',
      nombre:      nodo.nombre,
      producto_id: nodo.id,
      precio:      Math.round(Number(nodo.precio || nodo.costo_unitario || 0)),
      costo:       Number(nodo.costo_unitario) || null,
      stock:       nodo.stock,
      cantidad:    1,
      linea_id:    nodo.linea_id || null,
    });
    // 'reservado' no es ni éxito ni error: el modal de conflicto ya está
    // preguntando qué hacer y el producto todavía no entró.
    if (res === 'reservado') { setScanMsg(null); return; }
    setScanMsg(res === 'sin_stock'
      ? { tipo: 'error', texto: `"${nodo.nombre}": ya está todo el stock en el carrito` }
      : { tipo: 'ok', texto: `✓ ${nodo.nombre} — en el carrito` });
  };

  const handleScan = async () => {
    const codigo = scan.trim().toUpperCase();
    if (!codigo) return;
    setScan('');
    setScanMsg(null);

    // Atajo local: la pantalla ya tiene ese producto en memoria.
    const local = resolverLocal?.(codigo) || null;
    if (local) { _agregarNodo(local); return; }

    setBuscando(true);
    try {
      const { data } = await escanearCodigo(codigo);
      const res = data?.data;
      if (res?.tipo === 'serial')  _agregarSerial(res.serial);
      else if (res?.nodos?.length) _agregarNodo(res.nodos[0]);
      else setScanMsg({ tipo: 'error', texto: `${codigo} no encontrado` });
    } catch (err) {
      // 404 es la respuesta normal a un código que no existe; cualquier otra
      // cosa es un problema de red o del servidor y no se puede rotular igual.
      setScanMsg(err.response?.status === 404
        ? { tipo: 'error', texto: `${codigo} no encontrado` }
        : { tipo: 'error', texto: 'No se pudo consultar el código, intenta de nuevo' });
    } finally {
      setBuscando(false);
    }
  };

  return { scan, setScan, scanMsg, setScanMsg, buscando, handleScan };
}
