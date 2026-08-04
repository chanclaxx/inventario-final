// La raíz del dominio no es un catálogo de nadie: cada vitrina vive en
// /<slug>. Se responde con una página neutra en vez de un 404 para que quien
// borre el slug del enlace por accidente entienda qué pasó.

export const metadata = {
  title: 'Catálogos',
  robots: { index: false, follow: false },
};

export default function Inicio() {
  return (
    <main className="contenedor" style={{ paddingTop: 80, textAlign: 'center' }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Catálogos</h1>
      <p style={{ color: 'var(--suave)', fontSize: 14, lineHeight: 1.6 }}>
        Cada negocio tiene su propia dirección.
        <br />
        Abre el enlace completo que te compartieron.
      </p>
    </main>
  );
}
