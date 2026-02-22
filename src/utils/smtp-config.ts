import { decrypt, encrypt } from '../services/encryption-service';

export interface ResolvedSmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  from: string;
}

export interface PublicSmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  from: string;
  hasPassword: boolean;
}

function parsePort(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
}

function decryptPassword(value: unknown): string {
  if (!value || typeof value !== 'string') return '';
  try {
    return decrypt(value);
  } catch {
    return '';
  }
}

export function readStoredSmtpConfig(config: Record<string, any> = {}): {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  from: string;
  password: string;
  hasStoredPassword: boolean;
} {
  const smtp = (config['smtp'] || {}) as Record<string, any>;
  const host = String(smtp['host'] || '');
  const port = parsePort(smtp['port'], 587);
  const secure = !!smtp['secure'];
  const username = String(smtp['username'] || '');
  const from = String(smtp['from'] || '');
  const encrypted = smtp['passwordEncrypted'];
  const legacyPlain = typeof smtp['password'] === 'string' ? smtp['password'] : '';
  const decrypted = decryptPassword(encrypted);
  const password = decrypted || legacyPlain;
  const hasStoredPassword = !!(encrypted || legacyPlain);

  return { host, port, secure, username, from, password, hasStoredPassword };
}

export function resolveSmtpConfig(config: Record<string, any> = {}): ResolvedSmtpConfig | null {
  const stored = readStoredSmtpConfig(config);

  const host = stored.host || process.env['SMTP_HOST'] || '';
  const port = parsePort(stored.port || process.env['SMTP_PORT'], 587);
  const secure = stored.secure || process.env['SMTP_SECURE'] === 'true';
  const username = stored.username || process.env['SMTP_USER'] || '';
  const password = stored.password || process.env['SMTP_PASS'] || '';
  const from = stored.from || process.env['SMTP_FROM'] || '';

  if (!host || !username || !password || !from) return null;

  return {
    host,
    port,
    secure,
    username,
    password,
    from,
  };
}

export function toPublicSmtpConfig(config: Record<string, any> = {}): PublicSmtpConfig {
  const stored = readStoredSmtpConfig(config);
  const resolved = resolveSmtpConfig(config);

  return {
    host: stored.host || (resolved ? resolved.host : ''),
    port: stored.port || (resolved ? resolved.port : 587),
    secure: stored.secure || (resolved ? resolved.secure : false),
    username: stored.username || (resolved ? resolved.username : ''),
    from: stored.from || (resolved ? resolved.from : ''),
    hasPassword: stored.hasStoredPassword || !!process.env['SMTP_PASS'],
  };
}

export function mergeAndStoreSmtpConfig(
  currentConfig: Record<string, any>,
  incoming: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    from: string;
    password?: string;
  }
): Record<string, any> {
  const current = readStoredSmtpConfig(currentConfig);
  const nextPassword = (incoming.password || '').trim();

  const smtp: Record<string, any> = {
    host: incoming.host.trim(),
    port: parsePort(incoming.port, 587),
    secure: !!incoming.secure,
    username: incoming.username.trim(),
    from: incoming.from.trim(),
  };

  if (nextPassword) {
    smtp['passwordEncrypted'] = encrypt(nextPassword);
  } else if (current.hasStoredPassword) {
    const existing = ((currentConfig['smtp'] || {}) as Record<string, any>)['passwordEncrypted'];
    if (existing) smtp['passwordEncrypted'] = existing;
    const legacy = ((currentConfig['smtp'] || {}) as Record<string, any>)['password'];
    if (!existing && legacy) smtp['passwordEncrypted'] = encrypt(String(legacy));
  }

  return {
    ...currentConfig,
    ['smtp']: smtp,
  };
}
