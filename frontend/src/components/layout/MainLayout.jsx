import { Navbar } from './Navbar';
import { ModalPasswordTemporal } from '../../pages/configuracion/ModalPasswordTemporal';

export function MainLayout({ children }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-screen-xl mx-auto px-4 pt-16 pb-24 md:pt-20 md:pb-8">
        {children}
      </main>
      <ModalPasswordTemporal />
    </div>
  );
}