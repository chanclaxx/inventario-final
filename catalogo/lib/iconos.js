// ─────────────────────────────────────────────────────────────────────────────
// Favicon de la vitrina.
//
// Se resuelve por metadata y NO con los archivos `app/icon.*` de Next: esos son
// estáticos e iguales para todas las vitrinas, y aquí cada negocio debe salir
// con SU logo en la pestaña del navegador. Además, el archivo convencional
// tendría prioridad sobre lo que devuelva `generateMetadata` y taparía el logo.
//
// El logo llega como data URI desde el backend, así que sirve directo como
// favicon sin necesidad de alojarlo en ninguna parte.
// ─────────────────────────────────────────────────────────────────────────────

/** Isotipo hexagonal del diseño, para los negocios que no han subido logo. */
export const FAVICON_POR_DEFECTO =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2Y3ZjdmOCIvPjxwb2x5Z29uIHBvaW50cz0iNTAsNSA5NSwyNy41IDk1LDcyLjUgNTAsOTUgNSw3Mi41IDUsMjcuNSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMTExIiBzdHJva2Utd2lkdGg9IjYiLz48cG9seWdvbiBwb2ludHM9IjUwLDQwIDY4LDcwIDMyLDcwIiBmaWxsPSIjNGNkNWJkIi8+PC9zdmc+';

/**
 * Bloque `icons` de metadata para una vitrina.
 * Con logo propio, la pestaña y el ícono de "agregar a inicio" del celular
 * muestran el logo del negocio; sin él, el isotipo del diseño.
 */
export const iconosDe = (logo) => {
  const url = logo || FAVICON_POR_DEFECTO;
  return {
    icon:        [{ url }],
    shortcut:    [{ url }],
    appleTouchIcon: [{ url }],
  };
};
