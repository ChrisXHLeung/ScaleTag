import sharp from 'sharp';
import { AppError } from './validation.js';

// All limits use binary KiB (1 KiB = 1024 bytes). Decode only bounded raster
// images, then re-encode without metadata. Images remain in the post document:
// expiry, atomic writes, encrypted backups and HA have exactly one lifecycle.
export async function saleImages(values = []) {
  if (!Array.isArray(values) || values.length > 3)
    throw new AppError(400, 'Upload at most 3 images.');
  const result = [];
  for (const value of values) {
    const match = typeof value === 'string' && /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match || match[2].length > Math.ceil(1048576 / 3) * 4)
      throw new AppError(400, 'Each image must be a JPEG, PNG or WebP no larger than 1 MiB.');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 1048576 || bytes.toString('base64') !== match[2])
      throw new AppError(400, 'Each image must be a JPEG, PNG or WebP no larger than 1 MiB.');
    try {
      const decoder = sharp(bytes, { limitInputPixels: 16000000, failOn: 'warning', animated: false });
      const metadata = await decoder.metadata();
      if (metadata.format !== match[1] || (metadata.pages ?? 1) !== 1)
        throw Error('Unsupported image');
      const limit = bytes.length > 614400 ? 307200 : 614400;
      let output;
      // Start at full resolution and high quality; only reduce when needed.
      for (const [quality, edge] of [[95, 4096], [88, 2560], [80, 1920], [70, 1280], [60, 960]]) {
        output = await sharp(bytes, { limitInputPixels: 16000000, failOn: 'warning' })
          .rotate().resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
          .flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
        if (output.length <= limit) break;
      }
      if (output.length > limit) throw Error('Cannot compress image');
      result.push(`data:image/jpeg;base64,${output.toString('base64')}`);
    } catch {
      throw new AppError(400, 'This image is invalid, too large to decode, or cannot be safely compressed. Use another JPEG, PNG or WebP.');
    }
  }
  return result;
}
