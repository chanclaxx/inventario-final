import { Montserrat } from 'next/font/google';
import { iconosDe } from '../lib/iconos';
import './globals.css';

// Montserrat, la tipografía del diseño. Vía next/font en vez del <link> a Google
// Fonts del template original: se auto-hospeda en el build, así que no hay una
// petición externa bloqueando el primer render — que es justo lo que importa
// cuando el catálogo se abre desde WhatsApp con mala señal.
const montserrat = Montserrat({
  subsets: ['latin'],
  weight:  ['300', '400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-montserrat',
});

export const metadata = {
  title: 'Catálogo',
  description: 'Catálogo de productos',
  // Ícono base. Cada vitrina lo sobreescribe con su propio logo desde
  // `generateMetadata` en app/[slug]/page.jsx.
  icons: iconosDe(null),
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f7f7f8',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" className={montserrat.variable}>
      <body>{children}</body>
    </html>
  );
}
