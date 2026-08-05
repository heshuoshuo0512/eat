import { createHash, randomInt } from 'node:crypto';

export const INVITATION_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{7,63}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeInvitationCode(value) {
  return String(value || '').trim().toUpperCase();
}

export function isValidInvitationCode(value) {
  return INVITATION_CODE_PATTERN.test(normalizeInvitationCode(value));
}

export function invitationCodeHash(value) {
  return createHash('sha256').update(normalizeInvitationCode(value), 'utf8').digest('hex');
}

export function generateInvitationCode(length = 16) {
  const size = Math.max(8, Math.min(Number(length) || 16, 64));
  let code = '';
  for (let index = 0; index < size; index += 1) code += ALPHABET[randomInt(0, ALPHABET.length)];
  return code;
}
