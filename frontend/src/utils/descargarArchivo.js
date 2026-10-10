/**
 * Descarga un archivo que llegó como blob (PDF de préstamos, créditos…).
 *
 * El enlace temporal se libera DESPUÉS, no en la misma línea del clic: Safari
 * en iPhone —y la app instalada en la pantalla de inicio— abre el PDF de forma
 * asíncrona, y si la URL ya se revocó el visor muestra una PÁGINA EN BLANCO.
 * Un minuto sobra para que cualquier navegador termine de leerlo.
 *
 * El blob se re-envuelve con su tipo: axios a veces lo entrega sin él y algunos
 * visores no reconocen como PDF un archivo «application/octet-stream».
 */
export function descargarBlob(data, nombre, tipo = 'application/pdf') {
  const blob = data instanceof Blob && data.type === tipo ? data : new Blob([data], { type: tipo });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = nombre;
  a.rel      = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * El mensaje del servidor cuando la descarga falla. Con `responseType: 'blob'`
 * el JSON de error llega TAMBIÉN como blob, así que `err.response.data.error`
 * siempre es undefined y la pantalla terminaba diciendo un genérico.
 */
export async function mensajeDeErrorBlob(err, porDefecto) {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      const json = JSON.parse(await data.text());
      return json.error || json.message || porDefecto;
    } catch { return porDefecto; }
  }
  return data?.error || data?.message || porDefecto;
}
