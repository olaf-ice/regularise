const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DATA_DIR = IS_PRODUCTION ? '/data' : path.join(__dirname, '..');
const DB_FILE = path.join(DATA_DIR, 'riders.db');
const OLD_JSON_FILE = path.join(DATA_DIR, 'server/riders.json');

// Ensure directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_FILE);

// Initialize table
db.exec(`
  CREATE TABLE IF NOT EXISTS riders (
    riderId TEXT PRIMARY KEY,
    phone TEXT UNIQUE NOT NULL,
    pin TEXT NOT NULL,
    data JSON NOT NULL
  )
`);

// Migration script
if (fs.existsSync(OLD_JSON_FILE)) {
    try {
        console.log('Migrating data from riders.json to riders.db...');
        const rawData = fs.readFileSync(OLD_JSON_FILE, 'utf8');
        const ridersList = JSON.parse(rawData);
        
        const insertStmt = db.prepare('INSERT OR IGNORE INTO riders (riderId, phone, pin, data) VALUES (?, ?, ?, ?)');
        const insertMany = db.transaction((riders) => {
            for (const rider of riders) {
                insertStmt.run(rider.riderId, rider.phone, rider.pin || '', JSON.stringify(rider));
            }
        });
        
        insertMany(ridersList);
        console.log('Migration complete. Renaming riders.json to riders.json.backup');
        fs.renameSync(OLD_JSON_FILE, OLD_JSON_FILE + '.backup');
    } catch (err) {
        console.error('Migration failed:', err);
    }
}

// Database helper functions
const dbHelpers = {
    insertRider: (rider) => {
        const stmt = db.prepare('INSERT INTO riders (riderId, phone, pin, data) VALUES (?, ?, ?, ?)');
        stmt.run(rider.riderId, rider.phone, rider.pin, JSON.stringify(rider));
    },
    updateRider: (riderId, riderData) => {
        const stmt = db.prepare('UPDATE riders SET data = ?, pin = ? WHERE riderId = ?');
        stmt.run(JSON.stringify(riderData), riderData.pin, riderId);
    },
    getRiderById: (riderId) => {
        const stmt = db.prepare('SELECT * FROM riders WHERE riderId = ?');
        const row = stmt.get(riderId);
        return row ? JSON.parse(row.data) : null;
    },
    getRiderByPhone: (phone) => {
        const stmt = db.prepare('SELECT * FROM riders WHERE phone = ?');
        const row = stmt.get(phone);
        return row ? JSON.parse(row.data) : null;
    },
    findRiderByQuery: (query) => {
        const q = query.toLowerCase();
        const stmt = db.prepare('SELECT * FROM riders');
        for (const row of stmt.iterate()) {
            const data = JSON.parse(row.data);
            if (data.riderId.toLowerCase() === q || (data.plateNumber && data.plateNumber.toLowerCase() === q)) {
                return data;
            }
        }
        return null;
    },
    findByReference: (reference) => {
        const stmt = db.prepare('SELECT * FROM riders');
        for (const row of stmt.iterate()) {
            const data = JSON.parse(row.data);
            if (data.reference === reference) {
                return data;
            }
        }
        return null;
    }
};

module.exports = dbHelpers;
