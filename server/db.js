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
  CREATE TABLE IF NOT EXISTS access_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    riderId TEXT NOT NULL,
    ip TEXT,
    userAgent TEXT,
    location TEXT,
    timestamp TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS emergency_links (
    linkId TEXT PRIMARY KEY,
    riderId TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    used INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    riderId TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('card','sticker')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','handled')),
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS free_registration_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    createdAt TEXT NOT NULL,
    claimedAt TEXT,
    claimedIp TEXT,
    usedAt TEXT,
    usedIp TEXT,
    riderId TEXT,
    notes TEXT
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
    },
    // Security & Emergency features
    logAccess: (riderId, ip, userAgent, location = '') => {
        const stmt = db.prepare('INSERT INTO access_logs (riderId, ip, userAgent, location, timestamp) VALUES (?, ?, ?, ?, ?)');
        stmt.run(riderId, ip || '', userAgent || '', location, new Date().toISOString());
    },
    getAccessLogs: (riderId) => {
        const stmt = db.prepare('SELECT * FROM access_logs WHERE riderId = ? ORDER BY timestamp DESC LIMIT 50');
        return stmt.all(riderId);
    },
    createEmergencyLink: (riderId) => {
        const linkId = require('crypto').randomBytes(16).toString('hex');
        const stmt = db.prepare('INSERT INTO emergency_links (linkId, riderId, createdAt, used) VALUES (?, ?, ?, 0)');
        stmt.run(linkId, riderId, new Date().toISOString());
        return linkId;
    },
    consumeEmergencyLink: (linkId) => {
        const stmt = db.prepare('SELECT * FROM emergency_links WHERE linkId = ? AND used = 0');
        const link = stmt.get(linkId);
        if (link) {
            const updateStmt = db.prepare('UPDATE emergency_links SET used = 1 WHERE linkId = ?');
            updateStmt.run(linkId);
            return link;
        }
        return null;
    },
    getAnalyticsData: () => {
        const stmtRiders = db.prepare('SELECT data FROM riders');
        const registrations = [];
        for (const row of stmtRiders.iterate()) {
            const parsed = parseSecureData(row.data);
            if (parsed.registrationDate) {
                registrations.push(parsed.registrationDate);
            }
        }
        
        const stmtLogs = db.prepare('SELECT timestamp FROM access_logs');
        const scans = [];
        for (const row of stmtLogs.iterate()) {
            if (row.timestamp) {
                scans.push(row.timestamp.split('T')[0]);
            }
        }
        
        return { registrations, scans };
    },
    // Free Registration Links Helpers
    createFreeLinks: (count = 300, notes = '') => {
        const crypto = require('crypto');
        const insertStmt = db.prepare('INSERT INTO free_registration_links (token, status, createdAt, notes) VALUES (?, ?, ?, ?)');
        const now = new Date().toISOString();
        const createdTokens = [];
        
        const insertBatch = db.transaction((qty) => {
            for (let i = 0; i < qty; i++) {
                const token = 'FREE-' + crypto.randomBytes(12).toString('hex').toUpperCase();
                insertStmt.run(token, 'active', now, notes || `Batch generated ${now.split('T')[0]}`);
                createdTokens.push(token);
            }
        });
        
        insertBatch(count);
        return { count: createdTokens.length, createdAt: now, tokens: createdTokens };
    },
    getFreeLinks: ({ status = 'all', search = '', page = 1, limit = 50 } = {}) => {
        let sql = 'SELECT * FROM free_registration_links';
        const params = [];
        const conditions = [];

        if (status && status !== 'all') {
            conditions.push('status = ?');
            params.push(status);
        }

        if (search) {
            conditions.push('(token LIKE ? OR claimedIp LIKE ? OR usedIp LIKE ? OR riderId LIKE ? OR notes LIKE ?)');
            const s = `%${search}%`;
            params.push(s, s, s, s, s);
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        sql += ' ORDER BY id DESC';

        const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
        const totalRow = db.prepare(countSql).get(...params);
        const total = totalRow ? totalRow.total : 0;

        const offset = (Math.max(1, page) - 1) * limit;
        sql += ' LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const rows = db.prepare(sql).all(...params);
        return { rows, total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / limit) || 1 };
    },
    getFreeLinkByToken: (token) => {
        if (!token) return null;
        const stmt = db.prepare('SELECT * FROM free_registration_links WHERE token = ?');
        return stmt.get(token) || null;
    },
    claimOrValidateFreeLink: (token, clientIp) => {
        if (!token) return { valid: false, message: 'No registration token provided.' };
        const stmt = db.prepare('SELECT * FROM free_registration_links WHERE token = ?');
        const link = stmt.get(token);

        if (!link) {
            return { valid: false, message: 'Invalid registration link.' };
        }

        if (link.status === 'used') {
            return { valid: false, message: 'This registration link has already been used.' };
        }

        if (link.status === 'nullified') {
            return { valid: false, message: 'This link was accessed from a different IP address and has been nullified.' };
        }

        const now = new Date().toISOString();
        const cleanIp = (clientIp || '').replace(/^.*:/, '');

        if (link.status === 'active' || !link.claimedIp) {
            const claimStmt = db.prepare('UPDATE free_registration_links SET status = ?, claimedAt = ?, claimedIp = ? WHERE id = ?');
            claimStmt.run('claimed', now, cleanIp, link.id);
            return { valid: true, link: { ...link, status: 'claimed', claimedIp: cleanIp } };
        }

        const existingClaimedIp = (link.claimedIp || '').replace(/^.*:/, '');
        if (existingClaimedIp && cleanIp && existingClaimedIp !== cleanIp) {
            const nullifyStmt = db.prepare('UPDATE free_registration_links SET status = ? WHERE id = ?');
            nullifyStmt.run('nullified', link.id);
            return { valid: false, message: 'Access denied: Link accessed from a different IP address and has been nullified.' };
        }

        return { valid: true, link };
    },
    useFreeLink: (token, riderId, clientIp) => {
        if (!token) return { success: false, message: 'No token provided' };
        const link = dbHelpers.getFreeLinkByToken(token);
        if (!link) return { success: false, message: 'Invalid token' };

        if (link.status === 'used') return { success: false, message: 'Token already used' };
        if (link.status === 'nullified') return { success: false, message: 'Token nullified' };

        const cleanIp = (clientIp || '').replace(/^.*:/, '');
        const existingClaimedIp = (link.claimedIp || '').replace(/^.*:/, '');

        if (existingClaimedIp && cleanIp && existingClaimedIp !== cleanIp) {
            const nullifyStmt = db.prepare('UPDATE free_registration_links SET status = ? WHERE id = ?');
            nullifyStmt.run('nullified', link.id);
            return { success: false, message: 'IP mismatch detected. Link nullified.' };
        }

        const now = new Date().toISOString();
        const stmt = db.prepare('UPDATE free_registration_links SET status = ?, usedAt = ?, usedIp = ?, riderId = ? WHERE id = ?');
        stmt.run('used', now, cleanIp, riderId, link.id);
        return { success: true };
    },
    deleteFreeLinks: ({ ids = [], clearUnused = false } = {}) => {
        if (clearUnused) {
            const stmt = db.prepare("DELETE FROM free_registration_links WHERE status IN ('active', 'claimed')");
            const result = stmt.run();
            return { deletedCount: result.changes };
        } else if (Array.isArray(ids) && ids.length > 0) {
            const placeholders = ids.map(() => '?').join(',');
            const stmt = db.prepare(`DELETE FROM free_registration_links WHERE id IN (${placeholders})`);
            const result = stmt.run(...ids);
            return { deletedCount: result.changes };
        }
        return { deletedCount: 0 };
    },
    getFreeLinksStats: () => {
        const total = db.prepare('SELECT COUNT(*) as count FROM free_registration_links').get().count;
        const active = db.prepare("SELECT COUNT(*) as count FROM free_registration_links WHERE status = 'active'").get().count;
        const claimed = db.prepare("SELECT COUNT(*) as count FROM free_registration_links WHERE status = 'claimed'").get().count;
        const used = db.prepare("SELECT COUNT(*) as count FROM free_registration_links WHERE status = 'used'").get().count;
        const nullified = db.prepare("SELECT COUNT(*) as count FROM free_registration_links WHERE status = 'nullified'").get().count;

        return { total, active, claimed, used, nullified };
    },
    // Request helper functions
    insertRequest: (riderId, type) => {
        const stmt = db.prepare('INSERT INTO requests (riderId, type, status, createdAt) VALUES (?, ?, ?, ?)');
        stmt.run(riderId, type, 'pending', new Date().toISOString());
    },
    getPendingRequestsCount: () => {
        const stmt = db.prepare('SELECT COUNT(*) as count FROM requests WHERE status = \"pending\"');
        const row = stmt.get();
        return row ? row.count : 0;
    },
    getPendingRequests: () => {
        const stmt = db.prepare('SELECT * FROM requests WHERE status = \"pending\" ORDER BY createdAt DESC');
        return stmt.all();
    }
};

module.exports = dbHelpers;
