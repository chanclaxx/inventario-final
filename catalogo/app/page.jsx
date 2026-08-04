// La raíz del dominio no es el catálogo de nadie: cada vitrina vive en /<slug>.
// Se responde con una página neutra en vez de un 404 para que quien borre el
// slug del enlace por accidente entienda qué pasó.

export const metadata = {
  title: 'Catálogos',
  robots: { index: false, follow: false },
};

export default function Inicio() {
  return (
    <div className="app-container">
      <main className="main-content">
        <header>
          <div className="brand">
            <div className="logo-icon">
              <svg viewBox="0 0 100 100" aria-hidden="true">
                <polygon points="50,5 95,27.5 95,72.5 50,95 5,72.5 5,27.5" fill="none" stroke="#111" strokeWidth="5" />
                <polygon points="50,20 80,35 80,65 50,80 20,65 20,35" fill="none" stroke="#111" strokeWidth="3" />
                <polygon points="50,40 68,70 32,70" fill="var(--accent-color)" />
              </svg>
            </div>
          </div>
        </header>

        <section className="hero-section">
          <div className="hero-title-container">
            <h1 className="hero-title">Catálogos</h1>
            <div className="hero-description">
              <p>
                Cada negocio tiene su propia dirección.
                Abre el enlace completo que te compartieron.
              </p>
            </div>
          </div>
        </section>
      </main>

      <aside className="right-sidebar">
        <div />
        <span className="vertical-text">tecnología | catálogos</span>
        <div />
      </aside>
    </div>
  );
}
