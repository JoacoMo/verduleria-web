/**
 * Compresión de fotos de producto en el navegador, antes de subirlas.
 *
 * La foto sale del celular del dueño (3-5 MB, 4000 px). En la tienda se muestra
 * en tarjetas de ~300 px, así que 800 px de ancho alcanzan incluso en pantallas
 * de alta densidad, y en WebP pesa unas decenas de KB: carga rápido con datos
 * móviles y ahorra almacenamiento en Supabase.
 *
 * El alto también tiene tope: con solo el ancho, una captura de pantalla larga
 * o una panorámica vertical quedaba de 800 × 10.000 px y podía pasar el límite
 * de 4,5 MB de Vercel (que corta con un 413 propio, sin llegar al servidor).
 */
export const MAX_IMAGE_WIDTH = 800;
export const MAX_IMAGE_HEIGHT = 1600;
/**
 * Lo más que acepta el servidor (MAX_UPLOAD_BYTES en
 * src/app/api/gestion/upload-product-image/route.ts): por debajo del corte de
 * 4,5 MB de Vercel. Si la foto comprimida igual lo pasa, no se intenta subir.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const WEBP_QUALITY = 0.82;
const JPEG_QUALITY = 0.85;

/**
 * Medidas de la imagen achicada para que entre en maxWidth × maxHeight sin
 * deformarse. Nunca se agranda una foto chica. Una medida desconocida (0) se
 * toma como el tope.
 */
export function fitWithin(width: number, height: number, maxWidth = MAX_IMAGE_WIDTH, maxHeight = MAX_IMAGE_HEIGHT) {
  const sourceWidth = width > 0 ? width : maxWidth;
  const sourceHeight = height > 0 ? height : maxHeight;
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export type CompressedImage = {
  file: File;
  /** URL local (blob:) para la vista previa. Hay que liberarla con URL.revokeObjectURL. */
  previewUrl: string;
};

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo abrir la imagen. Probá con una foto JPG, PNG o WebP.'));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function compressImageFile(file: File): Promise<CompressedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('El archivo no es una imagen.');
  }

  const image = await loadImage(file);
  const { width, height } = fitWithin(image.naturalWidth, image.naturalHeight);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Este navegador no pudo procesar la imagen.');
  }
  context.drawImage(image, 0, 0, width, height);

  let blob = await canvasToBlob(canvas, 'image/webp', WEBP_QUALITY);

  // Algunos Safari no saben generar WebP y devuelven un PNG sin avisar. Subirlo
  // como ".webp" haría que el servidor lo rechace (el contenido no coincide con
  // el tipo) y un PNG de foto pesa muchísimo: se pasa a JPEG con fondo blanco,
  // porque JPEG no tiene transparencia y lo transparente quedaría negro.
  if (!blob || blob.type !== 'image/webp') {
    context.globalCompositeOperation = 'destination-over';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    blob = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY);
  }
  if (!blob) {
    throw new Error('No se pudo comprimir la imagen.');
  }

  const isWebp = blob.type === 'image/webp';
  const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').slice(0, 60) || 'producto';
  const compressed = new File([blob], `${baseName}.${isWebp ? 'webp' : 'jpg'}`, { type: isWebp ? 'image/webp' : 'image/jpeg' });
  return { file: compressed, previewUrl: URL.createObjectURL(compressed) };
}
