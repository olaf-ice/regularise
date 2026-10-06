/**
 * Regularise / MyVault - Database Encryption Key Rotation Utility
 * 
 * Safely rotates the AES-256-GCM database encryption key by:
 * 1. Creating a timestamped backup of the SQLite database.
 * 2. Reading all encrypted records from 'riders' and 'agents' tables.
 * 3. Decrypting each record using the OLD key.
 * 4. Re-encrypting the record using the NEW key.
 * 5. Committing the changes atomically inside a transaction.
 * 
 * Usage:
 *   node server/rotate_encryption_key.js --old <OLD_64_HEX_KEY> --new <NEW_64_HEX_KEY>
 * Or with environment variables:
 *   OLD_ENCRYPTION_KEY=... NEW_ENCRYPTION_KEY=... node server/rotate_encryption_key.js
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// Parse CLI flags or env vars
const args = process.argv.slice(2);
let oldKeyHex = process.env.OLD_ENCRYPTION_KEY;
let newKeyHex = process.env.NEW_ENCRYPTION_KEY;
let customDbPath = null;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--old' && args[i + 1]) oldKeyHex = args[++i];
    if (args[i] === '--new' && args[i + 1]) newKeyHex = args[++i];
    if (args[i] === '--db' && args[i + 1]) customDbPath = args[++i];
}

if (!oldKeyHex || !newKeyHex) {
    console.error('❌ Error: Both old and new encryption keys must be provided.');
    console.log('Usage: node server/rotate_encryption_key.js --old <OLD_64_HEX_KEY> --new <NEW_64_HEX_KEY> [--db <PATH_TO_DB>]');
    process.exit(1);
}

if (oldKeyHex.length !== 64 || newKeyHex.length !== 64) {
    console.error('❌ Error: Both keys must be exactly 64 hexadecimal characters (32 bytes).');
    process.exit(1);
}

const oldKey = Buffer.from(oldKeyHex, 'hex');
const newKey = Buffer.from(newKeyHex, 'hex');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DATA_DIR = IS_PRODUCTION ? '/data' : path.join(__dirname, '..');
const DB_FILE = customDbPath || path.join(DATA_DIR, 'riders.db');

if (!fs.existsSync(DB_FILE)) {
    console.log(`ℹ️ Database file not found at: ${DB_FILE}. No records to migrate.`);
    process.exit(0);
}

// 1. Create a safe backup copy
const backupFile = `${DB_FILE}.backup-pre-rotation-${Date.now()}`;
try {
    fs.copyFileSync(DB_FILE, backupFile);
    console.log(`✅ Pre-rotation database backup created: ${backupFile}`);
} catch (err) {
    console.error('❌ Failed to create database backup:', err.message);
    process.exit(1);
}

// Encryption helpers
function decryptWithKey(encryptedText, key) {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted format');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedContent = parts[2];

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedContent, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

function encryptWithKey(plainText, key) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function isEncrypted(text) {
    if (typeof text !== 'string') return false;
    const parts = text.split(':');
    return parts.length === 3 && parts[0].length === IV_LENGTH * 2 && parts[1].length === AUTH_TAG_LENGTH * 2;
}

const db = new Database(DB_FILE);

console.log('🔄 Starting key rotation...');

const rotateTable = (tableName, idColumn) => {
    let count = 0;
    try {
        const rows = db.prepare(`SELECT ${idColumn}, data FROM ${tableName}`).all();
        const updateStmt = db.prepare(`UPDATE ${tableName} SET data = ? WHERE ${idColumn} = ?`);

        for (const row of rows) {
            if (!row.data) continue;
            let plainText = row.data;

            if (isEncrypted(row.data)) {
                try {
                    plainText = decryptWithKey(row.data, oldKey);
                } catch (e) {
                    console.error(`⚠️ Could not decrypt ${tableName} record ${row[idColumn]} with old key: ${e.message}`);
                    continue;
                }
            }

            // Re-encrypt with new key
            const reEncrypted = encryptWithKey(plainText, newKey);
            updateStmt.run(reEncrypted, row[idColumn]);
            count++;
        }
    } catch (e) {
        if (!e.message.includes('no such table')) {
            throw e;
        }
    }
    return count;
};

try {
    const runTransaction = db.transaction(() => {
        const ridersRotated = rotateTable('riders', 'riderId');
        const agentsRotated = rotateTable('agents', 'agentId');
        return { ridersRotated, agentsRotated };
    });

    const result = runTransaction();
    console.log(`🎉 Key rotation successful!`);
    console.log(`   - Riders re-encrypted: ${result.ridersRotated}`);
    console.log(`   - Agents re-encrypted: ${result.agentsRotated}`);
} catch (err) {
    console.error('❌ Transaction failed and rolled back:', err.message);
    process.exit(1);
} finally {
    db.close();
}
