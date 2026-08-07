import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deleteStoredUpload, resetS3ClientForTests, setS3ClientForTests, storeUpload } from '../server/storage.js';
import sharp from 'sharp';

// A real 1x1 PNG keeps these tests aligned with server-side decode validation.
const imageSource = sharp({ create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 255, b: 255 } } });
const pngBytes = await imageSource.clone().png().toBuffer();
const jpegBytes = await imageSource.clone().jpeg().toBuffer();
const webpBytes = await imageSource.clone().webp().toBuffer();
const pngBase64 = pngBytes.toString('base64');
const jpegBase64 = jpegBytes.toString('base64');
const webpBase64 = webpBytes.toString('base64');
const originalEnv = { ...process.env };

afterEach(() => {
  resetS3ClientForTests();
  process.env = { ...originalEnv };
});

describe('storage adapter tenant-scoped contracts', () => {
  it('stores local uploads under tenant-scoped keys and returns metadata', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'smart-canteen-upload-'));
    process.env.UPLOAD_DIR = dir;
    process.env.PUBLIC_UPLOAD_BASE_URL = '/files';
    delete process.env.S3_BUCKET;
    try {
      const upload = await storeUpload({ filename: 'dish.png', contentType: 'image/png', dataBase64: pngBase64, tenantId: 'tenant-a', ownerId: 'user-a' });
      assert.equal(upload.provider, 'local');
      assert.equal(upload.filename, 'dish.png');
      assert.equal(upload.contentType, 'image/png');
      assert.equal(upload.sizeBytes, pngBytes.length);
      assert.match(upload.storageKey, /^tenant-a\/user-a\/upload-[\w-]+\.png$/);
      assert.equal(upload.reference, `upload://${upload.id}`);
      assert.match(upload.url, new RegExp(`^/api/uploads/${upload.id}/content\\?expires=\\d+&signature=`));
      assert.equal(upload.visibility, 'private');
      assert.deepEqual(readFileSync(join(dir, upload.storageKey)), pngBytes);
      await deleteStoredUpload(upload);
      assert.equal(existsSync(join(dir, upload.storageKey)), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sanitizes tenant ids in storage keys', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'smart-canteen-upload-'));
    process.env.UPLOAD_DIR = dir;
    delete process.env.S3_BUCKET;
    try {
      const upload = await storeUpload({ filename: 'dish.jpeg', contentType: 'image/jpeg', dataBase64: jpegBase64, tenantId: '../tenant bad', ownerId: '../user bad' });
      assert.match(upload.storageKey, /^___tenant_bad\/___user_bad\/upload-[\w-]+\.jpeg$/);
      assert.doesNotMatch(upload.storageKey, /\.\./);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('routes to S3 when S3_BUCKET is configured and keeps tenant prefix', async () => {
    const sent = [];
    class FakePutObjectCommand {
      constructor(input) { this.input = input; }
    }
    class FakeS3Client {
      constructor(config) { this.config = config; }
      async send(command) { sent.push({ config: this.config, input: command.input }); }
    }
    setS3ClientForTests(FakeS3Client, FakePutObjectCommand);
    process.env.S3_BUCKET = 'smart-canteen-uploads';
    process.env.S3_REGION = 'ap-east-1';
    process.env.S3_ENDPOINT = 'http://minio:9000';
    process.env.S3_ACCESS_KEY_ID = 'key';
    process.env.S3_SECRET_ACCESS_KEY = 'secret';
    process.env.S3_PUBLIC_URL = 'https://cdn.example.com/bucket';

    const upload = await storeUpload({ filename: 'meal.webp', contentType: 'image/webp', dataBase64: webpBase64, tenantId: 'tenant-b', ownerId: 'user-b' });
    assert.equal(upload.provider, 's3');
    assert.match(upload.storageKey, /^tenant-b\/user-b\/upload-[\w-]+\.webp$/);
    assert.equal(upload.reference, `upload://${upload.id}`);
    assert.match(upload.url, /^\/api\/uploads\/upload-[\w-]+\/content\?expires=\d+&signature=/);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].input.Bucket, 'smart-canteen-uploads');
    assert.equal(sent[0].input.Key, upload.storageKey);
    assert.equal(sent[0].input.ContentType, 'image/webp');
    assert.deepEqual(sent[0].input.Body, webpBytes);
    assert.equal(sent[0].config.endpoint, 'http://minio:9000');
    assert.equal(sent[0].config.forcePathStyle, true);
  });

  it('deletes S3 uploads with the same tenant-scoped object key', async () => {
    const sent = [];
    class FakePutObjectCommand { constructor(input) { this.input = input; } }
    class FakeDeleteObjectCommand { constructor(input) { this.input = input; } }
    class FakeS3Client {
      async send(command) { sent.push(command.input); }
    }
    setS3ClientForTests(FakeS3Client, FakePutObjectCommand, null, FakeDeleteObjectCommand);
    process.env.S3_BUCKET = 'smart-canteen-uploads';
    process.env.S3_ACCESS_KEY_ID = 'key';
    process.env.S3_SECRET_ACCESS_KEY = 'secret';

    const upload = await storeUpload({ filename: 'meal.webp', contentType: 'image/webp', dataBase64: webpBase64, tenantId: 'tenant-b', ownerId: 'user-b' });
    await deleteStoredUpload(upload);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[1], { Bucket: 'smart-canteen-uploads', Key: upload.storageKey });
  });

  it('rejects invalid content type and empty content', async () => {
    await assert.rejects(() => storeUpload({ filename: 'x.pdf', contentType: 'application/pdf', dataBase64: pngBase64 }), /仅支持图片上传/);
    await assert.rejects(() => storeUpload({ filename: 'x.png', contentType: 'image/png', dataBase64: '' }), /缺少上传字段/);
  });
});
