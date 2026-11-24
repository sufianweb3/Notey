import { toast } from 'sonner';
import type { FileInfo } from '@shared/schemas';
import { base } from './content';

/** Uploads to workspace file storage and returns the file's same-origin URL. */
export async function upload(ws: string, file: File | Blob, name = 'file'): Promise<string> {
  const form = new FormData();
  form.append('file', file, file instanceof File ? file.name : name);
  const res = await fetch(`${base(ws)}/files`, { method: 'POST', body: form, credentials: 'same-origin' });
  const json = (await res.json().catch(() => null)) as { file?: FileInfo; error?: { message: string } } | null;
  if (!res.ok || !json?.file) {
    const msg = json?.error?.message ?? "Couldn't upload the file. Try again.";
    toast.error(msg);
    throw new Error(msg);
  }
  return json.file.url;
}
