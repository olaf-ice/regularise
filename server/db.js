const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { encryptData, decryptData, isEncrypted } = require('./crypto');

// Secure parsing helper
function parseSecureData(rawData) {
    if (isEncrypted(rawData)) {
        return JSON.parse(decryptData(rawData));
    }
    return JSON.parse(rawData);
}

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
  );
  CREATE TABLE IF NOT EXISTS agents (
    agentId TEXT PRIMARY KEY,
    phone TEXT UNIQUE NOT NULL,
    pin TEXT NOT NULL,
    data JSON NOT NULL
  );
  CREATE TABLE IF NOT EXISTS waitlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    phone TEXT,
    wantsWhatsapp INTEGER,
    timestamp TEXT
  );
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
        stmt.run(rider.riderId, rider.phone, rider.pin, encryptData(JSON.stringify(rider)));
    },
    updateRider: (riderId, riderData) => {
        const stmt = db.prepare('UPDATE riders SET data = ?, pin = ? WHERE riderId = ?');
        stmt.run(encryptData(JSON.stringify(riderData)), riderData.pin, riderId);
    },
    insertWaitlist: (entry) => {
        const stmt = db.prepare('INSERT INTO waitlist (email, phone, wantsWhatsapp, timestamp) VALUES (?, ?, ?, ?)');
        stmt.run(entry.email || '', entry.phone || '', entry.wantsWhatsapp ? 1 : 0, entry.timestamp || new Date().toISOString());
    },
    getRiderById: (riderId) => {
        const stmt = db.prepare('SELECT * FROM riders WHERE riderId = ?');
        const row = stmt.get(riderId);
        return row ? parseSecureData(row.data) : null;
    },
    getRiderByPhone: (phone) => {
        const stmt = db.prepare('SELECT * FROM riders WHERE phone = ?');
        const row = stmt.get(phone);
        return row ? parseSecureData(row.data) : null;
    },
    findRiderByQuery: (query) => {
        const q = query.toLowerCase().replace(/[\s-]/g, '');
        const stmt = db.prepare('SELECT * FROM riders');
        for (const row of stmt.iterate()) {
            const data = parseSecureData(row.data);
            const rId = data.riderId ? data.riderId.toLowerCase().replace(/[\s-]/g, '') : '';
            const pNum = data.plateNumber ? data.plateNumber.toLowerCase().replace(/[\s-]/g, '') : '';
            const ph = data.phone ? data.phone.toLowerCase().replace(/[\s-]/g, '') : '';
            
            if (rId === q || pNum === q || ph === q) {
                return data;
            }
        }
        return null;
    },
    findByReference: (reference) => {
        const stmt = db.prepare('SELECT * FROM riders');
        for (const row of stmt.iterate()) {
            const data = parseSecureData(row.data);
            if (data.reference === reference) {
                return data;
            }
        }
        return null;
    },
    getAllRiders: () => {
        const stmt = db.prepare('SELECT data FROM riders');
        const riders = [];
        for (const row of stmt.iterate()) {
            riders.push(parseSecureData(row.data));
        }
        return riders;
    },
    updateRiderStatus: (riderId, newStatus) => {
        const stmt = db.prepare('SELECT data, pin FROM riders WHERE riderId = ?');
        const row = stmt.get(riderId);
        if (row) {
            const data = parseSecureData(row.data);
            data.status = newStatus;
            const updateStmt = db.prepare('UPDATE riders SET data = ? WHERE riderId = ?');
            updateStmt.run(encryptData(JSON.stringify(data)), riderId);
            return data;
        }
        return null;
    },
    // Agent helper functions
    insertAgent: (agent) => {
        const stmt = db.prepare('INSERT INTO agents (agentId, phone, pin, data) VALUES (?, ?, ?, ?)');
        stmt.run(agent.agentId, agent.phone, agent.pin, encryptData(JSON.stringify(agent)));
    },
    updateAgent: (agentId, agentData) => {
        const stmt = db.prepare('UPDATE agents SET data = ?, pin = ? WHERE agentId = ?');
        stmt.run(encryptData(JSON.stringify(agentData)), agentData.pin, agentId);
    },
    getAgentById: (agentId) => {
        const stmt = db.prepare('SELECT * FROM agents WHERE agentId = ?');
        const row = stmt.get(agentId);
        return row ? parseSecureData(row.data) : null;
    },
    getAgentByPhone: (phone) => {
        const stmt = db.prepare('SELECT * FROM agents WHERE phone = ?');
        const row = stmt.get(phone);
        return row ? parseSecureData(row.data) : null;
    },
    getAllAgents: () => {
        const stmt = db.prepare('SELECT data FROM agents');
        const agents = [];
        for (const row of stmt.iterate()) {
            agents.push(parseSecureData(row.data));
        }
        return agents;
    }
};

module.exports = dbHelpers;
