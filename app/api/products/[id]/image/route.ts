/**
 * POST /api/products/{id}/image
 *
 * Upload a product image. Accepts:
 * - multipart/form-data with "file" field (direct upload)
 * - JSON with { "url": "https://..." } to download from URL
 *
 * The image is:
 * 1. Saved with an SEO-optimized filename
 * 2. Stored in public/images/products/{country}/
 * 3. Product record updated with image_url, image_alt_text, image_local_path
 *
 * GET /api/products/{id}/image
 * Returns image metadata for a product.
 */
import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import {
  generateImageFilename,
  generateImageAltText,
  getImagePath,
  getImageFsPath,
  type ProductImageMeta,
} from '@/lib/images/seo-filename';

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

async function getProduct(id: string) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(id)}&select=sku,name,brand,classification,grape_variety,country,region,vintage,image_url,image_local_path,image_alt_text&limit=1`,
    { headers: HEADERS }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

async function updateProduct(id: string, fields: Record<string, string>) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(id)}`,
    { method: 'PATCH', headers: HEADERS, body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }) }
  );
  return res.ok;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const product = await getProduct(params.id);
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const meta: ProductImageMeta = product;
    return NextResponse.json({
      sku: product.sku,
      hasImage: !!product.image_url,
      image_url: product.image_url || null,
      image_local_path: product.image_local_path || null,
      image_alt_text: product.image_alt_text || null,
      suggested: {
        filename: generateImageFilename(meta),
        alt_text: generateImageAltText(meta),
        path: getImagePath(meta),
        fs_path: getImageFsPath(meta),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const product = await getProduct(params.id);
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const meta: ProductImageMeta = product;
    const contentType = req.headers.get('content-type') || '';
    let imageBuffer: Buffer;
    let sourceUrl = '';

    if (contentType.includes('application/json')) {
      // Download from URL
      const body = await req.json();
      const url = body.url;
      if (!url || typeof url !== 'string') {
        return NextResponse.json({ error: 'Provide { "url": "https://..." }' }, { status: 400 });
      }
      sourceUrl = url;

      const imgRes = await fetch(url);
      if (!imgRes.ok) {
        return NextResponse.json({ error: `Failed to download image: ${imgRes.status}` }, { status: 400 });
      }
      const arrayBuf = await imgRes.arrayBuffer();
      if (arrayBuf.byteLength > MAX_SIZE) {
        return NextResponse.json({ error: 'Image too large (max 10MB)' }, { status: 400 });
      }
      imageBuffer = Buffer.from(arrayBuf);
    } else if (contentType.includes('multipart/form-data')) {
      // Direct file upload
      const formData = await req.formData();
      const file = formData.get('file');
      if (!file || !(file instanceof Blob)) {
        return NextResponse.json({ error: 'No file provided. Use form field "file".' }, { status: 400 });
      }
      if (file.size > MAX_SIZE) {
        return NextResponse.json({ error: 'Image too large (max 10MB)' }, { status: 400 });
      }
      const arrayBuf = await file.arrayBuffer();
      imageBuffer = Buffer.from(arrayBuf);
    } else {
      return NextResponse.json({ error: 'Send multipart/form-data with "file" or JSON with "url"' }, { status: 400 });
    }

    // Generate SEO filename and path
    const fsPath = join(process.cwd(), getImageFsPath(meta));
    const publicPath = getImagePath(meta);
    const altText = generateImageAltText(meta);

    // Ensure directory exists
    const dir = dirname(fsPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Save image
    writeFileSync(fsPath, imageBuffer);

    // Update product record
    const updated = await updateProduct(params.id, {
      image_url: publicPath,
      image_local_path: fsPath,
      image_alt_text: altText,
      ...(sourceUrl ? { image_scraped_url: sourceUrl } : {}),
    });

    return NextResponse.json({
      success: true,
      image_url: publicPath,
      image_alt_text: altText,
      filename: generateImageFilename(meta),
      size_bytes: imageBuffer.length,
      product_updated: updated,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
