import crypto from 'node:crypto';
import sharp from 'sharp';
import { getCdnOrigin } from './url.js';

export async function materializeArchivedGroupInput({ storage, userId, filename }) {
 if (!storage?.getImageBuffer || !storage?.uploadGenericImage) return null;
 try {
  const bytes = await storage.getImageBuffer(filename);
  const png = await sharp(bytes, { failOn: 'error' }).png().toBuffer();
  const key = `edited/${Number(userId)}/${Date.now()}_${crypto.randomBytes(8).toString('hex')}.png`;
  await storage.uploadGenericImage(png, key, { contentType: 'image/png' });
  return `${getCdnOrigin()}/api/images/generic/${key.split('/').map(encodeURIComponent).join('/')}`;
 } catch { return null; }
}
