import { Navbar } from './Navbar';
import { ModalPasswordTemporal } from '../../pages/configuracion/ModalPasswordTemporal';

export function MainLayout({ children }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      {/*
        Desktop: navbar 1 barra = h-14 (56px) → pt-16 (64px) da 8px de aire
        Mobile:  navbar 2 barras = h-14 + ~h-9 (~92px) → pt-24 (96px) da 4px de aire
      */}
      <main className="max-w-screen-xl mx-auto px-4 pt-24 pb-8 md:pt-16">
        {children}
      </main>
      <ModalPasswordTemporal />
    </div>
  );
}