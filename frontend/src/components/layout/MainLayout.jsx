import { useEffect, useState } from 'react';
import { Navbar } from './Navbar';
import { ModalPasswordTemporal } from '../../pages/configuracion/ModalPasswordTemporal';

export function MainLayout({ children }) {
  const [navH, setNavH] = useState(0);

  useEffect(() => {
    // Lee la CSS variable que Navbar publica en cada resize
    const update = () => {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue('--navbar-height');
      const px = parseFloat(raw) || 0;
      if (px > 0) setNavH(px);
    };

    // Primer intento inmediato
    update();

    // Sigue escuchando por si el navbar cambia de alto (resize, scroll oculto, etc.)
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    });

    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main
        className="max-w-screen-xl mx-auto px-4 pb-8"
        style={{ paddingTop: navH + 16 }} // 16px de aire entre navbar y contenido
      >
        {children}
      </main>
      <ModalPasswordTemporal />
    </div>
  );
}