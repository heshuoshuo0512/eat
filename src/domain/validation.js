const usernamePattern = /^[\u4e00-\u9fa5\w-]{2,32}$/;
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

export function validateLoginForm({ username, password }) {
  if (!usernamePattern.test(username || '')) return '用户名只能包含中文、字母、数字、下划线或短横线，长度 2-32。';
  if (!password || password.length < 6 || password.length > 72) return '密码长度需要在 6-72 个字符之间。';
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
  return {
    ...form,
    budgetMax: assertNumber(form.budgetMax, '预算上限', 8, 200),
    avoid: parseList(avoidText, '忌口食材')
  };
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

export function validateStall(body) {
  if (!body.canteenId) return '请选择所属食堂。';
  if (!String(body.name || '').trim()) return '请输入档口名称。';
  if (!String(body.floor || '').trim()) return '请输入楼层。';
  if (!String(body.category || '').trim()) return '请输入分类。';
  return '';
}

export function validateEnvironment(body) {
  const temp = Number(body.temperature);
  if (!Number.isFinite(temp) || temp < -40 || temp > 55) return '温度需要在 -40 到 55 之间。';
  if (!String(body.weatherLabel || '').trim()) return '请输入天气标签。';
  return '';
}

export function validateDishPreferences(body) {
  if (body.favorite !== undefined && ![0, 1, true, false].includes(body.favorite)) return 'favorite 必须是布尔或 0/1。';
  return '';
}
