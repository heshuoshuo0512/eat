import { isIP } from 'node:net';

function normalizeAddress(value) {
  const address = String(value || '').trim().replace(/^\[|\]$/g, '');
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

function ipv4ToBigInt(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.reduce((value, part) => (value << 8n) + BigInt(part), 0n);
}

function ipv6ToBigInt(address) {
  let normalized = address.toLowerCase().split('%')[0];
  if (normalized.includes('.')) {
    const lastColon = normalized.lastIndexOf(':');
    const ipv4 = ipv4ToBigInt(normalized.slice(lastColon + 1));
    if (ipv4 == null) return null;
    normalized = `${normalized.slice(0, lastColon)}:${Number((ipv4 >> 16n) & 0xffffn).toString(16)}:${Number(ipv4 & 0xffffn).toString(16)}`;
  }
  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const parts = [...left, ...Array(missing).fill('0'), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.reduce((value, part) => (value << 16n) + BigInt(`0x${part}`), 0n);
}

function addressValue(address) {
  const normalized = normalizeAddress(address);
  const version = isIP(normalized);
  if (version === 4) return { version, bits: 32, value: ipv4ToBigInt(normalized) };
  if (version === 6) return { version, bits: 128, value: ipv6ToBigInt(normalized) };
  return null;
}

export function addressInCidr(address, cidr) {
  const [networkRaw, prefixRaw] = String(cidr || '').trim().split('/');
  const addressData = addressValue(address);
  const networkData = addressValue(networkRaw);
  if (!addressData || !networkData || addressData.version !== networkData.version) return false;
  const prefix = prefixRaw === undefined ? addressData.bits : Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > addressData.bits) return false;
  if (prefix === 0) return true;
  const shift = BigInt(addressData.bits - prefix);
  return (addressData.value >> shift) === (networkData.value >> shift);
}

export function trustedProxyCidrs(env = process.env) {
  return [
    '127.0.0.0/8',
    '::1/128',
    ...String(env.TRUSTED_PROXY_CIDRS || '').split(',').map((item) => item.trim()).filter(Boolean)
  ];
}

export function isTrustedProxy(address, cidrs = trustedProxyCidrs()) {
  return cidrs.some((cidr) => addressInCidr(address, cidr));
}

export function clientIpFromRequest(req, cidrs = trustedProxyCidrs()) {
  const remote = normalizeAddress(req.socket?.remoteAddress || '');
  if (!isTrustedProxy(remote, cidrs)) return remote || 'local';

  const forwarded = String(req.headers?.['x-forwarded-for'] || '')
    .split(',')
    .map(normalizeAddress)
    .filter((address) => isIP(address));
  if (!forwarded.length) return remote || 'local';

  const chain = [...forwarded, remote];
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    if (!isTrustedProxy(chain[index], cidrs)) return chain[index];
  }
  return chain[0];
}
