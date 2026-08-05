const usernamePattern = /^[\u4e00-\u9fa5\w-]{2,32}$/;
const phonePattern = /^1[3-9]\d{9}$/;
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export function assertText(value, label, min = 1, max = 120) {
  const text = String(value || '').trim();
  if (text.length < min || text.length > max) throw new Error(`${label}长度需要在 ${min}-${max} 个字符之间。`);
  return text;
}

export function assertNumber(value, label, min = 0, max = 10000) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${label}需要在 ${min}-${max} 之间。`);
  return number;
}

export function parseList(value, label, { required = false } = {}) {
  const list = String(value || '').split(/[，,\s]+/).map((item) => item.trim()).filter(Boolean);
  if (required && !list.length) throw new Error(`${label}至少填写 1 项。`);
  return list;
}

export function validateLoginForm({ identifier, username, password }) {
  const value = String(identifier || username || '').trim();
  if (!phonePattern.test(value) && !usernamePattern.test(value)) return '请输入有效的手机号或账号。';
  if (!password || password.length < 6 || password.length > 72) return '密码长度需要在 6-72 个字符之间。';
  return '';
}

export function validatePhoneAuthForm({ phone, verificationCode, password, confirmPassword }) {
  if (!phonePattern.test(String(phone || '').trim())) return '请输入有效的中国大陆手机号。';
  if (!/^\d{6}$/.test(String(verificationCode || '').trim())) return '请输入 6 位验证码。';
  if (!password || password.length < 8 || password.length > 72 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return '密码需为 8-72 位，且同时包含字母和数字。';
  if (password !== confirmPassword) return '两次输入的密码不一致。';
  return '';
}

export function validateInvitationRegistrationForm({ phone, invitationCode, password, confirmPassword }) {
  if (!phonePattern.test(String(phone || '').trim())) return '请输入有效的中国大陆手机号。';
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(String(invitationCode || '').trim())) return '请输入有效的邀请码。';
  if (!password || password.length < 8 || password.length > 72 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return '密码需为 8-72 位，且同时包含字母和数字。';
  if (password !== confirmPassword) return '两次输入的密码不一致。';
  return '';
}

export function validateReviewForm({ targetId, rating, content }) {
  if (!targetId) return '请选择要评价的菜品。';
  const numericRating = Number(rating);
  if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) return '评分需要在 1-5 分之间。';
  const text = String(content || '').trim();
  if (text.length < 2 || text.length > 240) return '评价内容长度需要在 2-240 个字符之间。';
  return '';
}

export function normalizeProfileInput(form, avoidText = '') {
  const result = {
    ...form,
    budgetMax: assertNumber(form.budgetMax, '预算上限', 8, 200),
    avoid: Array.isArray(form.avoid) ? form.avoid.filter(Boolean) : parseList(avoidText || form.avoid, '忌口食材'),
    allergies: Array.isArray(form.allergies) ? form.allergies.filter(Boolean) : parseList(form.allergies, '过敏原')
  };
  if (!['none', 'declared'].includes(form.allergyStatus)) throw new Error('请明确选择“暂无已知过敏”或填写过敏原。');
  if (form.allergyStatus === 'declared' && !result.allergies.length) throw new Error('选择“有已知过敏原”后请至少填写一项。');
  if (form.allergyStatus === 'none') result.allergies = [];
  return result;
}

export function validateQuestion(text, { min = 4, max = 200, label = '问题' } = {}) {
  const normalized = String(text || '').trim();
  if (normalized.length < min || normalized.length > max) return `${label}长度需要在 ${min}-${max} 个字符之间。`;
  return '';
}

export function validateImageFile(file) {
  if (!file) return '请选择图片文件。';
  if (!imageTypes.has(file.type)) return '仅支持 PNG、JPEG、WebP、GIF 图片。';
  if (file.size > 5 * 1024 * 1024) return '图片不能超过 5MB。';
  return '';
}
