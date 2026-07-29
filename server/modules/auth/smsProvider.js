const DEFAULT_TIMEOUT_MS = 8_000;

function configuredProvider(env = process.env) {
  return String(env.SMS_PROVIDER || 'disabled').trim().toLowerCase();
}

function timeoutMs(env = process.env) {
  const value = Number(env.SMS_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 1_000 && value <= 60_000 ? value : DEFAULT_TIMEOUT_MS;
}

function configurationError(message, code = 'SMS_PROVIDER_NOT_CONFIGURED') {
  return Object.assign(new Error(message), { status: 503, code });
}

export function getSmsProviderStatus(env = process.env) {
  if (env.NODE_ENV === 'test') return { provider: 'test', ready: true };

  const provider = configuredProvider(env);
  if (provider === 'webhook') {
    const endpoint = String(env.SMS_WEBHOOK_URL || '').trim();
    const templateId = String(env.SMS_TEMPLATE_ID || '').trim();
    const signName = String(env.SMS_SIGN_NAME || '').trim();
    return {
      provider,
      ready: Boolean(endpoint && templateId && signName),
      missing: [
        ...(endpoint ? [] : ['SMS_WEBHOOK_URL']),
        ...(templateId ? [] : ['SMS_TEMPLATE_ID']),
        ...(signName ? [] : ['SMS_SIGN_NAME'])
      ]
    };
  }

  return { provider: provider || 'disabled', ready: false, missing: ['SMS_PROVIDER'] };
}

export async function sendSmsVerificationCode({ phone, code, purpose }, {
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const status = getSmsProviderStatus(env);
  if (!status.ready) {
    const missing = status.missing?.length ? `（缺少 ${status.missing.join('、')}）` : '';
    throw configurationError(`短信服务尚未配置${missing}`);
  }

  if (status.provider === 'test') return { accepted: true, provider: 'test', testCode: code };
  if (status.provider !== 'webhook') throw configurationError('当前短信服务商不受支持');
  if (typeof fetchImpl !== 'function') throw configurationError('当前运行环境不支持短信网络请求', 'SMS_PROVIDER_UNAVAILABLE');

  let response;
  try {
    response = await fetchImpl(String(env.SMS_WEBHOOK_URL).trim(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(String(env.SMS_WEBHOOK_AUTHORIZATION || '').trim()
          ? { Authorization: String(env.SMS_WEBHOOK_AUTHORIZATION).trim() }
          : {})
      },
      body: JSON.stringify({
        phone,
        code,
        purpose,
        signName: String(env.SMS_SIGN_NAME).trim(),
        templateId: String(env.SMS_TEMPLATE_ID).trim()
      }),
      signal: AbortSignal.timeout(timeoutMs(env))
    });
  } catch {
    throw Object.assign(new Error('短信服务暂时不可用，请稍后重试'), { status: 502, code: 'SMS_PROVIDER_UNAVAILABLE' });
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.accepted === false) {
    throw Object.assign(new Error(payload.message || '短信发送失败，请稍后重试'), {
      status: 502,
      code: 'SMS_PROVIDER_REJECTED'
    });
  }

  return {
    accepted: true,
    provider: status.provider,
    messageId: String(payload.messageId || payload.requestId || '').slice(0, 128)
  };
}
