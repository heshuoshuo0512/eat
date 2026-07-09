import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

let S3ClientCtor, PutObjectCommandCtor;
try {
  const s3 = await import('@aws-sdk/client-s3');
  S3ClientCtor = s3.S3Client;
  PutObjectCommandCtor = s3.PutObjectCommand;
} catch {
  S3ClientCtor = null;
}

export function setS3ClientForTests(clientCtor, putObjectCommandCtor) {
  S3ClientCtor = clientCtor;
  PutObjectCommandCtor = putObjectCommandCtor;
}

export function resetS3ClientForTests() {
  S3ClientCtor = null;
  PutObjectCommandCtor = null;
}

const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const maxBytes = 5 * 1024 * 1024;

function safeExtension(filename, contentType) {
  const ext = extname(filename || '').toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) return ext;
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/jpeg') return '.jpg';
  if (contentType === 'image/webp') return '.webp';
  if (contentType === 'image/gif') return '.gif';
  return '.bin';
}

function validateUpload({ filename, contentType, dataBase64 }) {
  if (!filename || !contentType || !dataBase64) throw Object.assign(new Error('缺少上传字段'), { status: 400 });
  if (!allowedTypes.has(contentType)) throw Object.assign(new Error('仅支持图片上传'), { status: 415 });
  const buffer = Buffer.from(dataBase64, 'base64');
  if (!buffer.length) throw Object.assign(new Error('上传内容为空'), { status: 400 });
  if (buffer.length > maxBytes) throw Object.assign(new Error('图片不能超过 5MB'), { status: 413 });
  return buffer;
}

function scopedStorageKey(id, filename, contentType, tenantId = 'default') {
  const safeTenant = String(tenantId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safeTenant}/${id}${safeExtension(filename, contentType)}`;
}

function storeLocal(buffer, filename, contentType, tenantId = 'default') {
  const root = resolve(process.env.UPLOAD_DIR || 'uploads');
  const id = `upload-${randomUUID()}`;
  const storageKey = scopedStorageKey(id, filename, contentType, tenantId);
  const target = join(root, storageKey);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, buffer);
  const publicBase = process.env.PUBLIC_UPLOAD_BASE_URL || '/uploads';
  return {
    id,
    filename,
    contentType,
    sizeBytes: buffer.length,
    storageKey,
    url: `${publicBase}/${storageKey}`,
    provider: 'local'
  };
}

async function storeS3(buffer, filename, contentType, tenantId = 'default') {
  const bucket = process.env.S3_BUCKET;
  const region = process.env.S3_REGION || 'us-east-1';
  const endpoint = process.env.S3_ENDPOINT || undefined;
  const id = `upload-${randomUUID()}`;
  const storageKey = scopedStorageKey(id, filename, contentType, tenantId);

  const client = new S3ClientCtor({
    region,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || ''
    }
  });

  await client.send(new PutObjectCommandCtor({
    Bucket: bucket,
    Key: storageKey,
    Body: buffer,
    ContentType: contentType
  }));

  const publicBase = process.env.S3_PUBLIC_URL
    || (endpoint ? `${endpoint}/${bucket}` : `https://${bucket}.s3.${region}.amazonaws.com`);
  return {
    id,
    filename,
    contentType,
    sizeBytes: buffer.length,
    storageKey,
    url: `${publicBase}/${storageKey}`,
    provider: 's3'
  };
}

/**
 * Store an upload — routes to S3 when S3_BUCKET is configured, otherwise local.
 * Returns a plain object for local (sync) or a Promise for S3 (async).
 * The caller should `await` the result for portable code.
 */
export function storeUpload({ filename, contentType, dataBase64, tenantId = 'default' }) {
  const buffer = validateUpload({ filename, contentType, dataBase64 });
  if (S3ClientCtor && process.env.S3_BUCKET) {
    return storeS3(buffer, filename, contentType, tenantId);
  }
  return storeLocal(buffer, filename, contentType, tenantId);
}
