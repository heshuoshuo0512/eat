const CONFIDENCE_LABELS = Object.freeze({ high: '高可信', medium: '中等可信', low: '低可信' });

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function normalizedSafety(item = {}) {
  if (item.safety?.status) return item.safety;
  const metadata = item.metadata || {};
  if (metadata.safetyStatus) {
    return {
      status: metadata.safetyStatus,
      unknownAllergens: asList(metadata.unknownAllergens),
      matchedAllergens: asList(metadata.matchedAllergens),
    };
  }
  const declarations = asList(item.safetyDeclarations || item.facts?.declarations);
  if (declarations.some((entry) => ['confirmed_present', 'cross_contact_possible'].includes(entry.status))) {
    return { status: 'declared', declarations };
  }
  if (!declarations.length || declarations.some((entry) => entry.status === 'unknown')) {
    return { status: 'unknown', declarations };
  }
  if (declarations.some((entry) => entry.status === 'confirmed_absent')) {
    return { status: 'confirmed_absent', declarations };
  }
  return { status: 'not_applicable', declarations };
}

export function confidencePresentation(value = {}) {
  const confidence = value.confidence || value;
  const level = ['high', 'medium', 'low'].includes(confidence?.level) ? confidence.level : '';
  if (!level) return null;
  const score = Number(confidence.score);
  return {
    level,
    tone: level === 'high' ? 'positive' : level === 'medium' ? 'caution' : 'muted',
    label: CONFIDENCE_LABELS[level],
    detail: Number.isFinite(score) ? `综合依据 ${Math.round(Math.max(0, Math.min(1, score)) * 100)}%` : '综合检索与数据质量',
  };
}

export function safetyPresentation(item = {}) {
  const safety = normalizedSafety(item);
  const unknown = asList(safety.unknownAllergens);
  const matched = asList(safety.matchedAllergens);
  if (safety.status === 'blocked' || safety.status === 'declared') {
    return {
      status: safety.status,
      tone: 'danger',
      label: '存在过敏风险',
      detail: matched.length ? `命中：${matched.join('、')}` : '配方含已声明过敏原或存在交叉接触风险',
    };
  }
  if (safety.status === 'unknown') {
    return {
      status: 'unknown',
      tone: 'warning',
      label: '过敏信息未确认',
      detail: unknown.length ? `${unknown.join('、')}尚未核验，请在档口现场确认` : '数据库尚未确认，请在档口现场核实配方与交叉接触风险',
    };
  }
  if (safety.status === 'confirmed_absent') {
    return { status: 'confirmed_absent', tone: 'positive', label: '相关过敏原已核验不含', detail: '仍请以档口当日配方为准' };
  }
  return null;
}

export function factMetaPresentation(item = {}) {
  const quality = item.dataQuality || {};
  const source = quality.source || item.factSource || item.metadata?.source || '';
  const dataVersion = quality.dataVersion || item.dataVersion || item.metadata?.dataVersion || '';
  const verifiedAt = quality.verifiedAt || item.factVerifiedAt || null;
  if (!source && !dataVersion && !verifiedAt) return null;
  const date = verifiedAt && !Number.isNaN(Date.parse(verifiedAt)) ? new Date(verifiedAt).toLocaleDateString('zh-CN') : '';
  return ['来源：' + (source || '未标注'), date ? `核验：${date}` : '尚无核验时间', dataVersion ? `版本：${dataVersion}` : ''].filter(Boolean).join(' · ');
}

export function ragPresentation(item = {}) {
  return {
    confidence: confidencePresentation(item),
    safety: safetyPresentation(item),
    factMeta: factMetaPresentation(item),
  };
}
