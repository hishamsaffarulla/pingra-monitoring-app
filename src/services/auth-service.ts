/**
 * Authentication Service
 * Handles JWT token generation, validation, and session management
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { getConfig } from '../config';
import { getDatabaseManager } from '../database/connection';
import { JWTPayload, LoginRequest, LoginResponse, Tenant } from '../types';
import { logger } from '../utils/logger';
import { verifyTotp } from '../utils/totp';

const SALT_ROUNDS = 10;
const TOKEN_BLACKLIST_PREFIX = 'blacklist:token:';
const SESSION_PREFIX = 'session:';
const REFRESH_TOKEN_PREFIX = 'refresh:';

/**
 * Get Redis client helper
 */
function getRedisClient() {
  return getDatabaseManager().getRedisClient();
}

export interface User {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  name?: string | null;
  role?: string | null;
  phone?: string | null;
  alertPreferences?: string[] | null;
  status?: string | null;
  mfaEnabled?: boolean | null;
  mfaSecret?: string | null;
  createdAt: Date;
  updatedAt?: Date;
}

/**
 * Generate JWT access token
 */
export function generateAccessToken(userId: string, tenantId: string): string {
  const config = getConfig();
  const payload: Omit<JWTPayload, 'exp' | 'iat'> = {
    userId,
    tenantId,
  };

  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  } as jwt.SignOptions);
}

/**
 * Generate JWT refresh token
 */
export function generateRefreshToken(userId: string, tenantId: string): string {
  const config = getConfig();
  const payload: Omit<JWTPayload, 'exp' | 'iat'> = {
    userId,
    tenantId,
  };

  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.refreshExpiresIn,
  } as jwt.SignOptions);
}

/**
 * Verify and decode JWT token
 */
export function verifyToken(token: string): JWTPayload {
  const config = getConfig();
  
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as JWTPayload;
    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token expired');
    } else if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid token');
    }
    throw error;
  }
}

/**
 * Check if token is blacklisted
 */
export async function isTokenBlacklisted(token: string): Promise<boolean> {
  const redis = getRedisClient();
  const key = `${TOKEN_BLACKLIST_PREFIX}${token}`;
  const result = await redis.get(key);
  return result !== null;
}

/**
 * Blacklist a token (for logout)
 */
export async function blacklistToken(token: string, expiresIn: number): Promise<void> {
  const redis = getRedisClient();
  const key = `${TOKEN_BLACKLIST_PREFIX}${token}`;
  
  // Store in blacklist until token would naturally expire
  await redis.setEx(key, expiresIn, '1');
  logger.info('Token blacklisted', { key });
}

/**
 * Store session in Redis
 */
export async function storeSession(userId: string, tenantId: string, token: string): Promise<void> {
  const redis = getRedisClient();
  const config = getConfig();
  const key = `${SESSION_PREFIX}${userId}`;
  
  const sessionData = {
    userId,
    tenantId,
    token,
    createdAt: new Date().toISOString(),
  };

  await redis.setEx(key, config.redis.sessionTTL, JSON.stringify(sessionData));
  logger.info('Session stored', { userId, tenantId });
}

/**
 * Get session from Redis
 */
export async function getSession(userId: string): Promise<any | null> {
  const redis = getRedisClient();
  const key = `${SESSION_PREFIX}${userId}`;
  
  const data = await redis.get(key);
  if (!data) {
    return null;
  }

  return JSON.parse(data);
}

/**
 * Delete session from Redis
 */
export async function deleteSession(userId: string): Promise<void> {
  const redis = getRedisClient();
  const key = `${SESSION_PREFIX}${userId}`;
  
  await redis.del(key);
  logger.info('Session deleted', { userId });
}

/**
 * Store refresh token in Redis
 */
export async function storeRefreshToken(userId: string, refreshToken: string): Promise<void> {
  const redis = getRedisClient();
  const key = `${REFRESH_TOKEN_PREFIX}${userId}`;
  
  // Parse refresh token expiry
  const decoded = jwt.decode(refreshToken) as JWTPayload;
  const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);

  await redis.setEx(key, expiresIn, refreshToken);
  logger.info('Refresh token stored', { userId });
}

/**
 * Get refresh token from Redis
 */
export async function getRefreshToken(userId: string): Promise<string | null> {
  const redis = getRedisClient();
  const key = `${REFRESH_TOKEN_PREFIX}${userId}`;
  
  return await redis.get(key);
}

/**
 * Delete refresh token from Redis
 */
export async function deleteRefreshToken(userId: string): Promise<void> {
  const redis = getRedisClient();
  const key = `${REFRESH_TOKEN_PREFIX}${userId}`;
  
  await redis.del(key);
  logger.info('Refresh token deleted', { userId });
}

/**
 * Hash password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify password against hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}

/**
 * Authenticate user and generate tokens
 */
export async function login(
  credentials: LoginRequest,
  getUserByEmail: (email: string) => Promise<User | null>,
  getTenantById: (tenantId: string) => Promise<Tenant | null>
): Promise<LoginResponse> {
  const { email, password, otp } = credentials;

  // Find user by email
  const user = await getUserByEmail(email);
  if (!user) {
    throw new Error('Invalid credentials');
  }

  // Verify password
  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    throw new Error('Invalid credentials');
  }

  // Enforce MFA when enabled for the account
  if (user.mfaEnabled) {
    if (!user.mfaSecret) {
      throw new Error('MFA not configured');
    }
    if (!otp) {
      throw new Error('MFA code required');
    }
    if (!verifyTotp(user.mfaSecret, otp)) {
      throw new Error('Invalid MFA code');
    }
  }

  // Get tenant information
  const tenant = await getTenantById(user.tenantId);
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Generate tokens
  const accessToken = generateAccessToken(user.id, user.tenantId);
  const refreshToken = generateRefreshToken(user.id, user.tenantId);

  // Store session and refresh token
  await storeSession(user.id, user.tenantId, accessToken);
  await storeRefreshToken(user.id, refreshToken);

  // Calculate expiry
  const decoded = jwt.decode(accessToken) as JWTPayload;
  const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);

  logger.info('User logged in', { userId: user.id, tenantId: user.tenantId });

  return {
    token: accessToken,
    refreshToken,
    expiresIn,
    tenant,
  };
}

/**
 * Logout user and invalidate tokens
 */
export async function logout(token: string, userId: string): Promise<void> {
  // Decode token to get expiry
  const decoded = jwt.decode(token) as JWTPayload;
  const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);

  // Blacklist the access token
  if (expiresIn > 0) {
    await blacklistToken(token, expiresIn);
  }

  // Delete session and refresh token
  await deleteSession(userId);
  await deleteRefreshToken(userId);

  logger.info('User logged out', { userId });
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<{ token: string; expiresIn: number }> {
  // Verify refresh token
  const decoded = verifyToken(refreshToken);

  // Check if refresh token exists in Redis
  const storedToken = await getRefreshToken(decoded.userId);
  if (!storedToken || storedToken !== refreshToken) {
    throw new Error('Invalid refresh token');
  }

  // Generate new access token
  const newAccessToken = generateAccessToken(decoded.userId, decoded.tenantId);

  // Update session with new token
  await storeSession(decoded.userId, decoded.tenantId, newAccessToken);

  // Calculate expiry
  const newDecoded = jwt.decode(newAccessToken) as JWTPayload;
  const expiresIn = newDecoded.exp - Math.floor(Date.now() / 1000);

  logger.info('Access token refreshed', { userId: decoded.userId });

  return {
    token: newAccessToken,
    expiresIn,
  };
}
