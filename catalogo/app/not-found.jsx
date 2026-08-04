export default function NoEncontrado() {
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
            <h1 className="hero-title">404</h1>
            <div className="hero-description">
              <p>
                Este enlace no existe o el catálogo fue desactivado.
                Verifica la dirección con quien te lo compartió.
              </p>
            </div>
          </div>
        </section>
      </main>

      <aside className="right-sidebar">
        <div />
        <span className="vertical-text">catálogo no encontrado</span>
        <div />
      </aside>
    </div>
  );
}
