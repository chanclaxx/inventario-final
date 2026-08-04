export default function NoEncontrado() {
  return (
    <main className="contenedor" style={{ paddingTop: 80, textAlign: 'center' }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Catálogo no encontrado</h1>
      <p style={{ color: 'var(--suave)', fontSize: 14, lineHeight: 1.6 }}>
        Este enlace no existe o el catálogo fue desactivado.
        <br />
        Verifica la dirección con quien te lo compartió.
      </p>
    </main>
  );
}
