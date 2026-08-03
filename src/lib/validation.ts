export type ProductCreatePayload = {
  name: string;
  price: number;
  image: string;
  stock: number;
};

export type ProductUpdatePayload = Partial<ProductCreatePayload>;

type ProductPayloadInput = {
  name?: unknown;
  price?: unknown;
  image?: unknown;
  stock?: unknown;
};

export function parseProductPayload(payload: unknown, options?: { partial?: false }): ProductCreatePayload;
export function parseProductPayload(payload: unknown, options: { partial: true }): ProductUpdatePayload;
export function parseProductPayload(payload: unknown, options: { partial?: boolean } = {}) {
  const body = (payload ?? {}) as ProductPayloadInput;
  const partial = options.partial ?? false;
  const data: ProductUpdatePayload = {};

  if (!partial || body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      throw new Error('El nombre del producto es obligatorio.');
    }
    data.name = name;
  }

  if (!partial || body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) {
      throw new Error('El precio debe ser un número válido mayor o igual a 0.');
    }
    data.price = price;
  }

  if (!partial || body.image !== undefined) {
    const image = typeof body.image === 'string' ? body.image.trim() : '';
    if (!image) {
      throw new Error('La URL de la imagen es obligatoria.');
    }
    data.image = image;
  }

  if (!partial || body.stock !== undefined) {
    const stock = Number(body.stock);
    if (!Number.isFinite(stock) || stock < 0) {
      throw new Error('El stock debe ser un número válido mayor o igual a 0.');
    }
    data.stock = Math.trunc(stock);
  }

  return data;
}