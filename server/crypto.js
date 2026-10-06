const crypto = require('crypto');
try { require('dotenv').config(); } catch (e) {}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

const DEFAULT_KEY_HEX = '815125701ab168789636b04b231f30dc6af0c5e72e17d4fbb57f1ce2dcde4d6a';

function getEncryptionKey() {
    const rawKey = process.env.ENCRYPTION_KEY;
    if (!rawKey) {
        console.warn('[SECURITY] Warning: ENCRYPTION_KEY environment variable not set. Falling back to default database key.');
        return Buffer.from(DEFAULT_KEY_HEX, 'hex');
    }
    if (rawKey.length !== 64) {
        console.warn('[SECURITY] Warning: Invalid ENCRYPTION_KEY length (expected 64 hex chars). Falling back to default database key.');
        return Buffer.from(DEFAULT_KEY_HEX, 'hex');
    }
    return Buffer.from(rawKey, 'hex');
}

const ENCRYPTION_KEY = getEncryptionKey();

/**
 * Encrypts a plain text string.
 * @param {string} text - The plain text string (e.g. JSON.stringify data)
 * @returns {string} - The encrypted string in format: iv:authTag:encryptedContent
 */
function encryptData(text) {
    if (!ENCRYPTION_KEY) {
        throw new Error('ENCRYPTION_KEY is not set in environment variables');
    }
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag().toString('hex');
    
    // Format: iv:authTag:encryptedContent
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an encrypted string.
 * @param {string} encryptedText - The string formatted as iv:authTag:encryptedContent
 * @returns {string} - The decrypted plain text string
 */
function decryptData(encryptedText) {
    if (!ENCRYPTION_KEY) {
        throw new Error('ENCRYPTION_KEY is not set in environment variables');
    }
    
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted text format. Expected iv:authTag:encryptedContent');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedContent = parts[2];
    
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedContent, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
}

/**
 * Helper to check if a string is encrypted using our format.
 * Since JSON starts with '{' or '[', and our format starts with hex string for IV, 
 * checking for ':' separator and hexadecimal strings is a good heuristic.
 */
function isEncrypted(text) {
    if (typeof text !== 'string') return false;
    // Our format uses two colons separating 3 hex strings
    const parts = text.split(':');
    if (parts.length === 3 && parts[0].length === IV_LENGTH * 2 && parts[1].length === AUTH_TAG_LENGTH * 2) {
        return true;
    }
    return false;
}

module.exports = {
    encryptData,
    decryptData,
    isEncrypted
};
