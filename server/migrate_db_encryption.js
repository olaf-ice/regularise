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

// Restore / Ensure RID-71447
try {
    const bcrypt = require('bcryptjs');
    const existingStmt = db.prepare('SELECT * FROM riders WHERE riderId = ? OR phone = ?');
    const existing = existingStmt.get('RID-71447', '08079506543');

    const rider71447 = {
        riderId: 'RID-71447',
        name: 'TIMILEYIN OLADIPUPO',
        fullName: 'TIMILEYIN OLADIPUPO',
        phone: '08079506543',
        pin: bcrypt.hashSync('1234', 10),
        plateNumber: 'JKG-213-AJ',
        status: 'Active',
        userType: 'driver',
        vehicleType: 'motorcycle',
        bike: {
            plateNumber: 'JKG-213-AJ',
            brand: 'TVS',
            model: 'Motorcycle',
            color: 'Red/Black',
            ownershipType: 'Owned'
        },
        vehicle: {
            type: 'motorcycle',
            plateNumber: 'JKG-213-AJ',
            brand: 'TVS',
            model: 'Motorcycle',
            color: 'Red/Black',
            ownershipType: 'Owned'
        },
        medical: {
            bloodGroup: 'O+',
            genotype: 'AA',
            allergies: 'None'
        },
        emergencyContact: {
            name: 'Joy Oladipupo',
            phone: '08032352737',
            relationship: 'Family'
        },
        emergencyContacts: [
            {
                name: 'Joy Oladipupo',
                phone: '08032352737',
                relationship: 'Family'
            },
            {
                name: 'Dorcas Oladipupo',
                phone: '09058233466',
                relationship: 'Family'
            }
        ],
        safety: {
            sosEnabled: true,
            theftStatus: 'Safe'
        },
        documents: {
            passportPhoto: {
                url: '/uploads/passport-RID-71447.png'
            }
        },
        expiryDate: '2028-12-31',
        createdAt: new Date().toISOString()
    };

    if (!existing) {
        const insertStmt = db.prepare('INSERT INTO riders (riderId, phone, pin, data) VALUES (?, ?, ?, ?)');
        insertStmt.run(rider71447.riderId, rider71447.phone, rider71447.pin, encryptData(JSON.stringify(rider71447)));
        console.log('Successfully restored rider RID-71447.');
    } else {
        const updateStmt = db.prepare('UPDATE riders SET data = ?, pin = ? WHERE riderId = ?');
        updateStmt.run(encryptData(JSON.stringify({ ...rider71447, status: 'Active' })), rider71447.pin, existing.riderId);
        console.log('RID-71447 verified and set to Active.');
    }
} catch (e) {
    console.error('Error ensuring RID-71447:', e.message);
}

console.log('Migration Complete.');
db.close();
