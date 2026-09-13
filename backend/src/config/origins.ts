const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:5173';
const PRODUCTION_FRONTEND_ORIGIN = 'https://tools.mspi.io';

export function getAllowedOrigins(): Set<string> {
  return new Set(
    [
      process.env.FRONTEND_URL?.trim(),
      PRODUCTION_FRONTEND_ORIGIN,
      DEFAULT_FRONTEND_ORIGIN,
    ].filter((origin): origin is string => Boolean(origin)),
  );
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin || getAllowedOrigins().has(origin)) return true;
  if (process.env.NODE_ENV === 'production') return false;

  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:') return false;

    const [first, second] = url.hostname.split('.').map(Number);
    const isPrivateIpv4 = first === 10
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168);

    return isPrivateIpv4 && url.hostname.split('.').length === 4;
  } catch {
    return false;
  }
}
