const phones = process.argv.slice(2).map((value) => String(value).trim()).filter(Boolean);
const secret = String(process.env.SMART_CANTEEN_SECRET || '').trim();

if (secret.length < 32) {
  console.error('请先在当前终端设置与目标环境相同、至少 32 字符的 SMART_CANTEEN_SECRET。');
  process.exitCode = 1;
} else if (!phones.length) {
  console.error('用法：npm run pilot:hash-phone -- 13800138000 [第二个手机号]');
  process.exitCode = 1;
} else {
  process.env.NODE_ENV = 'production';
  const { normalizePhone, phoneLookupHash } = await import('../server/security.js');
  let invalid = false;
  for (const value of phones) {
    const phone = normalizePhone(value);
    if (!phone) {
      console.error(`手机号格式无效：${value}`);
      invalid = true;
      continue;
    }
    console.log(phoneLookupHash(phone));
  }
  if (invalid) process.exitCode = 1;
}
