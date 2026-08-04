'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import type { OrderRecord, Product } from '@/lib/types';
import { PRODUCT_UNIT_LABELS, formatProductQuantity } from '@/lib/product-units';

type ProductFormState = {
  name: string;
  price: string;
  unit: 'kg' | 'g' | 'unidad';
  image: string;
};

type CompressedImage = {
  file: File;
  previewUrl: string;
};

const EMPTY_FORM: ProductFormState = {
  name: '',
  price: '',
  unit: 'kg',
  image: '',
};

const PLACEHOLDER_IMAGE = '/product-placeholder.svg';

function compressImageFile(file: File): Promise<CompressedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.onload = () => {
      const image = new Image();

      image.onerror = () => reject(new Error('No se pudo cargar la imagen.'));
      image.onload = () => {
        const maxWidth = 1400;
        const scale = Math.min(1, maxWidth / image.width);
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('No se pudo procesar la imagen.'));
          return;
        }

        context.drawImage(image, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('No se pudo comprimir la imagen.'));
              return;
            }

            const baseName = file.name.replace(/\.[^.]+$/, '') || 'product-image';
            const compressedFile = new File([blob], `${baseName}.webp`, { type: 'image/webp' });
            resolve({ file: compressedFile, previewUrl: URL.createObjectURL(compressedFile) });
          },
          'image/webp',
          0.84,
        );
      };

      image.src = typeof reader.result === 'string' ? reader.result : '';
    };

    reader.readAsDataURL(file);
  });
}

export default function AdminPanelPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [form, setForm] = useState<ProductFormState>(EMPTY_FORM);
  const [imageUploadLoading, setImageUploadLoading] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('adminToken');
    if (!token) {
      router.replace('/login');
      return;
    }

    void refreshData(token);
  }, [router]);

  async function getAuthHeaders() {
    const token = localStorage.getItem('adminToken');
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }

  async function handleAuthError(response: Response) {
    if (response.status === 401) {
      localStorage.removeItem('adminToken');
      router.replace('/login');
      return true;
    }
    return false;
  }

  async function refreshData(token?: string) {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token ?? localStorage.getItem('adminToken')}`,
    };

    try {
      const [productsResponse, ordersResponse] = await Promise.all([
        fetch('/api/products'),
        fetch('/api/admin/orders', { headers }),
      ]);

      if (await handleAuthError(ordersResponse)) return;

      if (productsResponse.ok) setProducts(await productsResponse.json());
      if (ordersResponse.ok) setOrders(await ordersResponse.json());
    } catch (error) {
      console.error('Error loading admin data:', error);
    }
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingProductId(null);
    setImagePreview(null);
  }

  function handleEdit(productId: number) {
    const product = products.find((item) => item.id === productId);
    if (!product) return;

    setForm({
      name: product.name,
      price: String(product.price),
      unit: product.unit,
      image: product.image,
    });
    setImagePreview(product.image || null);
    setEditingProductId(productId);
    window.scrollTo(0, 0);
  }

  async function handleImageSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setImageUploadLoading(true);
      const compressed = await compressImageFile(file);
      setImagePreview(compressed.previewUrl);
      setForm((current) => ({ ...current, image: compressed.file.name }));

      const formData = new FormData();
      formData.append('file', compressed.file);

      const response = await fetch('/api/admin/upload-product-image', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
        },
        body: formData,
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        alert(result.error || 'No se pudo subir la imagen.');
        setForm((current) => ({ ...current, image: '' }));
        return;
      }

      setForm((current) => ({ ...current, image: result.url }));
    } catch (error) {
      console.error('Error al subir imagen:', error);
      alert('No se pudo procesar la imagen.');
    } finally {
      setImageUploadLoading(false);
    }
  }

  async function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payload = {
      name: form.name,
      price: Number(form.price),
      unit: form.unit,
      image: form.image,
    };

    const isEditing = editingProductId !== null;
    const url = isEditing ? `/api/admin/products/${editingProductId}` : '/api/admin/products';
    const method = isEditing ? 'PUT' : 'POST';

    try {
      const response = await fetch(url, {
        method,
        headers: await getAuthHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));

      if (await handleAuthError(response)) return;
      if (!response.ok) {
        alert(data.error || 'La operación en el servidor falló.');
        return;
      }

      resetForm();
      await refreshData();
      alert(isEditing ? 'Producto actualizado correctamente.' : 'Producto agregado correctamente.');
    } catch (error) {
      console.error('Error al guardar producto:', error);
      alert('No se pudo guardar el producto. Revisá la consola.');
    }
  }

  async function handleDelete(productId: number) {
    if (!confirm('¿Estás seguro de eliminar este producto?')) return;

    try {
      const response = await fetch(`/api/admin/products/${productId}`, {
        method: 'DELETE',
        headers: await getAuthHeaders(),
      });

      if (await handleAuthError(response)) return;
      await refreshData();
    } catch (error) {
      console.error('Error al eliminar:', error);
      alert('No se pudo eliminar el producto.');
    }
  }

  async function handleConfirmOrder(orderId: number) {
    if (!confirm('¿Confirmás que llegó la transferencia de este pedido? Se va a descontar el stock.')) return;

    try {
      const response = await fetch(`/api/admin/orders/${orderId}/confirm`, {
        method: 'PUT',
        headers: await getAuthHeaders(),
      });

      if (await handleAuthError(response)) return;
      const result = await response.json();
      if (!response.ok) {
        alert(result.error || 'No se pudo confirmar el pedido.');
        return;
      }

      await refreshData();
    } catch (error) {
      console.error('Error al confirmar pedido:', error);
      alert('No se pudo confirmar el pedido.');
    }
  }

  async function handleCancelOrder(orderId: number) {
    if (!confirm('¿Cancelar este pedido?')) return;

    try {
      const response = await fetch(`/api/admin/orders/${orderId}/cancel`, {
        method: 'PUT',
        headers: await getAuthHeaders(),
      });

      if (await handleAuthError(response)) return;
      await refreshData();
    } catch (error) {
      console.error('Error al cancelar pedido:', error);
      alert('No se pudo cancelar el pedido.');
    }
  }

  function handleLogout() {
    localStorage.removeItem('adminToken');
    router.push('/login');
  }

  return (
    <main className="admin-page">
      <div className="panel-shell">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h1>Panel de Administración</h1>
          <button id="logout-btn" style={{ backgroundColor: '#7f8c8d', color: 'white' }} onClick={handleLogout}>Cerrar sesión</button>
        </div>

        <div className="form-container">
          <h2>{editingProductId ? 'Editar Producto' : 'Agregar Nuevo Producto'}</h2>
          <form onSubmit={handleFormSubmit}>
            <div className="form-group">
              <label htmlFor="product-name">Nombre del Producto:</label>
              <input id="product-name" type="text" required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            </div>
            <div className="form-group">
              <label htmlFor="product-price">Precio:</label>
              <input id="product-price" type="number" step="0.01" required value={form.price} onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))} />
            </div>
            <div className="form-group">
              <label htmlFor="product-unit">Unidad de venta:</label>
              <select id="product-unit" required value={form.unit} onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value as ProductFormState['unit'] }))}>
                <option value="kg">Kilo</option>
                <option value="g">Gramo</option>
                <option value="unidad">Unidad</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="product-image">URL de la Imagen:</label>
              <input id="product-image" type="url" required value={form.image} onChange={(event) => setForm((current) => ({ ...current, image: event.target.value }))} />
            </div>
            <div className="form-group">
              <label htmlFor="product-image-file">O subir imagen:</label>
              <input id="product-image-file" type="file" accept="image/*" onChange={handleImageSelect} />
              <p style={{ margin: '8px 0 0', color: '#6c7a6a', fontSize: '0.92rem' }}>
                Se comprime en el navegador y se sube como WebP para ahorrar almacenamiento.
              </p>
              <p style={{ margin: '6px 0 0', color: '#6c7a6a', fontSize: '0.85rem' }}>
                {imageUploadLoading ? 'Procesando imagen...' : form.image ? 'Imagen lista para guardar.' : 'Si no subís archivo, podés pegar una URL manual.'}
              </p>
              {imagePreview ? (
                <img
                  src={imagePreview}
                  alt="Vista previa"
                  style={{ width: '100%', maxWidth: 260, marginTop: 12, borderRadius: 8, border: '1px solid #ddd4bb' }}
                />
              ) : null}
            </div>
            <div className="form-buttons">
              <button type="submit" id="save-btn">{editingProductId ? 'Actualizar Producto' : 'Guardar Producto'}</button>
              {editingProductId ? <button type="button" id="cancel-edit-btn" onClick={resetForm}>Cancelar Edición</button> : null}
            </div>
          </form>
        </div>

        <hr />

        <h2>Productos Existentes</h2>
        <div>
          {products.map((product) => (
            <div className="product-item" key={product.id}>
              <div className="product-item-info">
                <img src={product.image} alt={product.name} onError={(event) => { event.currentTarget.src = 'https://via.placeholder.com/60'; }} />
                <div>
                  <strong>{product.name}</strong>
                  <br />
                  ${product.price.toFixed(2)} / {PRODUCT_UNIT_LABELS[product.unit]}
                </div>
              </div>
              <div className="product-item-actions">
                <button className="edit-btn" type="button" onClick={() => handleEdit(product.id)}>Editar</button>
                <button className="delete-btn" type="button" onClick={() => handleDelete(product.id)}>Eliminar</button>
              </div>
            </div>
          ))}
        </div>

        <hr />

        <h2>Pedidos</h2>
        <p style={{ color: '#6c7a6a', marginTop: '-10px' }}>Confirmá un pedido recién cuando veas el comprobante de transferencia. El sistema ya no descuenta stock porque los productos se venden por unidad de medida.</p>
        <div>
          {orders.length === 0 ? <p>Todavía no hay pedidos.</p> : null}
          {orders.map((order) => {
            const itemsHtml = order.items.map((item) => (
              <li key={`${order.id}-${item.id}`}>{formatProductQuantity(item.quantity, item.unit)} de {item.name} — ${(item.price * item.quantity).toFixed(2)}</li>
            ));
            const statusClass = order.status === 'paid' ? 'paid' : order.status === 'pending' ? 'pending' : 'cancelled';

            return (
              <div className="order-item" key={order.id}>
                <div style={{ width: '100%' }}>
                  <div className="order-header">
                    <strong>Pedido #{order.id}</strong>
                    <span className={`order-status ${statusClass}`}>{order.status}</span>
                  </div>
                  <ul className="order-items-list">{itemsHtml}</ul>
                  <div><strong>Total: ${order.total.toFixed(2)}</strong></div>
                  {order.status === 'pending' ? (
                    <div className="order-actions">
                      <button className="confirm-order-btn" type="button" onClick={() => handleConfirmOrder(order.id)}>Confirmar pago</button>
                      <button className="cancel-order-btn" type="button" onClick={() => handleCancelOrder(order.id)}>Cancelar</button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}