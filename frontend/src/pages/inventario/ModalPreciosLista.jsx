import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Tag, Info } from 'lucide-react';
import { getArbol } from '../../api/variantesProductoApi';
import { Modal } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { Button } from '../../components/ui/Button';
import { InputMoneda } from '../../components/ui/InputMoneda';
import { formatCOP } from '../../utils/formatters';
import { guardarPreciosNodos } from '../../api/listasPrecios.api';
import { normalizarPrecios, precioEnLista } from '../../utils/listasPrecios';

// ─────────────────────────────────────────────────────────────────────────────
// Poner los precios de un producto en cada lista.
//
// Se abre desde la tarjeta del producto porque es donde el usuario ya está
// mirando lo que quiere tarifar. Si el producto tiene variantes, salen TODAS
// las filas del árbol: el producto arriba y cada talla debajo, porque el precio
// mayorista de la 38MM puede no ser el de la 42MM.
//
// ── La herencia se explica, no se esconde ───────────────────────────────────
// Una fila vacía NO significa "sin precio": significa "hereda del nivel de
// arriba". El campo lo dice con su placeholder, y por eso la cascada está
// pintada en pantalla en vez de quedar como una regla invisible que el usuario
// descubre cuando le cobra mal a un cliente.
//
// ── Solo se manda lo que cambió ─────────────────────────────────────────────
// Un producto con 30 tallas son 90 celdas. Mandarlas todas en cada guardado
// reescribiría filas que nadie tocó — y con dos personas editando a la vez, la
// segunda pisaría el trabajo de la primera sin haberlo visto siquiera.
// ─────────────────────────────────────────────────────────────────────────────

/** Una fila editable: el nodo, su etiqueta y de quién hereda. */
const _filasDelProducto = (producto, arbol) => {
  const filas = [{
    nivel: 'producto',
    id:    producto.id,
    etiqueta: producto.nombre,
    sangria: 0,
    precios: normalizarPrecios(producto.precios),
    hereda:  null,
  }];

  for (const atributo of arbol || []) {
    filas.push({
      nivel: 'atributo',
      id:    atributo.id,
      etiqueta: atributo.tipo_nombre ? `${atributo.tipo_nombre}: ${atributo.valor}` : atributo.valor,
      sangria: 1,
      precios: normalizarPrecios(atributo.precios),
      hereda:  'producto',
    });
    for (const variante of atributo.variantes || []) {
      filas.push({
        nivel: 'variante',
        id:    variante.id,
        etiqueta: variante.tipo_nombre ? `${variante.tipo_nombre}: ${variante.valor}` : variante.valor,
        sangria: 2,
        precios: normalizarPrecios(variante.precios),
        hereda:  'atributo',
      });
    }
  }
  return filas;
};

function EditorPrecios({ producto, arbol = [], listas, tipo = 'cantidad', onCerrar }) {
  const queryClient = useQueryClient();

  // Las filas se calculan UNA vez al montar. El modal se remonta por `key`
  // desde quien lo abre, así que no hace falta —ni se debe— sincronizar esto
  // con un efecto: arrastrar los precios de un producto al siguiente sería la
  // forma más silenciosa de tarifar mal el que no se estaba mirando.
  const [filas] = useState(() => (
    tipo === 'serial'
      ? [{
          nivel: 'serial', id: producto.id, etiqueta: producto.nombre, sangria: 0,
          precios: normalizarPrecios(producto.precios), hereda: null,
        }]
      : _filasDelProducto(producto, arbol)
  ));

  // Solo lo editado: clave `${nivel}:${id}:${listaId}` → número o ''.
  const [cambios, setCambios] = useState({});
  const [error,   setError]   = useState('');

  const valorDe = (fila, listaId) => {
    const clave = `${fila.nivel}:${fila.id}:${listaId}`;
    if (clave in cambios) return cambios[clave];
    return precioEnLista(fila.precios, listaId) ?? '';
  };

  const setValor = (fila, listaId, valor) => {
    setCambios((prev) => ({ ...prev, [`${fila.nivel}:${fila.id}:${listaId}`]: valor }));
    setError('');
  };

  // Lo que se hereda hoy, para el placeholder. Se mira contra lo que está en
  // pantalla —no contra lo guardado— para que escribir un precio en el producto
  // se refleje al instante como herencia en sus tallas.
  const heredadoDe = (indice, listaId) => {
    for (let i = indice - 1; i >= 0; i--) {
      const v = valorDe(filas[i], listaId);
      if (v !== '' && Number(v) > 0) return Number(v);
    }
    return null;
  };

  const hayCambios = Object.keys(cambios).length > 0;

  const mut = useMutation({
    mutationFn: () => {
      // Un nodo por fila TOCADA, con su mapa completo: el backend reemplaza la
      // columna entera, así que hay que mandar también los precios que no se
      // editaron de esa misma fila o se borrarían.
      const tocadas = new Set(
        Object.keys(cambios).map((c) => c.split(':').slice(0, 2).join(':'))
      );
      const nodos = filas
        .filter((f) => tocadas.has(`${f.nivel}:${f.id}`))
        .map((f) => {
          const precios = {};
          for (const l of listas) {
            const v = Number(valorDe(f, l.id));
            if (Number.isFinite(v) && v > 0) precios[l.id] = Math.round(v);
          }
          return { nivel: f.nivel, id: f.id, precios };
        });
      return guardarPreciosNodos(nodos).then((r) => r.data.data);
    },
    onSuccess: (data) => {
      // Los precios viajan dentro de las listas del inventario y del árbol, así
      // que las dos tienen que refrescarse o el carrito seguiría agregando con
      // los precios viejos hasta el próximo recargue.
      queryClient.invalidateQueries({ queryKey: ['productos-cantidad'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['productos-serial'],   exact: false });
      queryClient.invalidateQueries({ queryKey: ['arbol-producto'],     exact: false });
      if (data?.no_encontrados?.length) {
        setError(`Se guardaron ${data.guardados}, pero ${data.no_encontrados.length} producto(s) ya no existen. Vuelve a abrir la pantalla.`);
        return;
      }
      onCerrar();
    },
    onError: (e) => setError(e.response?.data?.error || 'No se pudieron guardar los precios'),
  });

  return (
    <Modal open onClose={onCerrar} title="Precios por lista" size="xl">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50
          border border-gray-100 rounded-xl px-3 py-2.5">
          <Info size={14} className="flex-shrink-0 mt-0.5 text-gray-400" />
          <span>
            Deja una casilla vacía para que <b>herede</b> el precio del nivel de arriba.
            Lo que quede sin precio en ninguna lista se vende a su precio normal
            ({formatCOP(Number(producto.precio) || 0)}).
          </span>
        </div>

        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full text-sm border-separate border-spacing-y-1">
            <thead>
              <tr>
                <th className="text-left text-xs font-medium text-gray-400 pb-1 pr-3">Producto</th>
                {listas.map((l) => (
                  <th key={l.id} className="text-left text-xs font-medium text-gray-500 pb-1 px-1
                    whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      <Tag size={11} className="text-gray-300" /> {l.nombre}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((fila, i) => (
                <tr key={`${fila.nivel}-${fila.id}`}>
                  <td className="pr-3 align-middle">
                    <span
                      className={`block truncate max-w-[220px] ${fila.sangria === 0
                        ? 'text-gray-800 font-medium'
                        : 'text-gray-600'}`}
                      style={{ paddingLeft: `${fila.sangria * 14}px` }}
                      title={fila.etiqueta}
                    >
                      {fila.sangria > 0 && <span className="text-gray-300 mr-1">└</span>}
                      {fila.etiqueta}
                    </span>
                  </td>
                  {listas.map((l) => {
                    const heredado = heredadoDe(i, l.id);
                    return (
                      <td key={l.id} className="px-1 align-middle">
                        <InputMoneda
                          value={valorDe(fila, l.id)}
                          onChange={(v) => setValor(fila, l.id, v)}
                          placeholder={heredado != null ? formatCOP(heredado) : 'Sin precio'}
                          className="w-28 text-right text-sm text-gray-800 bg-white
                            border border-gray-200 rounded-lg px-2 py-1.5
                            focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onCerrar}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} loading={mut.isPending} disabled={!hayCambios}>
            Guardar precios
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// El árbol se pide AQUÍ, no en la pantalla que abre el modal.
//
// La tarjeta del inventario no lo tiene —la lista de productos no trae las
// tallas—, y pedírselo a cada pantalla que quiera abrir esto obligaría a
// repetir la consulta en todas. Se pide una sola vez, y el editor se monta
// cuando ya llegó: así sus filas se calculan con los datos completos y no hace
// falta ningún efecto que las resincronice después.
//
// El `key` es lo que hace que abrir otro producto empiece de cero. Sin él,
// React reusaría el mismo componente y arrastraría al producto siguiente los
// precios a medio escribir del anterior — que es la forma más silenciosa de
// tarifar mal algo que nadie estaba mirando.
// ─────────────────────────────────────────────────────────────────────────────
export function ModalPreciosLista({ producto, listas, tipo = 'cantidad', variantesActivo = false, sucursalId, onCerrar }) {
  const pideArbol = tipo === 'cantidad' && variantesActivo;

  const { data: arbol, isLoading, isError } = useQuery({
    queryKey: ['arbol-producto', producto.id, sucursalId],
    queryFn:  () => getArbol(producto.id, sucursalId).then((r) => r.data.data),
    enabled:  pideArbol,
  });

  if (pideArbol && isLoading) {
    return (
      <Modal open onClose={onCerrar} title="Precios por lista" size="xl">
        <div className="py-10 flex justify-center"><Spinner /></div>
      </Modal>
    );
  }

  // Sin el árbol solo se podrían tarifar las tallas a ciegas. Mejor decirlo:
  // guardar el precio del producto cuando el usuario venía a poner el de una
  // talla sería peor que no dejarlo guardar.
  if (pideArbol && isError) {
    return (
      <Modal open onClose={onCerrar} title="Precios por lista" size="xl">
        <p className="text-sm text-red-500 py-6">
          No se pudieron cargar las variantes de este producto. Vuelve a intentarlo.
        </p>
      </Modal>
    );
  }

  return (
    <EditorPrecios
      key={`${tipo}-${producto.id}`}
      producto={producto}
      arbol={arbol || []}
      listas={listas}
      tipo={tipo}
      onCerrar={onCerrar}
    />
  );
}

export default ModalPreciosLista;
