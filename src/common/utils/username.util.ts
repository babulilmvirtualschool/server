/** Allowed LMS usernames: letter or digit first, then letters, digits, dots, underscores; 3–32 chars. */
export const USERNAME_REGEX = /^[a-z0-9][a-z0-9._]{2,31}$/i;

export function normalizeUsernamePart(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** Build e.g. `firstname.lastname` from given names (ASCII slug). */
export function baseUsernameFromNames(firstName: string, lastName: string): string {
  const f = normalizeUsernamePart(firstName).slice(0, 16);
  const l = normalizeUsernamePart(lastName).slice(0, 16);
  if (!f && !l) return 'user';
  if (!f) {
    const one = l || 'user';
    return one.length >= 3 ? one.slice(0, 32) : `${one}usr`.slice(0, 32);
  }
  if (!l) {
    return f.length >= 3 ? f.slice(0, 32) : `${f}usr`.slice(0, 32);
  }
  const combined = `${f}.${l}`.slice(0, 32);
  if (combined.length >= 3) return combined;
  return `${f}${l}usr`.slice(0, 32);
}

export function isValidUsernameFormat(u: string): boolean {
  return USERNAME_REGEX.test(u.trim());
}
