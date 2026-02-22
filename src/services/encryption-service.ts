/**
 * Encryption Service
 * Handles encryption and decryption of sensitive configuration data
 */

import crypto from 'crypto';
import { getConfig } from '../config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 64;

/**
 * Derive encryption key from secret using PBKDF2
 */
function deriveKey(secret: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(secret, salt, 100000, 32, 'sha256');
}

/**
 * Encrypt sensitive data
 */
export function encrypt(plaintext: string): string {
  const config = getConfig();
  const secret = config.jwt.secret; // Reuse JWT secret for encryption
  
  // Generate random salt and IV
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  // Derive encryption key
  const key = deriveKey(secret, salt);
  
  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  // Encrypt data
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // Get authentication tag
  const authTag = cipher.getAuthTag();
  
  // Combine salt + iv + authTag + encrypted data
  const combined = Buffer.concat([
    salt,
    iv,
    authTag,
    Buffer.from(encrypted, 'hex'),
  ]);
  
  // Return base64 encoded result
  return combined.toString('base64');
}

/**
 * Decrypt sensitive data
 */
export function decrypt(ciphertext: string): string {
  const config = getConfig();
  const secret = config.jwt.secret;
  
  // Decode base64
  const combined = Buffer.from(ciphertext, 'base64');
  
  // Extract components
  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = combined.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
  );
  const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  
  // Derive encryption key
  const key = deriveKey(secret, salt);
  
  // Create decipher
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  // Decrypt data
  let decrypted = decipher.update(encrypted.toString('hex'), 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Encrypt object (converts to JSON first)
 */
export function encryptObject(obj: any): string {
  const json = JSON.stringify(obj);
  return encrypt(json);
}

/**
 * Decrypt object (parses JSON after decryption)
 */
export function decryptObject(ciphertext: string): any {
  const json = decrypt(ciphertext);
  return JSON.parse(json);
}

/**
 * Hash sensitive data (one-way, for comparison only)
 */
export function hash(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}
