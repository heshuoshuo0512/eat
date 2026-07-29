import Busboy from 'busboy';

export function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

export async function readJson(req, maxBytes = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('请求内容过大'), { status: 413, code: 'BODY_TOO_LARGE' });
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('JSON 格式无效'), { status: 400, code: 'INVALID_JSON' });
  }
}

export function readMultipart(req, { maxFileBytes = 5 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = Busboy({ headers: req.headers, limits: { files: 1, fileSize: maxFileBytes, fields: 10, fieldSize: 8 * 1024 } });
    } catch {
      reject(Object.assign(new Error('需要 multipart/form-data 请求'), { status: 415, code: 'MULTIPART_REQUIRED' }));
      return;
    }
    const fields = {};
    let file = null;
    let fileLimit = false;
    parser.on('field', (name, value) => { fields[name] = value; });
    parser.on('file', (_name, stream, info) => {
      const chunks = [];
      stream.on('limit', () => { fileLimit = true; });
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => { file = { buffer: Buffer.concat(chunks), filename: info.filename, contentType: info.mimeType }; });
    });
    parser.on('error', reject);
    parser.on('finish', () => {
      if (fileLimit) reject(Object.assign(new Error('图片不能超过 5MB'), { status: 413, code: 'IMAGE_TOO_LARGE' }));
      else if (!file) reject(Object.assign(new Error('请选择一张图片'), { status: 400, code: 'IMAGE_REQUIRED' }));
      else resolve({ fields, file });
    });
    req.pipe(parser);
  });
}
