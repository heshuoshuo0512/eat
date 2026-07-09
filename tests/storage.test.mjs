import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetS3ClientForTests, setS3ClientForTests, storeUpload } from '../server/storage.js';

const pngBase64 = Buffer.from('fake-image').toString('base64');
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
      const upload = await storeUpload({ filename: 'dish.png', contentType: 'image/png', dataBase64: pngBase64, tenantId: 'tenant-a' });
      assert.equal(upload.provider, 'local');
      assert.equal(upload.filename, 'dish.png');
      assert.equal(upload.contentType, 'image/png');
      assert.equal(upload.sizeBytes, Buffer.from(pngBase64, 'base64').length);
      assert.match(upload.storageKey, /^tenant-a\/upload-[\w-]+\.png$/);
      assert.equal(upload.url, `/files/${upload.storageKey}`);
      assert.equal(readFileSync(join(dir, upload.storageKey), 'utf8'), 'fake-image');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sanitizes tenant ids in storage keys', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'smart-canteen-upload-'));
    process.env.UPLOAD_DIR = dir;
    delete process.env.S3_BUCKET;
    try {
      const upload = await storeUpload({ filename: 'dish.jpeg', contentType: 'image/jpeg', dataBase64: pngBase64, tenantId: '../tenant bad' });
      assert.match(upload.storageKey, /^___tenant_bad\/upload-[\w-]+\.jpeg$/);
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

    const upload = await storeUpload({ filename: 'meal.webp', contentType: 'image/webp', dataBase64: pngBase64, tenantId: 'tenant-b' });
    assert.equal(upload.provider, 's3');
    assert.match(upload.storageKey, /^tenant-b\/upload-[\w-]+\.webp$/);
    assert.equal(upload.url, `https://cdn.example.com/bucket/${upload.storageKey}`);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].input.Bucket, 'smart-canteen-uploads');
    assert.equal(sent[0].input.Key, upload.storageKey);
    assert.equal(sent[0].input.ContentType, 'image/webp');
    assert.equal(sent[0].input.Body.toString('utf8'), 'fake-image');
    assert.equal(sent[0].config.endpoint, 'http://minio:9000');
    assert.equal(sent[0].config.forcePathStyle, true);
  });

  it('rejects invalid content type and empty content', () => {
    assert.throws(() => storeUpload({ filename: 'x.pdf', contentType: 'application/pdf', dataBase64: pngBase64 }), /仅支持图片上传/);
    assert.throws(() => storeUpload({ filename: 'x.png', contentType: 'image/png', dataBase64: '' }), /缺少上传字段/);
  });
});
