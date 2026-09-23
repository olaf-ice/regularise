const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { encryptData, isEncrypted } = require('./crypto');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DATA_DIR = IS_PRODUCTION ? '/data' : path.join(__dirname, '..');
const DB_FILE = path.join(DATA_DIR, 'riders.db');

if (!fs.existsSync(DB_FILE)) {
    console.log('Database file not found at:', DB_FILE, '- skipping migration.');
    process.exit(0);
}

const db = new Database(DB_FILE);

console.log('Starting Database Encryption Migration...');

function migrateTable(tableName, idColumnName) {
    console.log(`Migrating table: ${tableName}`);
    const stmt = db.prepare(`SELECT * FROM ${tableName}`);
    const rows = stmt.all();
    let migratedCount = 0;
    
    for (const row of rows) {
        if (!isEncrypted(row.data)) {
            try {
                // Ensure it is valid JSON before encrypting
                const parsed = JSON.parse(row.data);
                const encrypted = encryptData(JSON.stringify(parsed));
                
                const updateStmt = db.prepare(`UPDATE ${tableName} SET data = ? WHERE ${idColumnName} = ?`);
                updateStmt.run(encrypted, row[idColumnName]);
                migratedCount++;
            } catch (err) {
                console.error(`Failed to migrate row in ${tableName} with ID ${row[idColumnName]}:`, err.message);
            }
        }
    }
    console.log(`Successfully encrypted ${migratedCount} plaintext records in ${tableName}.`);
}

// Migrate riders
try {
    migrateTable('riders', 'riderId');
} catch (e) {
    console.log('No users table or error:', e.message);
}

// Migrate agents
try {
    migrateTable('agents', 'agentId');
} catch (e) {
    console.log('No agents table or error:', e.message);
}

console.log('Migration Complete.');
db.close();
