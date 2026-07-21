/**
 * AES-256-GCM Encryption Utility
 * DPDP Act 2023 Compliant - Encrypts personal data at rest
 * 
 * Uses AES-256-GCM which provides both confidentiality and integrity.
 * Each encryption generates a unique IV ensuring identical plaintext
 * produces different ciphertext every time.
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM recommended IV length
const TAG_LENGTH = 16; // Auth tag length in bytes
const ENCODING = 'base64';

/**
 * Get the encryption key from environment.
 * Key must be exactly 32 bytes (256 bits) for AES-256.
 */
function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  // If key is hex-encoded (64 chars = 32 bytes)
  if (key.length === 64 && /^[0-9a-fA-F]+$/.test(key)) {
    return Buffer.from(key, 'hex');
  }
  // If key is base64-encoded
  if (key.length === 44 && /^[A-Za-z0-9+/=]+$/.test(key)) {
    return Buffer.from(key, 'base64');
  }
  // Use SHA-256 hash of the key string to get exactly 32 bytes
  return crypto.createHash('sha256').update(key).digest();
}

/**
 * Encrypt plaintext using AES-256-GCM
 * @param {string} plaintext - The text to encrypt
 * @returns {string} - Base64 encoded string containing IV + AuthTag + Ciphertext
 */
function encrypt(plaintext) {
  if (!plaintext) return null;
  
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  const authTag = cipher.getAuthTag();
  
  // Combine IV + AuthTag + Ciphertext into single buffer
  const combined = Buffer.concat([iv, authTag, encrypted]);
  
  return combined.toString(ENCODING);
}

/**
 * Decrypt ciphertext using AES-256-GCM
 * @param {string} encryptedData - Base64 encoded string containing IV + AuthTag + Ciphertext
 * @returns {string} - Decrypted plaintext
 */
function decrypt(encryptedData) {
  if (!encryptedData) return null;
  
  try {
    const key = getKey();
    const combined = Buffer.from(encryptedData, ENCODING);
    
    // Extract IV, AuthTag, and Ciphertext
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = combined.subarray(IV_LENGTH + TAG_LENGTH);
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString('utf8');
  } catch (error) {
    // If decryption fails, the data might be stored unencrypted (legacy)
    // Return as-is for backward compatibility during migration
    console.warn('⚠️ Decryption failed, returning raw value (possible unencrypted legacy data)');
    return encryptedData;
  }
}

/**
 * Check if a string appears to be encrypted (base64 with expected minimum length)
 * @param {string} data - The string to check
 * @returns {boolean}
 */
function isEncrypted(data) {
  if (!data) return false;
  try {
    const buf = Buffer.from(data, ENCODING);
    // Minimum: IV (12) + AuthTag (16) + at least 1 byte ciphertext = 29 bytes
    return buf.length >= 29 && data !== Buffer.from(data, 'utf8').toString(ENCODING);
  } catch {
    return false;
  }
}

module.exports = {
  encrypt,
  decrypt,
  isEncrypted
};
