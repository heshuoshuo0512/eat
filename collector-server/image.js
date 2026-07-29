import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const MAX_COLLECTOR_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);

function averageHash(buffer) {
  const average = buffer.reduce((sum, value) => sum + value, 0) / buffer.length;
  let bits = '';
  for (const value of buffer) bits += value >= average ? '1' : '0';
  return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
}

export function hammingDistance(left, right) {
  if (!left || !right || left.length !== right.length) return Number.POSITIVE_INFINITY;
  let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let count = 0;
  while (value) {
    count += Number(value & 1n);
    value >>= 1n;
  }
  return count;
}

export async function normalizeCollectorImage(input) {
  if (!Buffer.isBuffer(input) || !input.length) throw Object.assign(new Error('图片内容为空'), { status: 400, code: 'EMPTY_IMAGE' });
  if (input.length > MAX_COLLECTOR_IMAGE_BYTES) throw Object.assign(new Error('图片不能超过 5MB'), { status: 413, code: 'IMAGE_TOO_LARGE' });
  let metadata;
  try {
    metadata = await sharp(input, { failOn: 'error' }).metadata();
  } catch {
    throw Object.assign(new Error('图片文件无效'), { status: 415, code: 'INVALID_IMAGE' });
  }
  if (!ALLOWED_FORMATS.has(metadata.format)) throw Object.assign(new Error('仅支持 JPEG、PNG 和 WebP 图片'), { status: 415, code: 'UNSUPPORTED_IMAGE_TYPE' });
  const normalized = await sharp(input, { failOn: 'error' })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  const hashPixels = await sharp(normalized.data).resize(8, 8, { fit: 'fill' }).greyscale().raw().toBuffer();
  return {
    buffer: normalized.data,
    contentType: 'image/jpeg',
    width: normalized.info.width,
    height: normalized.info.height,
    sha256: createHash('sha256').update(normalized.data).digest('hex'),
    phash: averageHash(hashPixels),
  };
}
