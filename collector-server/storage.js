import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

let aws;

async function awsSdk() {
  if (!aws) aws = await import('@aws-sdk/client-s3');
  return aws;
}

function localRoot() {
  return resolve(process.env.COLLECTOR_UPLOAD_DIR || 'collector-data/uploads');
}

function safeLocalPath(key) {
  const root = localRoot();
  const target = resolve(root, String(key || ''));
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw Object.assign(new Error('对象路径无效'), { status: 400, code: 'INVALID_OBJECT_KEY' });
  }
  return target;
}

function storageKey(contributorId, objectId) {
  return `${String(contributorId).replace(/[^a-zA-Z0-9_-]/g, '_')}/${objectId}.jpg`;
}

function s3Config() {
  return {
    bucket: process.env.COLLECTOR_S3_BUCKET || '',
    region: process.env.COLLECTOR_S3_REGION || 'us-east-1',
    endpoint: process.env.COLLECTOR_S3_ENDPOINT || undefined,
    accessKeyId: process.env.COLLECTOR_S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.COLLECTOR_S3_SECRET_ACCESS_KEY || '',
  };
}

async function s3Client() {
  const sdk = await awsSdk();
  const config = s3Config();
  return new sdk.S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
}

export async function storeCollectorObject({ contributorId, objectId, buffer }) {
  const key = storageKey(contributorId, objectId);
  const config = s3Config();
  if (config.bucket) {
    const sdk = await awsSdk();
    await (await s3Client()).send(new sdk.PutObjectCommand({ Bucket: config.bucket, Key: key, Body: buffer, ContentType: 'image/jpeg' }));
    return { provider: 's3', key };
  }
  const target = safeLocalPath(key);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buffer);
  return { provider: 'local', key };
}

export async function readCollectorObject({ storageProvider, storageKey }) {
  if (storageProvider === 's3') {
    const sdk = await awsSdk();
    const response = await (await s3Client()).send(new sdk.GetObjectCommand({ Bucket: s3Config().bucket, Key: storageKey }));
    return Buffer.from(await response.Body.transformToByteArray());
  }
  return readFile(safeLocalPath(storageKey));
}

export async function deleteCollectorObject({ storageProvider, storageKey }) {
  if (storageProvider === 's3') {
    const sdk = await awsSdk();
    await (await s3Client()).send(new sdk.DeleteObjectCommand({ Bucket: s3Config().bucket, Key: storageKey }));
    return;
  }
  await unlink(safeLocalPath(storageKey)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
