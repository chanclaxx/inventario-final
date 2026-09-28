// Reduce una imagen a MAX px de lado y la devuelve como data URL JPEG (80 %).
// La usan el logo del negocio y el de cada sucursal, que se guardan en la base
// como texto: así un logo pesa decenas de KB, no los MB de la foto original.
// (Las fotos del catálogo web van por otro camino: `utils/imagen.js`.)
export const comprimirLogo = (file, MAX = 400) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => reject(new Error('Imagen inválida'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Error leyendo archivo'));
    reader.readAsDataURL(file);
  });
