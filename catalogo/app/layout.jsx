import './globals.css';

export const metadata = {
  title: 'Catálogo',
  description: 'Catálogo de productos',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // El catálogo se abre casi siempre desde WhatsApp en un celular: el color de
  // la barra del navegador se ajusta por vitrina en cada página.
  themeColor: '#ffffff',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
