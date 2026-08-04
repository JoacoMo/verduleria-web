import { NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/auth';

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'product-images';

async function ensureBucketExists() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Faltan variables de Supabase Storage.');
  }

  const bucketsResponse = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });

  if (!bucketsResponse.ok) {
    throw new Error('No se pudo verificar el bucket de Storage.');
  }

  const buckets = await bucketsResponse.json();
  const bucketExists = Array.isArray(buckets) && buckets.some((bucket: { name?: string }) => bucket.name === SUPABASE_STORAGE_BUCKET);

  if (bucketExists) {
    const updateResponse = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${SUPABASE_STORAGE_BUCKET}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        public: true,
      }),
    });

    if (!updateResponse.ok) {
      const body = await updateResponse.text();
      console.error('Error al hacer público el bucket:', body);
      throw new Error('No se pudo marcar el bucket como público.');
    }

    return;
  }

  const createResponse = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      id: SUPABASE_STORAGE_BUCKET,
      name: SUPABASE_STORAGE_BUCKET,
      public: true,
    }),
  });

  if (!createResponse.ok) {
    throw new Error('No se pudo crear el bucket de Storage.');
  }
}

export async function POST(request: Request) {
  const auth = verifyAdminAuth(request.headers.get('authorization'));
  if (!auth.ok) return auth.response;

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Faltan variables de Supabase Storage.' }, { status: 500 });
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No se recibió ninguna imagen.' }, { status: 400 });
    }

    await ensureBucketExists();

    const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
    const uploadResponse = await fetch(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_STORAGE_BUCKET}/${safeName}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': file.type || 'application/octet-stream',
        'x-upsert': 'true',
      },
      body: Buffer.from(await file.arrayBuffer()),
    });

    if (!uploadResponse.ok) {
      const body = await uploadResponse.text();
      console.error('Error en upload a Supabase Storage:', body);
      return NextResponse.json({ error: 'No se pudo subir la imagen.' }, { status: 500 });
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET}/${safeName}`;

    return NextResponse.json({
      url: publicUrl,
    });
  } catch (error) {
    console.error('Error en /api/admin/upload-product-image:', error);
    return NextResponse.json({ error: 'No se pudo procesar la imagen.' }, { status: 500 });
  }
}