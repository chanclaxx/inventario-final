'use client';

import { useMemo, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Vitrina pública — estilo editorial minimalista, adaptado de Template.html.
//
// Se conserva la identidad del diseño de referencia: Montserrat, fondo gris muy
// claro, acento turquesa, tarjetas numeradas, barras verticales laterales y el
// indicador de páginas arriba a la derecha.
//
// Lo que cambia respecto al template estático:
//   · Los productos vienen del inventario real, no de un array quemado.
//   · La navegación son las LÍNEAS del negocio, no enlaces fijos.
//   · El buscador y el indicador de páginas funcionan de verdad.
//   · Funciona en celular (el template original era solo de escritorio).
//
// Es un componente de cliente porque buscar, filtrar y paginar es interacción
// pura. Los datos ya llegan renderizados desde el servidor, así que el HTML
// inicial se ve completo aunque el JavaScript no haya cargado todavía.
// ─────────────────────────────────────────────────────────────────────────────

const POR_PAGINA = 8;   // dos filas de cuatro en escritorio

const formatCOP = (valor) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(valor);

const normalizar = (texto) =>
  String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const dosDigitos = (n) => String(n).padStart(2, '0');

// ── Iconografía, en SVG inline ──────────────────────────────────────────────
// El template traía FontAwesome por CDN solo para los iconos sociales. Se
// reemplaza por SVG inline: una petición externa menos y nada que pueda fallar.

const LogoHexagono = () => (
  <svg viewBox="0 0 100 100" aria-hidden="true">
    <polygon points="50,5 95,27.5 95,72.5 50,95 5,72.5 5,27.5" fill="none" stroke="#111" strokeWidth="5" />
    <polygon points="50,20 80,35 80,65 50,80 20,65 20,35" fill="none" stroke="#111" strokeWidth="3" />
    <polygon points="50,40 68,70 32,70" fill="var(--accent-color)" />
  </svg>
);

const IconoWhatsApp = ({ size = 18 }) => (
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

/** Formato legible del número guardado en E.164 (57 + 10 dígitos). */
const mostrarTelefono = (numero) => {
  if (!numero) return null;
  const n = String(numero);
  return n.startsWith('57') && n.length === 12
    ? `+57 ${n.slice(2, 5)} ${n.slice(5, 8)} ${n.slice(8)}`
    : `+${n}`;
};

// ── Tarjeta ─────────────────────────────────────────────────────────────────
function Tarjeta({ producto, numero, onAbrir }) {
  const portada = producto.imagenes?.[0];
  const agotado = producto.disponible === false;

  return (
    <button className="product-card" onClick={() => onAbrir(producto)}>
      <div className="image-container">
        <span className="card-number">{dosDigitos(numero)}</span>

        {producto.destacado && !agotado && (
          <span className="card-badge" data-tipo="destacado">Destacado</span>
        )}
        {agotado && <span className="card-badge" data-tipo="agotado">Agotado</span>}

        {portada
          ? <img src={portada.url} alt={portada.alt || producto.nombre} loading="lazy" />
          : <div className="sin-foto">Sin foto</div>}
      </div>

      <div className="product-info">
        {producto.marca && <span className="marca">{producto.marca}</span>}
        <h3>{producto.nombre}</h3>

        {producto.precio != null
          ? <span className="precio">{formatCOP(producto.precio)}</span>
          : <span className="sin-precio">Consultar precio</span>}

        {producto.descripcion && <p className="desc">{producto.descripcion}</p>}

        <span className="link-btn">
          <span className="play-arrow" />
          ver más
        </span>
      </div>
    </button>
  );
}

// ── Ficha ───────────────────────────────────────────────────────────────────
function Ficha({ producto, whatsapp, onCerrar }) {
  const wa = enlaceWhatsApp(whatsapp, producto);

  return (
    <div className="velo" onClick={onCerrar} role="dialog" aria-modal="true">
      <div className="ficha" onClick={(e) => e.stopPropagation()}>
        <button className="cerrar" onClick={onCerrar} aria-label="Cerrar">×</button>

        <div className="ficha-cuerpo">
          <div className="galeria">
            {producto.imagenes?.length
              ? producto.imagenes.map((img, i) => (
                  <img key={i} src={img.url} alt={img.alt || producto.nombre} />
                ))
              : <div className="sin-foto">Sin foto</div>}
          </div>

          <div className="ficha-datos">
            {producto.marca && <span className="marca">{producto.marca}</span>}
            <h2>{producto.nombre}</h2>

            {producto.precio != null
              ? <span className="precio-grande">{formatCOP(producto.precio)}</span>
              : <span className="sin-precio">Consultar precio</span>}

            <div className="atributos">
              {producto.linea  && <span className="atributo">{producto.linea}</span>}
              {producto.modelo && <span className="atributo">{producto.modelo}</span>}
              {producto.unidad && <span className="atributo">Por {producto.unidad}</span>}
              {producto.disponible === true  && <span className="atributo">Disponible</span>}
              {producto.disponible === false && (
                <span className="atributo" data-estado="agotado">Agotado</span>
              )}
            </div>

            {producto.descripcion && <p className="descripcion">{producto.descripcion}</p>}

            {wa && (
              <a className="boton-wa" href={wa} target="_blank" rel="noopener noreferrer">
                <IconoWhatsApp size={16} /> Preguntar por este producto
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Vitrina ─────────────────────────────────────────────────────────────────
export function Catalogo({ data }) {
  const { vitrina, lineas, productos } = data;

  const [busqueda, setBusqueda] = useState('');
  const [linea,    setLinea]    = useState('');
  const [pagina,   setPagina]   = useState(0);
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

  const totalPaginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA));
  // La página se acota en el render en vez de reiniciarse con un efecto: al
  // filtrar, la lista se encoge y la página actual puede quedar fuera de rango.
  const paginaActual = Math.min(pagina, totalPaginas - 1);
  const enPantalla   = visibles.slice(paginaActual * POR_PAGINA, (paginaActual + 1) * POR_PAGINA);

  const cambiarFiltro = (accion) => { accion(); setPagina(0); };

  const waGeneral = enlaceWhatsApp(vitrina.whatsapp, null);
  const telefono  = mostrarTelefono(vitrina.whatsapp);

  return (
    <>
      {/* El color elegido por el negocio en Ajustes reemplaza al turquesa del
          diseño original. Una sola variable tiñe el logo, los subrayados de la
          navegación, las flechas y el indicador de página. */}
      {vitrina.color && (
        <style>{`:root { --accent-color: ${vitrina.color}; }`}</style>
      )}

      <div className="app-container">
        <span className="left-vertical-text">
          {vitrina.whatsapp ? 'Escríbenos por WhatsApp' : vitrina.titulo}
        </span>

        <main className="main-content">

          {/* ── HEADER ── */}
          <header>
            <div className="brand">
              <div className="logo-icon"><LogoHexagono /></div>
              <span className="brand-name">{vitrina.titulo}</span>
            </div>

            <div className="nav-container">
              <nav>
                <button
                  data-active={linea === ''}
                  onClick={() => cambiarFiltro(() => setLinea(''))}
                >
                  Todo
                </button>
                {lineas.map((l) => (
                  <button
                    key={l}
                    data-active={linea === l}
                    onClick={() => cambiarFiltro(() => setLinea(l))}
                  >
                    {l}
                  </button>
                ))}
              </nav>

              <div className="search-box">
                <input
                  type="search"
                  value={busqueda}
                  onChange={(e) => cambiarFiltro(() => setBusqueda(e.target.value))}
                  placeholder="Buscar en el catálogo"
                  aria-label="Buscar productos"
                />
              </div>
            </div>
          </header>

          {/* ── HERO ── */}
          <section className="hero-section">
            <div className="hero-title-container">
              <h1 className="hero-title">{linea || 'Catálogo'}</h1>

              <div className="hero-description">
                <p>
                  {vitrina.descripcion
                    || `${visibles.length} producto${visibles.length === 1 ? '' : 's'} disponibles. `
                       + 'Escríbenos y te damos toda la información que necesites.'}
                </p>

                {(vitrina.direccion || vitrina.horario) && (
                  <div className="hero-meta">
                    {vitrina.direccion && <span>{vitrina.direccion}</span>}
                    {vitrina.horario   && <span>{vitrina.horario}</span>}
                  </div>
                )}

                {waGeneral && (
                  <a className="link-btn" href={waGeneral} target="_blank" rel="noopener noreferrer">
                    <span className="play-arrow" />
                    escríbenos
                  </a>
                )}
              </div>
            </div>

            <div className="page-indicator">
              <span className="label">Página</span>
              <div className="numbers">
                <span className="current">{dosDigitos(paginaActual + 1)}</span>
                <span className="total">/{dosDigitos(totalPaginas)}</span>
              </div>
              {totalPaginas > 1 && (
                <div className="pager">
                  <button
                    onClick={() => setPagina(paginaActual - 1)}
                    disabled={paginaActual === 0}
                    aria-label="Página anterior"
                  >←</button>
                  <button
                    onClick={() => setPagina(paginaActual + 1)}
                    disabled={paginaActual >= totalPaginas - 1}
                    aria-label="Página siguiente"
                  >→</button>
                </div>
              )}
            </div>
          </section>

          {/* ── INFO + PRODUCTOS ── */}
          <div className="content-grid">
            <aside className="info-sidebar">
              {telefono && (
                <div className="info-block">
                  <h4>Contáctanos</h4>
                  <p>{telefono}</p>
                </div>
              )}
              {vitrina.direccion && (
                <div className="info-block">
                  <h4>Dirección</h4>
                  <p>{vitrina.direccion}</p>
                </div>
              )}
              {vitrina.horario && (
                <div className="info-block">
                  <h4>Horario</h4>
                  <p>{vitrina.horario}</p>
                </div>
              )}
              <div className="info-block">
                <h4>Productos</h4>
                <p>{productos.length} en catálogo</p>
              </div>

              {waGeneral && (
                <div className="social-icons">
                  <a href={waGeneral} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp">
                    <IconoWhatsApp size={17} />
                  </a>
                </div>
              )}
            </aside>

            <section className="products-grid">
              {enPantalla.length === 0 ? (
                <p className="vacio">
                  {productos.length === 0
                    ? 'Este catálogo todavía no tiene productos publicados.'
                    : 'No encontramos productos con esa búsqueda.'}
                </p>
              ) : (
                enPantalla.map((p, i) => (
                  <Tarjeta
                    key={p.id}
                    producto={p}
                    numero={paginaActual * POR_PAGINA + i + 1}
                    onAbrir={setAbierto}
                  />
                ))
              )}
            </section>
          </div>

          <footer className="pie">
            <span>{vitrina.titulo}</span>
            <span>Precios y disponibilidad sujetos a cambio</span>
          </footer>
        </main>

        <aside className="right-sidebar">
          <div />
          <span className="vertical-text">
            tecnología {linea ? `| ${linea}` : '| catálogo'}
          </span>
          <div />
        </aside>
      </div>

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
