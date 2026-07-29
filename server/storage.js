import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSignedUploadUrl } from './security.js';

let S3ClientCtor, PutObjectCommandCtor, GetObjectCommandCtor, DeleteObjectCommandCtor;
try {
  const s3 = await import('@aws-sdk/client-s3');
  S3ClientCtor = s3.S3Client;
  PutObjectCommandCtor = s3.PutObjectCommand;
  GetObjectCommandCtor = s3.GetObjectCommand;
  DeleteObjectCommandCtor = s3.DeleteObjectCommand;
} catch {
  S3ClientCtor = null;
}

export function setS3ClientForTests(clientCtor, putObjectCommandCtor, getObjectCommandCtor = null, deleteObjectCommandCtor = null) {
  S3ClientCtor = clientCtor;
  PutObjectCommandCtor = putObjectCommandCtor;
  GetObjectCommandCtor = getObjectCommandCtor;
  DeleteObjectCommandCtor = deleteObjectCommandCtor;
}

export function resetS3ClientForTests() {
  S3ClientCtor = null;
  PutObjectCommandCtor = null;
  GetObjectCommandCtor = null;
  DeleteObjectCommandCtor = null;
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

function safeSegment(value, fallback) {
  return String(value || fallback).replace(/[^a-zA-Z0-9_-]/g, '_') || fallback;
}

function scopedStorageKey(id, filename, contentType, tenantId = 'default', ownerId = 'system') {
  return `${safeSegment(tenantId, 'default')}/${safeSegment(ownerId, 'system')}/${id}${safeExtension(filename, contentType)}`;
}

function publicMetadata(id) {
  return {
    reference: `upload://${id}`,
    url: createSignedUploadUrl(id),
    visibility: 'private',
    objectVersion: 'v1'
  };
}

function storeLocal(buffer, filename, contentType, tenantId = 'default', ownerId = 'system') {
  const root = resolve(process.env.UPLOAD_DIR || 'uploads');
  const id = `upload-${randomUUID()}`;
  const storageKey = scopedStorageKey(id, filename, contentType, tenantId, ownerId);
  const target = join(root, storageKey);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, buffer);
  return {
    id,
    filename,
    contentType,
    sizeBytes: buffer.length,
    storageKey,
    provider: 'local',
    ...publicMetadata(id)
  };
}

function s3Client() {
  const region = process.env.S3_REGION || 'us-east-1';
  const endpoint = process.env.S3_ENDPOINT || undefined;
  return new S3ClientCtor({
    region,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || ''
    }
  });
}

async function storeS3(buffer, filename, contentType, tenantId = 'default', ownerId = 'system') {
  const bucket = process.env.S3_BUCKET;
  const id = `upload-${randomUUID()}`;
  const storageKey = scopedStorageKey(id, filename, contentType, tenantId, ownerId);
  await s3Client().send(new PutObjectCommandCtor({
    Bucket: bucket,
    Key: storageKey,
    Body: buffer,
    ContentType: contentType
  }));
  return {
    id,
    filename,
    contentType,
    sizeBytes: buffer.length,
    storageKey,
    provider: 's3',
    ...publicMetadata(id)
  };
}

export function storeUpload({ filename, contentType, dataBase64, tenantId = 'default', ownerId = 'system' }) {
  const buffer = validateUpload({ filename, contentType, dataBase64 });
  if (S3ClientCtor && process.env.S3_BUCKET) {
    return storeS3(buffer, filename, contentType, tenantId, ownerId);
  }
  return storeLocal(buffer, filename, contentType, tenantId, ownerId);
}

function safeLocalPath(storageKey) {
  const root = resolve(process.env.UPLOAD_DIR || 'uploads');
  const target = resolve(root, String(storageKey || ''));
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw Object.assign(new Error('上传对象路径无效'), { status: 400, code: 'INVALID_STORAGE_KEY' });
  }
  return target;
}

async function bodyToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body.transformToByteArray === 'function') return Buffer.from(await body.transformToByteArray());
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function readStoredUpload(upload) {
  const provider = upload.storage_provider || upload.storageProvider || 'local';
  if (provider === 's3') {
    if (!S3ClientCtor || !GetObjectCommandCtor || !process.env.S3_BUCKET) {
      throw Object.assign(new Error('对象存储读取未配置'), { status: 503, code: 'STORAGE_NOT_CONFIGURED' });
    }
    const response = await s3Client().send(new GetObjectCommandCtor({
      Bucket: process.env.S3_BUCKET,
      Key: upload.storage_key || upload.storageKey
    }));
    return {
      body: await bodyToBuffer(response.Body),
      contentType: response.ContentType || upload.content_type || upload.contentType || 'application/octet-stream'
    };
  }
  return {
    body: readFileSync(safeLocalPath(upload.storage_key || upload.storageKey)),
    contentType: upload.content_type || upload.contentType || 'application/octet-stream'
  };
}

export async function deleteStoredUpload(upload) {
  const provider = upload.storage_provider || upload.storageProvider || upload.provider || 'local';
  const storageKey = upload.storage_key || upload.storageKey;
  if (provider === 's3') {
    if (!S3ClientCtor || !DeleteObjectCommandCtor || !process.env.S3_BUCKET) {
      throw Object.assign(new Error('对象存储删除未配置'), { status: 503, code: 'STORAGE_NOT_CONFIGURED' });
    }
    await s3Client().send(new DeleteObjectCommandCtor({ Bucket: process.env.S3_BUCKET, Key: storageKey }));
    return;
  }
  const target = safeLocalPath(storageKey);
  if (existsSync(target)) unlinkSync(target);
}
