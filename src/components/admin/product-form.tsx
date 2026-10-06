'use client';

import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ImageUp, Save, Tag, Trash2, X } from 'lucide-react';
import type { Product } from '@/lib/types';
import { PRODUCT_UNITS, PRODUCT_UNIT_LABELS, PRODUCT_UNIT_NAMES, type ProductUnit } from '@/lib/product-units';
import { PRODUCT_CATEGORIES, type ProductCategory } from '@/lib/product-categories';
import { formatArs } from '@/lib/format-price';
import { ADMIN_API } from '@/lib/routes';
import type { AdminClient } from './api';
import { MAX_IMAGE_HEIGHT, MAX_IMAGE_WIDTH, MAX_UPLOAD_BYTES, compressImageFile } from './image-compression';
import { InlineAlert } from './notices';
import { Field, Spinner, fieldAria } from './fields';
import { describeDate, getArgentinaToday, parseMoneyInput } from './format';
import {
  EMPTY_PRODUCT_FORM,
  IMAGE_TOO_LARGE_MESSAGE,
  MAX_DESCRIPTION_LENGTH,
  discountPercent,
  maxOfferDate,
  productToFormState,
  uploadErrorMessage,
  validateProductForm,
  type ProductFormErrors,
  type ProductFormState,
} from './product-form-model';

const PLACEHOLDER_IMAGE = '/product-placeholder.svg';

// Orden en el que se enfoca el primer campo con error al intentar guardar.
const FIELD_ORDER: Array<keyof ProductFormState> = ['name', 'price', 'description', 'offerPrice', 'offerEndsAt', 'image'];

type UploadState =
  | { status: 'idle'; message?: string }
  | { status: 'working' }
  | { status: 'error'; message: string };

type ProductFormProps = {
  /** null = producto nuevo. */
  product: Product | null;
  client: AdminClient;
  onSaved: (product: Product, mode: 'created' | 'updated') => void;
  onCancel: () => void;
};

export function ProductForm({ product, client, onSaved, onCancel }: ProductFormProps) {
  const baseId = useId();
  const id = (field: string) => `${baseId}-${field}`;
  const today = getArgentinaToday();

  const [initial] = useState(() => (product ? productToFormState(product) : { form: EMPTY_PRODUCT_FORM, expiredOffer: null }));
  const [form, setForm] = useState<ProductFormState>(initial.form);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');
  const [upload, setUpload] = useState<UploadState>({ status: 'idle' });
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Al abrir el formulario (nuevo o editar desde la lista) se lleva el foco al
  // título: el navegador hace scroll hasta acá y el lector de pantalla lo anuncia.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // La vista previa local es un blob: en memoria; se libera al reemplazarla o al cerrar.
  useEffect(() => () => {
    if (localPreview) URL.revokeObjectURL(localPreview);
  }, [localPreview]);

  const { errors, payload } = useMemo(() => validateProductForm(form, today), [form, today]);

  // Los campos obligatorios vacíos se marcan recién al intentar guardar (no
  // tiene sentido gritar "poné el nombre" antes de que lo escriba); lo que está
  // mal escrito, como una oferta mayor al precio, se marca al instante.
  const visibleErrors: ProductFormErrors = {
    name: submitAttempted ? errors.name : undefined,
    price: submitAttempted || form.price.trim() ? errors.price : undefined,
    description: errors.description,
    image: errors.image,
    offerPrice: errors.offerPrice,
    offerEndsAt: errors.offerEndsAt,
  };

  function update<K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setServerError('');
  }

  async function handleImageSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Se limpia para poder volver a elegir la misma foto si falló la subida.
    event.target.value = '';
    if (!file) return;

    setUpload({ status: 'working' });
    try {
      const compressed = await compressImageFile(file);
      if (compressed.file.size > MAX_UPLOAD_BYTES) {
        URL.revokeObjectURL(compressed.previewUrl);
        setUpload({ status: 'error', message: IMAGE_TOO_LARGE_MESSAGE });
        return;
      }
      setLocalPreview(compressed.previewUrl);

      const data = new FormData();
      data.append('file', compressed.file);
      const result = await client.send<{ url: string }>(`${ADMIN_API}/upload-product-image`, 'POST', data, 'No se pudo subir la imagen.');
      if (!result.ok) {
        setLocalPreview(null);
        setUpload({ status: 'error', message: uploadErrorMessage(result.status, result.data, result.error) });
        return;
      }

      update('image', result.data.url);
      setUpload({ status: 'idle', message: `Foto subida (${Math.max(1, Math.round(compressed.file.size / 1024))} KB).` });
    } catch (error) {
      setLocalPreview(null);
      setUpload({ status: 'error', message: error instanceof Error ? error.message : 'No se pudo procesar la imagen.' });
    }
  }

  function removeImage() {
    update('image', '');
    setLocalPreview(null);
    setUpload({ status: 'idle' });
  }

  function clearOffer() {
    setForm((current) => ({ ...current, offerPrice: '', offerEndsAt: '' }));
    setServerError('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitAttempted(true);
    if (upload.status === 'working' || submitting) return;

    if (!payload) {
      const firstInvalid = FIELD_ORDER.find((field) => errors[field]);
      if (firstInvalid) document.getElementById(id(firstInvalid))?.focus();
      return;
    }

    setSubmitting(true);
    setServerError('');
    const result = product
      ? await client.send<Product>(`${ADMIN_API}/products/${product.id}`, 'PUT', payload, 'No se pudo guardar el producto.')
      : await client.send<Product>(`${ADMIN_API}/products`, 'POST', payload, 'No se pudo crear el producto.');
    setSubmitting(false);

    if (!result.ok) {
      // Un 401 ya está mandando al login: no tiene sentido mostrar el error acá.
      if (result.status !== 401) setServerError(result.error);
      return;
    }
    onSaved(result.data, product ? 'updated' : 'created');
  }

  const parsedPrice = parseMoneyInput(form.price);
  const validPrice = parsedPrice !== null && !Number.isNaN(parsedPrice) ? parsedPrice : null;
  const parsedOffer = parseMoneyInput(form.offerPrice);
  const validOffer = parsedOffer !== null && !Number.isNaN(parsedOffer) ? parsedOffer : null;
  const percent = discountPercent(validPrice, validOffer);
  const unitLabel = PRODUCT_UNIT_LABELS[form.unit];
  const previewSrc = localPreview ?? (form.image.trim() || null);
  const isBolson = form.category === 'Bolsones';

  const priceHint = validPrice !== null ? `En la tienda: ${formatArs(validPrice)} / ${unitLabel}` : 'Ej: 1500 o 1.500';
  const descriptionHint = (
    <>
      {isBolson ? <strong>En bolsones, poné qué trae: 2 kg papa, 1 kg cebolla...</strong> : 'En bolsones, poné qué trae: 2 kg papa, 1 kg cebolla...'}
      {' '}
      <span className="adm-counter">{form.description.trim().length}/{MAX_DESCRIPTION_LENGTH}</span>
    </>
  );
  const offerDateHint = form.offerEndsAt && !errors.offerEndsAt
    ? `Vence al terminar el ${describeDate(form.offerEndsAt)}.`
    : 'Vacío = sin vencimiento. Vence al terminar el día elegido.';
  const imageHint = upload.status === 'working'
    ? null
    : upload.status === 'idle' && upload.message
      ? upload.message
      : `La foto se achica a ${MAX_IMAGE_WIDTH} px de ancho (y ${MAX_IMAGE_HEIGHT} de alto como máximo) y se sube como WebP para que cargue rápido. Sin foto, se muestra una genérica.`;

  return (
    <form className="adm-card adm-product-form" onSubmit={handleSubmit} noValidate aria-labelledby={id('title')}>
      <div className="adm-card__head">
        <h2 className="adm-card__title" id={id('title')} ref={headingRef} tabIndex={-1}>
          {product ? `Editar: ${product.name}` : 'Nuevo producto'}
        </h2>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--icon" onClick={onCancel} aria-label="Cerrar el formulario">
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      <div className="adm-form-grid">
        <Field id={id('name')} label="Nombre" error={visibleErrors.name} className="adm-span-2">
          <input
            {...fieldAria(id('name'), { error: visibleErrors.name })}
            className="adm-input"
            type="text"
            autoComplete="off"
            maxLength={160}
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            placeholder={isBolson ? 'Ej: Bolsón familiar' : 'Ej: Tomate perita'}
          />
        </Field>

        <Field id={id('price')} label={`Precio normal (por ${unitLabel})`} hint={priceHint} error={visibleErrors.price}>
          <input
            {...fieldAria(id('price'), { hint: priceHint, error: visibleErrors.price })}
            className="adm-input adm-input--money"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={form.price}
            onChange={(event) => update('price', event.target.value)}
          />
        </Field>

        <Field id={id('unit')} label="Se vende por">
          <select
            id={id('unit')}
            className="adm-select"
            value={form.unit}
            onChange={(event) => update('unit', event.target.value as ProductUnit)}
          >
            {PRODUCT_UNITS.map((unit) => (
              <option key={unit} value={unit}>{PRODUCT_UNIT_NAMES[unit]}</option>
            ))}
          </select>
        </Field>

        <Field id={id('category')} label="Categoría">
          <select
            id={id('category')}
            className="adm-select"
            value={form.category}
            onChange={(event) => update('category', event.target.value as ProductCategory)}
          >
            {PRODUCT_CATEGORIES.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </Field>

        <Field
          id={id('description')}
          label="Descripción (opcional)"
          hint={descriptionHint}
          error={visibleErrors.description}
          className="adm-span-2"
        >
          <textarea
            {...fieldAria(id('description'), { hint: descriptionHint, error: visibleErrors.description })}
            className="adm-textarea"
            rows={isBolson ? 4 : 2}
            value={form.description}
            onChange={(event) => update('description', event.target.value)}
          />
        </Field>
      </div>

      <fieldset className="adm-fieldset adm-fieldset--offer">
        <legend className="adm-legend"><Tag size={16} aria-hidden="true" /> Oferta (opcional)</legend>

        {initial.expiredOffer && !form.offerPrice ? (
          <InlineAlert kind="info">
            La oferta de {formatArs(initial.expiredOffer.offerPrice)} venció el {describeDate(initial.expiredOffer.endedOn)}.
            Si querés repetirla, cargala de nuevo.
          </InlineAlert>
        ) : null}

        <div className="adm-form-grid">
          <Field
            id={id('offerPrice')}
            label={`Precio de oferta (por ${unitLabel})`}
            hint="Vacío = sin oferta."
            error={visibleErrors.offerPrice}
          >
            <input
              {...fieldAria(id('offerPrice'), { hint: 'Vacío = sin oferta.', error: visibleErrors.offerPrice })}
              className="adm-input adm-input--money"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={form.offerPrice}
              onChange={(event) => update('offerPrice', event.target.value)}
            />
          </Field>

          <Field id={id('offerEndsAt')} label="Oferta hasta (opcional)" hint={offerDateHint} error={visibleErrors.offerEndsAt}>
            <input
              {...fieldAria(id('offerEndsAt'), { hint: offerDateHint, error: visibleErrors.offerEndsAt })}
              className="adm-input"
              type="date"
              min={today}
              max={maxOfferDate(today)}
              value={form.offerEndsAt}
              onChange={(event) => update('offerEndsAt', event.target.value)}
            />
          </Field>
        </div>

        {percent > 0 && validPrice !== null && validOffer !== null && !errors.offerPrice ? (
          <p className="adm-offer-preview">
            En la tienda: <s>{formatArs(validPrice)}</s> <strong>{formatArs(validOffer)}</strong> / {unitLabel}
            <span className="adm-badge adm-badge--offer">-{percent}%</span>
          </p>
        ) : null}

        {form.offerPrice || form.offerEndsAt ? (
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--small" onClick={clearOffer}>
            <X size={16} aria-hidden="true" /> Sacar la oferta
          </button>
        ) : null}
      </fieldset>

      <fieldset className="adm-fieldset">
        <legend className="adm-legend"><ImageUp size={16} aria-hidden="true" /> Foto</legend>
        <div className="adm-image-field">
          {/* eslint-disable-next-line @next/next/no-img-element -- vista previa blob: o URL que pega el dueño: next/image no aplica */}
          <img
            className="adm-image-field__preview"
            src={previewSrc ?? PLACEHOLDER_IMAGE}
            alt={previewSrc ? 'Vista previa de la foto' : 'Sin foto: se muestra una imagen genérica'}
            width={120}
            height={120}
            onError={(event) => {
              if (!event.currentTarget.src.endsWith(PLACEHOLDER_IMAGE)) event.currentTarget.src = PLACEHOLDER_IMAGE;
            }}
          />
          <div className="adm-image-field__controls">
            <div className="adm-image-field__buttons">
              <input
                id={id('file')}
                className="adm-visually-hidden"
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                disabled={upload.status === 'working'}
              />
              <label htmlFor={id('file')} className={`adm-btn adm-btn--secondary${upload.status === 'working' ? ' is-disabled' : ''}`}>
                {upload.status === 'working' ? <Spinner /> : <ImageUp size={18} aria-hidden="true" />}
                {upload.status === 'working' ? 'Subiendo foto…' : previewSrc ? 'Cambiar foto' : 'Subir foto'}
              </label>
              {previewSrc && upload.status !== 'working' ? (
                <button type="button" className="adm-btn adm-btn--ghost" onClick={removeImage}>
                  <Trash2 size={16} aria-hidden="true" /> Quitar
                </button>
              ) : null}
            </div>
            {upload.status === 'error' ? <InlineAlert>{upload.message}</InlineAlert> : null}
            <Field id={id('image')} label="O pegá la dirección (URL) de una imagen" hint={imageHint ?? undefined} error={visibleErrors.image}>
              <input
                {...fieldAria(id('image'), { hint: imageHint ?? undefined, error: visibleErrors.image })}
                className="adm-input"
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://..."
                value={form.image}
                onChange={(event) => {
                  setLocalPreview(null);
                  update('image', event.target.value);
                }}
              />
            </Field>
          </div>
        </div>
      </fieldset>

      {serverError ? <InlineAlert>{serverError}</InlineAlert> : null}
      {submitAttempted && !payload && !serverError ? <InlineAlert>Revisá los campos marcados en rojo.</InlineAlert> : null}

      <div className="adm-form-actions">
        <button type="submit" className="adm-btn adm-btn--primary" disabled={submitting || upload.status === 'working'}>
          {submitting ? <Spinner /> : <Save size={18} aria-hidden="true" />}
          {product ? 'Guardar cambios' : 'Agregar producto'}
        </button>
        <button type="button" className="adm-btn adm-btn--secondary" onClick={onCancel} disabled={submitting}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
