'use client';

import { useMemo, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Vitrina completa: cabecera, filtros, rejilla y ficha de producto.
//
// Es un componente de cliente porque la búsqueda y los filtros son interacción
// pura. Los datos ya llegan renderizados desde el servidor, así que el HTML
// inicial se ve completo aunque el JavaScript todavía no haya cargado — que es
// justo lo que hace que abra rápido en un celular con mala señal.
//
// El filtrado ocurre en memoria: el catálogo de una sucursal son cientos de
// productos, no millones. No hace falta pedirle nada más al servidor.
// ─────────────────────────────────────────────────────────────────────────────

const formatCOP = (valor) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(valor);

const normalizar = (texto) =>
  String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const IconoWhatsApp = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.5 14.4c-.3-.2-1.7-.9-2-1-.3-.1-.5-.2-.7.1-.2.3-.7 1-.9 1.2-.2.2-.3.2-.6.1-.3-.2-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.5-.5c.1-.2.2-.3.3-.5 0-.2 0-.4 0-.5 0-.2-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.7-.7 2-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3z" />
    <path d="M12 2A10 10 0 0 0 3.4 17.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2z" />
  </svg>
);

/** Enlace de WhatsApp con el producto ya mencionado en el mensaje. */
const enlaceWhatsApp = (numero, producto) => {
  if (!numero) return null;
  const texto = producto
    ? `Hola, me interesa: ${producto.nombre}`
    : 'Hola, vi su catálogo y quiero más información';
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
};

function Tarjeta({ producto, onAbrir }) {
  const portada = producto.imagenes?.[0];
  const agotado = producto.disponible === false;

  return (
    <button className="tarjeta" onClick={() => onAbrir(producto)}>
      <div className="foto">
        {portada
          ? <img src={portada.url} alt={portada.alt || producto.nombre} loading="lazy" />
          : <div className="vacia">Sin foto</div>}

        {producto.destacado && !agotado && (
          <span className="etiqueta" data-tipo="destacado">Destacado</span>
        )}
        {agotado && <span className="etiqueta" data-tipo="agotado">Agotado</span>}
      </div>

      <div className="datos">
        {producto.marca && <span className="marca">{producto.marca}</span>}
        <span className="nombre">{producto.nombre}</span>
        {producto.precio != null
          ? <span className="precio">{formatCOP(producto.precio)}</span>
          : <span className="sin-precio">Consultar precio</span>}
      </div>
    </button>
  );
}

function Ficha({ producto, whatsapp, onCerrar }) {
  const wa = enlaceWhatsApp(whatsapp, producto);

  return (
    <div className="velo" onClick={onCerrar} role="dialog" aria-modal="true">
      <div className="ficha" onClick={(e) => e.stopPropagation()}>
        <button className="cerrar" onClick={onCerrar} aria-label="Cerrar">×</button>

        <div className="galeria">
          {producto.imagenes?.length
            ? producto.imagenes.map((img, i) => (
                <img key={i} src={img.url} alt={img.alt || producto.nombre} />
              ))
            : <div className="vacia">Sin foto</div>}
        </div>

        <div className="cuerpo">
          {producto.marca && <span className="marca" style={{ fontSize: 12, color: 'var(--suave)' }}>{producto.marca}</span>}
          <h2>{producto.nombre}</h2>

          {producto.precio != null
            ? <span className="precio-grande">{formatCOP(producto.precio)}</span>
            : <span style={{ color: 'var(--suave)' }}>Consultar precio</span>}

          <div className="atributos">
            {producto.linea    && <span className="atributo">{producto.linea}</span>}
            {producto.modelo   && <span className="atributo">{producto.modelo}</span>}
            {producto.unidad   && <span className="atributo">Por {producto.unidad}</span>}
            {producto.disponible === true  && <span className="atributo">Disponible</span>}
            {producto.disponible === false && <span className="atributo">Agotado</span>}
          </div>

          {producto.descripcion && <p className="descripcion">{producto.descripcion}</p>}

          {wa && (
            <a className="boton-wa" href={wa} target="_blank" rel="noopener noreferrer">
              <IconoWhatsApp /> Preguntar por este producto
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export function Catalogo({ data }) {
  const { vitrina, lineas, productos } = data;

  const [busqueda, setBusqueda] = useState('');
  const [linea,    setLinea]    = useState('');
  const [abierto,  setAbierto]  = useState(null);

  const visibles = useMemo(() => {
    const q = normalizar(busqueda);
    return productos.filter((p) => {
      if (linea && p.linea !== linea) return false;
      if (!q) return true;
      return normalizar(`${p.nombre} ${p.marca || ''} ${p.modelo || ''} ${p.descripcion || ''}`)
        .includes(q);
    });
  }, [productos, busqueda, linea]);

  const waGeneral = enlaceWhatsApp(vitrina.whatsapp, null);

  return (
    <>
      {/* El color de la vitrina entra como variable CSS: una sola declaración
          tiñe la cabecera, los chips y los estados de foco. */}
      <style>{`:root { --marca: ${vitrina.color || '#2563eb'}; }`}</style>

      <header className="cabecera">
        <div className="contenedor">
          <h1>{vitrina.titulo}</h1>
          {vitrina.descripcion && <p>{vitrina.descripcion}</p>}
          {(vitrina.direccion || vitrina.horario) && (
            <div className="meta">
              {vitrina.direccion && <span>{vitrina.direccion}</span>}
              {vitrina.horario   && <span>{vitrina.horario}</span>}
            </div>
          )}
        </div>
      </header>

      <div className="filtros">
        <div className="contenedor">
          <div className="fila">
            <input
              className="buscador"
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={`Buscar entre ${productos.length} producto${productos.length === 1 ? '' : 's'}…`}
              aria-label="Buscar productos"
            />
          </div>

          {lineas.length > 1 && (
            <div className="lineas">
              <button className="chip" data-activo={linea === ''} onClick={() => setLinea('')}>
                Todo
              </button>
              {lineas.map((l) => (
                <button key={l} className="chip" data-activo={linea === l} onClick={() => setLinea(l)}>
                  {l}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <main className="contenedor">
        {visibles.length === 0 ? (
          <p className="vacio">
            {productos.length === 0
              ? 'Este catálogo todavía no tiene productos publicados.'
              : 'No encontramos productos con esa búsqueda.'}
          </p>
        ) : (
          <div className="rejilla">
            {visibles.map((p) => (
              <Tarjeta key={p.id} producto={p} onAbrir={setAbierto} />
            ))}
          </div>
        )}
      </main>

      <footer className="pie">
        <div className="contenedor">
          <p>{vitrina.titulo}</p>
          <p>Los precios y la disponibilidad pueden cambiar sin previo aviso.</p>
        </div>
      </footer>

      {waGeneral && !abierto && (
        <a className="wa-flotante" href={waGeneral} target="_blank"
           rel="noopener noreferrer" aria-label="Escribir por WhatsApp">
          <IconoWhatsApp size={24} />
        </a>
      )}

      {abierto && (
        <Ficha producto={abierto} whatsapp={vitrina.whatsapp} onCerrar={() => setAbierto(null)} />
      )}
    </>
  );
}
