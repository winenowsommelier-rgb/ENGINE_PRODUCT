import { NextRequest, NextResponse } from 'next/server';
import { listSupplierDriveFiles } from '@/lib/supplier-intake/google-drive';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const folderId = searchParams.get('folder_id');
  if (!folderId) {
    return NextResponse.json({ error: 'folder_id query parameter is required' }, { status: 400 });
  }

  try {
    const files = await listSupplierDriveFiles(folderId);
    return NextResponse.json({ files });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to list Drive files';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
