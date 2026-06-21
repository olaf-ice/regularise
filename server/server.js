require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const axios = require('axios');
const qrcode = require('qrcode');
const multer = require('multer');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const dbHelpers = require('./db');

// ── In-Memory Emergency Session Store ───────────────────────────────────────
// Sessions expire after 6 hours and are purged automatically.
const emergencySessions = new Map();
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function generateSessionId() {
    const digits = Math.floor(10000 + Math.random() * 90000);
    return `MV-EMG-${digits}`;
}

function purgeExpiredSessions() {
    const now = Date.now();
    for (const [id, session] of emergencySessions.entries()) {
        if (now - new Date(session.createdAt).getTime() > SESSION_TTL_MS) {
            emergencySessions.delete(id);
        }
    }
}
// Purge every 30 minutes
setInterval(purgeExpiredSessions, 30 * 60 * 1000);

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_super_secret_key_change_in_prod';
const PORT = process.env.PORT || 3001;

// Persistence Configuration for Render
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DATA_DIR = IS_PRODUCTION ? '/data' : __dirname;
const RIDERS_FILE = path.join(DATA_DIR, 'riders.json');
const UPLOADS_DIR = IS_PRODUCTION ? path.join('/data', 'uploads') : path.join(__dirname, '../public/uploads');

// Ensure directories exist
if (!fs.existsSync(path.dirname(RIDERS_FILE))) fs.mkdirSync(path.dirname(RIDERS_FILE), { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(path.join(__dirname, '../public/uploads'))) fs.mkdirSync(path.join(__dirname, '../public/uploads'), { recursive: true });

// Middleware
app.use(helmet({
    contentSecurityPolicy: false, // Disabling CSP temporarily so as not to break inline scripts/styles in static frontend files
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate Limiters
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: { success: false, message: 'Too many requests, please try again later.' }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 15, // Limit each IP to 15 auth requests per windowMs
    message: { success: false, message: 'Too many attempts, please try again later.' }
});

// Apply general rate limiter to all API routes
app.use('/api/', apiLimiter);

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.error('JWT Verify Error:', err.message, 'Token:', token);
            return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
        }
        
        // Ensure single active session via tokenVersion
        if (user.riderId) {
            const dbRider = dbHelpers.getRiderById(user.riderId);
            if (!dbRider) return res.status(401).json({ success: false, message: 'User not found.' });
            
            if (dbRider.tokenVersion && dbRider.tokenVersion !== user.tokenVersion) {
                return res.status(401).json({ success: false, message: 'Session expired. You have logged in from another device.' });
            }
        }

        req.user = user;
        next();
    });
}

function authenticateAdminToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Admin access denied. No token provided.' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err || user.role !== 'admin') return res.status(403).json({ success: false, message: 'Invalid or expired admin token.' });
        req.user = user;
        next();
    });
}

function authenticateAgentToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Agent access denied. No token provided.' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err || user.role !== 'agent') return res.status(403).json({ success: false, message: 'Invalid or expired agent token.' });
        req.user = user;
        next();
    });
}

// Paystack Verification Helper
async function verifyPaystackPayment(reference) {
    try {
        const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: { 'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
        });
        return response.data.status === true && response.data.data.status === 'success';
    } catch (err) {
        console.error('Paystack Verify Error:', err.response ? err.response.data : err.message);
        return false;
    }
}

// DEBUG: Log every single request
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

const PUBLIC_DIR = IS_PRODUCTION && fs.existsSync(path.join(__dirname, '../dist/public')) ? path.join(__dirname, '../dist/public') : path.join(__dirname, '../public');
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
// Serve uploads from the persistent directory in production, otherwise local
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// Storage Configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOADS_DIR);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'application/pdf', 'image/webp'];
    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only JPEG, PNG, WEBP, and PDF files are allowed.'), false);
    }
};

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit per file
    fileFilter: fileFilter
});

// Helper to save rider to Google Sheets (NON-BLOCKING)
async function saveToGoogleSheets(rider) {
    const scriptUrl = process.env.GOOGLE_SCRIPT_URL;
    if (!scriptUrl) return;

    try {
        console.log('Attempting to sync with Google Sheets...');
        const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
        const payload = {
            riderId: rider.riderId,
            name: rider.name,
            phone: rider.phone,
            altPhone: rider.altPhone || '',
            address: rider.address || '',
            dob: rider.dob || '',
            plateNumber: rider.plateNumber,
            union: rider.union,
            status: rider.status,
            reference: rider.reference,
            expiryDate: rider.expiryDate || '',
            vehicleType: rider.vehicleType || 'motorcycle',
            // Bike / Vehicle Info
            bikeBrand: rider.vehicle?.brand || rider.bike?.brand || '',
            bikeModel: rider.vehicle?.model || rider.bike?.model || '',
            bikeColor: rider.vehicle?.color || rider.bike?.color || '',
            ownershipType: rider.vehicle?.ownershipType || rider.bike?.ownershipType || '',
            // Documents
            passportUrl: rider.documents.passportPhoto ? `${baseUrl}${rider.documents.passportPhoto.url}` : '',
            licenseUrl: rider.documents.licenseDoc ? `${baseUrl}${rider.documents.licenseDoc.url}` : '',
            licenseNumber: rider.documents.licenseDoc?.number || '',
            bikePapersUrl: rider.documents.bikePapers ? `${baseUrl}${rider.documents.bikePapers.url}` : '',
            insuranceUrl: rider.documents.insuranceDoc ? `${baseUrl}${rider.documents.insuranceDoc.url}` : '',
            insuranceNumber: rider.documents.insuranceDoc?.number || '',
            // Emergency
            emergencyName: rider.emergencyContact?.name || '',
            emergencyPhone: rider.emergencyContact?.phone || '',
            emergencyRel: rider.emergencyContact?.relationship || '',
            emergencyBloodGroup: rider.emergencyContact?.bloodGroup || '',
            emergencyGenotype: rider.emergencyContact?.genotype || '',
            // Rider Medical
            riderBloodGroup: rider.medical?.bloodGroup || '',
            riderGenotype: rider.medical?.genotype || '',
            riderAllergies: rider.medical?.allergies || '',
            riderHospital: rider.medical?.hospitalPreference || ''
        };

        await axios.post(scriptUrl, payload, { timeout: 10000 });
        console.log('Rider successfully synced to Google Sheets!');
    } catch (err) {
        console.error('Google Sheets Sync Failed:', err.message);
    }
}

// --- SMS SERVICE MOCK ---
async function sendSMS(phone, message) {
    // In the future, integrate Termii, Twilio, or Africa's Talking here.
    console.log(`\n=====================================`);
    console.log(`📱 MOCK SMS SENT TO: ${phone}`);
    console.log(`✉️ MESSAGE: ${message}`);
    console.log(`=====================================\n`);
    return true;
}

// --- DOCUMENT EXPIRY CRON JOB ---
// Runs every 24 hours to check for documents expiring in exactly 14 days
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
setInterval(() => {
    try {
        console.log('[CRON] Running daily document expiry check...');
        const riders = dbHelpers.getAllRiders();
        const today = new Date();
        const warningTarget = new Date(today);
        warningTarget.setDate(today.getDate() + 14);
        const targetDateStr = warningTarget.toISOString().split('T')[0];

        riders.forEach(rider => {
            if (rider.status !== 'Active' || !rider.documents) return;
            
            const docsToCheck = [
                { name: 'Driver License', doc: rider.documents.licenseDoc },
                { name: 'Vehicle Insurance', doc: rider.documents.insuranceDoc }
            ];

            // Also check Union Dues if we have an expiry date for it
            if (rider.unionDuesExpiry === targetDateStr) {
                sendSMS(rider.phone, `Hello ${rider.name}, your Union Dues will expire in 14 days (${targetDateStr}). Please renew to stay compliant.`);
            }

            docsToCheck.forEach(item => {
                if (item.doc && item.doc.expiryDate === targetDateStr) {
                    sendSMS(rider.phone, `Hello ${rider.name}, your ${item.name} expires in 14 days (${targetDateStr}). Please upload a new copy to your MyVault to remain compliant.`);
                }
            });
        });
    } catch (err) {
        console.error('[CRON] Error running expiry check:', err);
    }
}, TWENTY_FOUR_HOURS);
// Run once on startup just to verify it boots
setTimeout(() => console.log('[CRON] Expiry reminder job initialized.'), 1000);

// ---------------------------------------------------------
// ADMIN ROUTES
// ---------------------------------------------------------

// Admin Login
app.post('/api/admin/login', authLimiter, (req, res) => {
    const { username, password } = req.body;
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'adminpass123';

    if (username === adminUser && password === adminPass) {
        const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, message: 'Invalid admin credentials' });
    }
});

// Get All Riders (Admin)
app.get('/api/admin/riders', authenticateAdminToken, (req, res) => {
    try {
        const riders = dbHelpers.getAllRiders();
        // Remove pin from payloads before sending
        const safeRiders = riders.map(({ pin, ...safeData }) => safeData);
        res.json({ success: true, riders: safeRiders });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch riders' });
    }
});

// Add Agent (Admin)
app.post('/api/admin/add-agent', authenticateAdminToken, async (req, res) => {
    const { name, phone, pin } = req.body;
    if (!name || !phone || !pin) return res.status(400).json({ success: false, message: 'Name, phone, and PIN required' });
    if (dbHelpers.getAgentByPhone(phone)) return res.status(400).json({ success: false, message: 'Phone already registered to an agent' });

    try {
        const salt = await bcrypt.genSalt(10);
        const hashedPin = await bcrypt.hash(pin, salt);
        const agentId = `AGT-${Math.floor(1000 + Math.random() * 9000)}`;

        const newAgent = {
            agentId,
            name,
            phone,
            pin: hashedPin,
            createdAt: new Date().toISOString()
        };

        dbHelpers.insertAgent(newAgent);
        res.json({ success: true, message: `Agent ${name} added successfully`, agentId });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to add agent' });
    }
});

// Get All Agents (Admin)
app.get('/api/admin/agents', authenticateAdminToken, (req, res) => {
    try {
        const agents = dbHelpers.getAllAgents();
        const safeAgents = agents.map(({ pin, ...safeData }) => safeData);
        
        // Count onboarded users for each agent
        const riders = dbHelpers.getAllRiders();
        safeAgents.forEach(agent => {
            agent.onboardedCount = riders.filter(r => r.onboardedBy === agent.agentId).length;
        });

        res.json({ success: true, agents: safeAgents });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch agents' });
    }
});

// Update Rider Status (Admin)
app.post('/api/admin/rider/status', authenticateAdminToken, (req, res) => {
    const { riderId, status } = req.body;
    if (!riderId || !status) return res.status(400).json({ success: false, message: 'Rider ID and Status required' });

    try {
        const updated = dbHelpers.updateRiderStatus(riderId, status);
        if (updated) {
            // Also attempt to sync the new status to Google Sheets so the external sheet is updated
            saveToGoogleSheets(updated);
            res.json({ success: true, message: `Rider ${riderId} status updated to ${status}` });
        } else {
            res.status(404).json({ success: false, message: 'Rider not found' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update status' });
    }
});

// ---------------------------------------------------------
// AGENT ROUTES
// ---------------------------------------------------------

app.post('/api/agent/login', authLimiter, async (req, res) => {
    const { phone, pin } = req.body;
    const agent = dbHelpers.getAgentByPhone(phone);
    if (!agent) return res.json({ success: false, message: 'Invalid phone number or PIN' });

    try {
        const isMatch = await bcrypt.compare(pin, agent.pin);
        if (isMatch) {
            const token = jwt.sign({ agentId: agent.agentId, role: 'agent' }, JWT_SECRET, { expiresIn: '12h' });
            res.json({ success: true, token, agent: { name: agent.name, agentId: agent.agentId } });
        } else {
            res.json({ success: false, message: 'Invalid phone number or PIN' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: 'Login error' });
    }
});

app.get('/api/agent/dashboard', authenticateAgentToken, (req, res) => {
    try {
        const agentId = req.user.agentId;
        const allRiders = dbHelpers.getAllRiders();
        
        // Find users onboarded by this agent
        const onboardedUsers = allRiders.filter(r => r.onboardedBy === agentId);
        
        // Calculate commission (e.g. 500 per user)
        const commissionPerUser = 500;
        const totalCommission = onboardedUsers.length * commissionPerUser;

        // Strip sensitive info from the list sent to agent (only names, status, reference)
        const recentUsers = onboardedUsers.map(u => ({
            riderId: u.riderId,
            name: u.name,
            phone: u.phone,
            status: u.status,
            reference: u.reference,
            date: u.registrationDate
        })).reverse();

        res.json({ 
            success: true, 
            stats: { 
                totalOnboarded: onboardedUsers.length,
                estimatedCommission: totalCommission
            },
            recentUsers
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to load dashboard data' });
    }
});

app.post('/api/agent/register-rider', authenticateAgentToken, [
    body('name').trim().notEmpty().withMessage('Name is required').escape(),
    body('phone').trim().isNumeric().withMessage('Phone must be numeric').isLength({ min: 10, max: 15 }).withMessage('Invalid phone length'),
    body('pin').optional().isLength({ min: 4, max: 4 }).isNumeric().withMessage('PIN must be exactly 4 digits'),
    body('plateNumber').optional({ checkFalsy: true }).trim().escape()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, message: errors.array()[0].msg });

    try {
        // Pre-launch check
        const LAUNCH_DATE = new Date("2026-07-01T00:00:00Z").getTime();
        if (Date.now() < LAUNCH_DATE) {
            return res.status(403).json({ success: false, message: 'Registration is currently closed until July 1st. Join our early access waitlist!' });
        }

        const { name, phone, altPhone, address, dob, plateNumber, union, userType, vehicleType, bloodType, allergies, emergencyContactName, emergencyContactPhone } = req.body;
        if (dbHelpers.getRiderByPhone(phone)) return res.status(400).json({ success: false, message: 'Phone number already registered' });

        // Generate random PIN if agent didn't provide one
        const plainPin = req.body.pin || Math.floor(1000 + Math.random() * 9000).toString();
        const salt = await bcrypt.genSalt(10);
        const hashedPin = await bcrypt.hash(plainPin, salt);

        const riderId = `RID-${Math.floor(10000 + Math.random() * 90000)}`;
        const reference = `PAY-${Date.now()}`;
        
        const newRider = {
            riderId, name, phone, altPhone, address, dob, plateNumber: plateNumber || '', union: union || '',
            pin: hashedPin,
            userType: userType || 'driver',
            registrationDate: new Date().toISOString().split('T')[0],
            vehicleType: vehicleType || (userType === 'non-driver' ? null : 'motorcycle'),
            bike: { plateNumber: plateNumber || '' },
            vehicle: { type: vehicleType || (userType === 'non-driver' ? null : 'motorcycle'), plateNumber: plateNumber || '' },
            documents: {}, 
            medical: { bloodGroup: bloodType || '', allergies: allergies || 'None' },
            emergencyContact: { name: emergencyContactName || '', phone: emergencyContactPhone || '' },
            safety: { sosEnabled: false, theftStatus: 'Safe' },
            status: 'Pending', 
            reference,
            onboardedBy: req.user.agentId // Link to Agent
        };
        
        dbHelpers.insertRider(newRider);

        // Notify user of their account and PIN if it was auto-generated
        if (!req.body.pin) {
            sendSMS(phone, `Welcome ${name}! Your MyVault profile was created by an agent. Your default PIN is ${plainPin}. Please login to change it.`);
        }

        res.json({ success: true, riderId, reference, message: 'User registered successfully!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Registration failed' });
    }
});

app.post('/api/agent/upload-docs/:riderId', authenticateAgentToken, upload.fields([
    { name: 'passportPhoto', maxCount: 1 },
    { name: 'licenseDoc', maxCount: 1 },
    { name: 'bikePapers', maxCount: 1 },
    { name: 'insuranceDoc', maxCount: 1 },
    { name: 'ninDoc', maxCount: 1 }
]), (req, res) => {
    try {
        const riderId = req.params.riderId;
        const rider = dbHelpers.getRiderById(riderId);
        
        if (!rider) return res.status(404).json({ success: false, message: 'Rider not found' });
        if (rider.onboardedBy !== req.user.agentId) return res.status(403).json({ success: false, message: 'Unauthorized. You did not onboard this user.' });
        if (rider.status === 'Active') return res.status(400).json({ success: false, message: 'User is already active. Cannot modify documents anymore.' });

        rider.documents = rider.documents || {};
        
        if (req.files && req.files.passportPhoto) rider.documents.passportPhoto = { url: `/uploads/${req.files.passportPhoto[0].filename}` };
        
        const docFields = ['licenseDoc', 'insuranceDoc', 'bikePapers', 'ninDoc'];
        docFields.forEach(field => {
            if (req.files && req.files[field]) {
                rider.documents[field] = {
                    url: `/uploads/${req.files[field][0].filename}`,
                    uploadDate: new Date().toISOString().split('T')[0]
                };
            }
        });
        
        dbHelpers.updateRider(riderId, rider);
        res.json({ success: true, message: 'Documents uploaded successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Document upload failed' });
    }
});

// ---------------------------------------------------------
// PUBLIC / RIDER ROUTES
// ---------------------------------------------------------

// ── CREATE Emergency Session ─────────────────────────────────────────────────
// POST /api/emergency/create/:riderId
// Body: { location: { name, latitude, longitude } }
// Returns: { success, sessionId, sessionUrl }
app.post('/api/emergency/create/:riderId', authLimiter, async (req, res) => {
    try {
        const riderId = req.params.riderId;
        const rider = dbHelpers.getRiderById(riderId);
        if (!rider) return res.status(404).json({ success: false, message: 'Rider not found' });

        const sessionId = generateSessionId();
        const numericId = sessionId.replace('MV-EMG-', '');
        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
        const sessionUrl = `${baseUrl}/emergency/${numericId}`;

        // Safe rider snapshot (strip PIN)
        const { pin, ...safeRider } = rider;

        const session = {
            sessionId,
            numericId,
            riderId,
            sessionUrl,
            createdAt: new Date().toISOString(),
            location: req.body.location || null,
            rider: safeRider
        };

        // Store by both the full ID and the numeric part for flexible lookup
        emergencySessions.set(sessionId, session);
        emergencySessions.set(numericId, session);

        // Fire-and-forget: notify emergency contact
        if (rider.emergencyContact && rider.emergencyContact.phone) {
            const locText = session.location?.name ? ` near ${session.location.name}` : '';
            const msg = `🚨 EMERGENCY: ${rider.name} has triggered a SOS alert${locText}. ` +
                        `View their emergency profile here: ${sessionUrl}`;
            sendSMS(rider.emergencyContact.phone, msg).catch(() => {});
            if (rider.emergencyContact.secondaryPhone) {
                sendSMS(rider.emergencyContact.secondaryPhone, msg).catch(() => {});
            }
        }

        console.log(`[SOS] Emergency session created: ${sessionId} for rider ${riderId}`);
        res.json({ success: true, sessionId, numericId, sessionUrl });
    } catch (err) {
        console.error('Emergency Create Error:', err);
        res.status(500).json({ success: false, message: 'Failed to create emergency session' });
    }
});

// ── GET Emergency Session (LEVEL 1 PUBLIC SCAN) ──────────────────────────────
// GET /api/emergency/:sessionId  (public — no auth required)
app.get('/api/emergency/:sessionId', (req, res) => {
    const key = req.params.sessionId;
    const session = emergencySessions.get(key);

    if (!session) {
        return res.status(404).json({ success: false, message: 'Session not found or expired' });
    }

    // Refresh from DB in case rider data changed
    try {
        const { pin, ...fullRider } = dbHelpers.getRiderById(session.riderId) || session.rider;
        
        // Strip sensitive data for Level 1 access
        const level1Rider = {
            name: fullRider.name,
            phone: fullRider.phone,
            riderId: fullRider.riderId,
            userType: fullRider.userType || 'driver',
            emergencyContact: fullRider.emergencyContact,
            medical: fullRider.medical ? { 
                bloodGroup: fullRider.medical.bloodGroup,
                refusesBloodTransfusion: fullRider.medical.refusesBloodTransfusion
            } : {},
            // Include photo for identity
            documents: fullRider.documents && fullRider.documents.passportPhoto ? { passportPhoto: fullRider.documents.passportPhoto } : {}
        };

        const level1Session = { 
            sessionId: session.sessionId,
            numericId: session.numericId,
            createdAt: session.createdAt,
            rider: level1Rider 
        };
        
        res.json({ success: true, session: level1Session, isLevel1: true });
    } catch (e) {
        // Fallback Level 1 stripping
        const rider = session.rider;
        const level1Rider = {
            name: rider.name,
            phone: rider.phone,
            riderId: rider.riderId,
            userType: rider.userType || 'driver',
            emergencyContact: rider.emergencyContact,
            medical: rider.medical ? { 
                bloodGroup: rider.medical.bloodGroup,
                refusesBloodTransfusion: rider.medical.refusesBloodTransfusion
            } : {},
            documents: rider.documents && rider.documents.passportPhoto ? { passportPhoto: rider.documents.passportPhoto } : {}
        };
        const level1Session = {
            sessionId: session.sessionId,
            numericId: session.numericId,
            createdAt: session.createdAt,
            rider: level1Rider
        };
        res.json({ success: true, session: level1Session, isLevel1: true });
    }
});

// ── UNLOCK Emergency Session (LEVEL 2) ─────────────────────────────────────────
// POST /api/emergency/:sessionId/unlock
app.post('/api/emergency/:sessionId/unlock', apiLimiter, (req, res) => {
    const key = req.params.sessionId;
    const session = emergencySessions.get(key);

    if (!session) {
        return res.status(404).json({ success: false, message: 'Session not found or expired' });
    }

    // Return the full safe rider data for Level 2
    try {
        const { pin, ...safeRider } = dbHelpers.getRiderById(session.riderId) || session.rider;
        const freshSession = { ...session, rider: safeRider };
        res.json({ success: true, session: freshSession });
    } catch (e) {
        res.json({ success: true, session });
    }
});

// ── Serve emergency.html for /emergency/* paths ───────────────────────────────
app.get('/emergency/:sessionId', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'emergency.html'));
});

// ── Legacy SOS Endpoint (kept for ICE hub compatibility) ─────────────────────
// POST /api/sos/:riderId  — alerts next of kin via SMS
app.post('/api/sos/:riderId', authLimiter, async (req, res) => {
    try {
        const riderId = req.params.riderId;
        const rider = dbHelpers.getRiderById(riderId);
        
        if (!rider) return res.status(404).json({ success: false, message: 'Rider not found' });
        
        if (!rider.emergencyContact || !rider.emergencyContact.phone) {
            return res.status(400).json({ success: false, message: 'No emergency contact on file for this rider.' });
        }

        const message = `URGENT: Someone has just accessed the Emergency Medical Profile for ${rider.name}. If this is unexpected, please try contacting them immediately.`;
        await sendSMS(rider.emergencyContact.phone, message);
        
        if (rider.emergencyContact.secondaryPhone) {
            await sendSMS(rider.emergencyContact.secondaryPhone, message);
        }

        res.json({ success: true, message: 'Emergency SOS sent successfully.' });
    } catch (err) {
        console.error('SOS Error:', err);
        res.status(500).json({ success: false, message: 'Failed to send SOS' });
    }
});

// Update Profile
app.post('/api/profile/update/:riderId', authenticateToken, upload.fields([
    { name: 'passportPhoto', maxCount: 1 },
    { name: 'licenseDoc', maxCount: 1 },
    { name: 'insuranceDoc', maxCount: 1 },
    { name: 'bikePapers', maxCount: 1 },
    { name: 'ninDoc', maxCount: 1 },
    { name: 'advanceDirectiveDoc', maxCount: 1 }
]), async (req, res) => {
    try {
        const riderId = req.params.riderId;
        // Verify user is updating their own profile or is admin
        if (req.user.riderId !== riderId && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized profile update' });
        }
        
        const rider = dbHelpers.getRiderById(riderId);
        if (!rider) return res.status(404).json({ success: false, message: 'Profile not found' });
        
        const { name, bloodType, allergies, emergencyContactName, emergencyContactPhone, licenseNumber, licenseExpiry, insuranceNumber, insuranceExpiry, ninNumber, bikeBrand, bikeModel, bikeColor, ownershipType, plateNumber, refusesBloodTransfusion, advanceDirectiveStatement } = req.body;
        
        if (name && name.trim() !== '' && riderId === 'RID-71447') {
            rider.name = name.trim();
        }
        
        rider.documents = rider.documents || {};
        
        // Update documents
        if (req.files && req.files.passportPhoto) {
            rider.documents.passportPhoto = { url: `/uploads/${req.files.passportPhoto[0].filename}` };
        }
        
        const docFields = ['licenseDoc', 'insuranceDoc', 'bikePapers', 'ninDoc', 'advanceDirectiveDoc'];
        const docNumbers = { licenseDoc: licenseNumber, insuranceDoc: insuranceNumber, ninDoc: ninNumber };
        const docExpirations = { licenseDoc: licenseExpiry, insuranceDoc: insuranceExpiry };
        
        docFields.forEach(field => {
            if (req.files && req.files[field]) {
                rider.documents[field] = {
                    url: `/uploads/${req.files[field][0].filename}`,
                    number: docNumbers[field] || (rider.documents[field]?.number || ''),
                    uploadDate: new Date().toISOString().split('T')[0],
                    expiryDate: docExpirations[field] || (rider.documents[field]?.expiryDate || '')
                };
            } else if (rider.documents[field]) {
                if (docNumbers[field]) rider.documents[field].number = docNumbers[field];
                if (docExpirations[field]) rider.documents[field].expiryDate = docExpirations[field];
            }
        });
        
        // Update Vehicle Info
        if (bikeBrand || bikeModel || bikeColor || ownershipType || plateNumber) {
            rider.vehicle = rider.vehicle || { type: rider.vehicleType || 'motorcycle' };
            if (bikeBrand) rider.vehicle.brand = bikeBrand;
            if (bikeModel) rider.vehicle.model = bikeModel;
            if (bikeColor) rider.vehicle.color = bikeColor;
            if (ownershipType) rider.vehicle.ownershipType = ownershipType;
            if (plateNumber) {
                rider.vehicle.plateNumber = plateNumber;
                rider.plateNumber = plateNumber; // Sync root level
            }
            
            // Backward compat
            rider.bike = rider.bike || {};
            if (bikeBrand) rider.bike.brand = bikeBrand;
            if (bikeModel) rider.bike.model = bikeModel;
            if (bikeColor) rider.bike.color = bikeColor;
            if (ownershipType) rider.bike.ownershipType = ownershipType;
            if (plateNumber) rider.bike.plateNumber = plateNumber;
        }
        
        // Update medical
        rider.medical = rider.medical || {};
        if (bloodType) rider.medical.bloodGroup = bloodType;
        if (allergies) rider.medical.allergies = allergies;
        if (refusesBloodTransfusion !== undefined) {
            rider.medical.refusesBloodTransfusion = refusesBloodTransfusion === 'true' || refusesBloodTransfusion === true;
        }
        if (advanceDirectiveStatement !== undefined) {
            rider.medical.advanceDirectiveStatement = advanceDirectiveStatement;
        }
        
        // Update emergency contact
        rider.emergencyContact = rider.emergencyContact || {};
        if (emergencyContactName) rider.emergencyContact.name = emergencyContactName;
        if (emergencyContactPhone) rider.emergencyContact.phone = emergencyContactPhone;
        
        dbHelpers.updateRider(riderId, rider);
        saveToGoogleSheets(rider);
        
        res.json({ success: true, message: 'Profile updated' });
    } catch (err) {
        console.error('Profile Update Error:', err);
        res.status(500).json({ success: false, message: 'Failed to update profile: ' + (err.message || err) });
    }
});

app.get('/api/verify/:query', (req, res) => {
    const query = req.params.query.toLowerCase();
    const rider = dbHelpers.findRiderByQuery(query);
    if (rider) {
        // Strip sensitive data for Level 1 access (Public scan)
        const level1Rider = {
            name: rider.name,
            phone: rider.phone,
            riderId: rider.riderId,
            userType: rider.userType || 'driver',
            union: rider.union,
            status: rider.status,
            expiryDate: rider.expiryDate,
            vehicleType: rider.vehicleType,
            safety: rider.safety,
            vehicle: rider.vehicle,
            bike: rider.bike,
            emergencyContact: rider.emergencyContact,
            medical: rider.medical ? { 
                bloodGroup: rider.medical.bloodGroup,
                refusesBloodTransfusion: rider.medical.refusesBloodTransfusion
            } : {},
            // Only include passport photo, hide all other documents and expiry dates
            documents: rider.documents && rider.documents.passportPhoto ? { passportPhoto: rider.documents.passportPhoto } : {}
        };
        res.json({ success: true, rider: level1Rider, isLevel1: true });
    } else {
        res.json({ success: false, message: 'Rider not found' });
    }
});

// Unlock Endpoint for Public Profile (Level 2)
app.post('/api/verify/:query/unlock', apiLimiter, (req, res) => {
    const query = req.params.query.toLowerCase();
    const rider = dbHelpers.findRiderByQuery(query);
    if (rider) {
        const { pin, ...safeRiderData } = rider;
        res.json({ success: true, rider: safeRiderData });
    } else {
        res.json({ success: false, message: 'Rider not found' });
    }
});

// --- OTP Cache for PIN Reset ---
const otpStore = new Map(); // phone -> { otp, expiresAt }

app.post('/api/rider/forgot-pin', authLimiter, async (req, res) => {
    const { phone } = req.body;
    const rider = dbHelpers.getRiderByPhone(phone);
    
    if (!rider) {
        // We return success anyway to prevent number enumeration
        return res.json({ success: true, message: 'If the number is registered, an OTP will be sent.' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    otpStore.set(phone, { otp, expiresAt });

    // Send SMS
    const msg = `Your Regularise PIN reset OTP is ${otp}. It expires in 10 minutes.`;
    await sendSMS(phone, msg);

    res.json({ success: true, message: 'If the number is registered, an OTP will be sent.' });
});

app.post('/api/rider/verify-otp', authLimiter, (req, res) => {
    const { phone, otp } = req.body;
    const stored = otpStore.get(phone);

    if (!stored || stored.otp !== otp || stored.expiresAt < Date.now()) {
        return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    res.json({ success: true, message: 'OTP verified' });
});

app.post('/api/rider/reset-pin', authLimiter, async (req, res) => {
    const { phone, otp, newPin } = req.body;
    const stored = otpStore.get(phone);

    if (!stored || stored.otp !== otp || stored.expiresAt < Date.now()) {
        return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    if (!newPin || newPin.length !== 4) {
        return res.status(400).json({ success: false, message: 'PIN must be exactly 4 digits' });
    }

    const rider = dbHelpers.getRiderByPhone(phone);
    if (!rider) {
        return res.status(404).json({ success: false, message: 'Rider not found' });
    }

    try {
        const salt = await bcrypt.genSalt(10);
        const hashedPin = await bcrypt.hash(newPin, salt);

        rider.pin = hashedPin;
        dbHelpers.updateRider(rider.riderId, rider);
        
        // Clear OTP
        otpStore.delete(phone);

        res.json({ success: true, message: 'PIN updated successfully' });
    } catch (err) {
        console.error("PIN reset error:", err);
        res.status(500).json({ success: false, message: 'Failed to reset PIN' });
    }
});

// Rider Login Endpoint
app.post('/api/rider/login', authLimiter, async (req, res) => {
    const { phone, pin } = req.body;
    
    const rider = dbHelpers.getRiderByPhone(phone);
    
    if (!rider) {
        return res.json({ success: false, message: 'Invalid phone number or PIN' });
    }

    if (!rider.pin) {
        return res.json({ success: false, message: 'No PIN set for this account. Please register again.' });
    }

    try {
        const isMatch = await bcrypt.compare(pin, rider.pin);
        if (isMatch) {
            rider.tokenVersion = (rider.tokenVersion || 0) + 1;
            dbHelpers.updateRider(rider.riderId, rider);

            const token = jwt.sign({ riderId: rider.riderId, tokenVersion: rider.tokenVersion }, JWT_SECRET, { expiresIn: '24h' });
            res.json({ success: true, riderId: rider.riderId, token });
        } else {
            res.json({ success: false, message: 'Invalid phone number or PIN' });
        }
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
// Waitlist Registration
app.post('/api/waitlist', apiLimiter, (req, res) => {
    const { email, phone, wantsWhatsapp } = req.body;
    
    if (!email && !phone) {
        return res.status(400).json({ success: false, message: 'Please provide either an email or a phone number.' });
    }

    try {
        dbHelpers.insertWaitlist({ email, phone, wantsWhatsapp });
        res.json({ success: true, message: 'Successfully added to the waitlist!' });
    } catch (err) {
        console.error('Waitlist error:', err);
        res.status(500).json({ success: false, message: 'Internal server error while joining waitlist.' });
    }
});

// 2. Register
app.post('/api/register', authLimiter, [
    body('name').trim().notEmpty().withMessage('Name is required').escape(),
    body('phone').trim().isNumeric().withMessage('Phone must be numeric').isLength({ min: 10, max: 15 }).withMessage('Invalid phone length'),
    body('pin').isLength({ min: 4, max: 4 }).isNumeric().withMessage('PIN must be exactly 4 digits'),
    body('plateNumber').optional({ checkFalsy: true }).trim().escape()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: errors.array()[0].msg });
    }

    try {
        // Pre-launch check
        const LAUNCH_DATE = new Date("2026-07-01T00:00:00Z").getTime();
        if (Date.now() < LAUNCH_DATE) {
            return res.status(403).json({ success: false, message: 'Registration is currently closed until July 1st. Join our early access waitlist!' });
        }

        const { name, phone, altPhone, address, dob, plateNumber, union, pin, vehicleType, bloodType, allergies, emergencyContactName, emergencyContactPhone, userType } = req.body;
        
        if (dbHelpers.getRiderByPhone(phone)) {
            return res.status(400).json({ success: false, message: 'Phone number already registered' });
        }

        // Hash the PIN
        const salt = await bcrypt.genSalt(10);
        const hashedPin = await bcrypt.hash(pin, salt);

        const riderId = `RID-${Math.floor(10000 + Math.random() * 90000)}`;
        const reference = `PAY-${Date.now()}`;
        const newRider = {
            riderId, name, phone, altPhone, address, dob, plateNumber: plateNumber || '', union: union || '',
            pin: hashedPin,
            userType: userType || 'driver',
            registrationDate: new Date().toISOString().split('T')[0],
            vehicleType: vehicleType || (userType === 'non-driver' ? null : 'motorcycle'),
            bike: {
                plateNumber: plateNumber || ''
            },
            vehicle: {
                type: vehicleType || (userType === 'non-driver' ? null : 'motorcycle'),
                plateNumber: plateNumber || ''
            },
            documents: {}, 
            medical: {
                bloodGroup: bloodType || '',
                allergies: allergies || 'None'
            },
            emergencyContact: {
                name: emergencyContactName || '',
                phone: emergencyContactPhone || ''
            },
            safety: {
                sosEnabled: false,
                theftStatus: 'Safe'
            },
            status: 'Pending', 
            reference 
        };
        dbHelpers.insertRider(newRider);
        const token = jwt.sign({ riderId }, JWT_SECRET, { expiresIn: '24h' });

        res.json({
            success: true, riderId, reference, token,
            paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Registration failed' });
    }
});

// 3. Post-Payment Update
app.post('/api/rider/update', authenticateToken, upload.fields([
    { name: 'passportPhoto', maxCount: 1 },
    { name: 'licenseDoc', maxCount: 1 },
    { name: 'bikePapers', maxCount: 1 },
    { name: 'proofOfOwnership', maxCount: 1 },
    { name: 'insuranceDoc', maxCount: 1 },
    { name: 'ninDoc', maxCount: 1 },
    { name: 'medicalDirectiveDoc', maxCount: 1 }
]), async (req, res) => {
    try {
        const { 
            reference, 
            // Rider's own medical
            riderBloodGroup, riderGenotype, riderAllergies, riderHospital,
            // Emergency contact
            emergencyName, emergencyPhone, emergencyRel, emergencyAltPhone,
            bloodGroup, genotype,
            // Bike
            bikeBrand, bikeModel, bikeColor, ownershipType,
            // Doc numbers
            licenseNumber, insuranceNumber, ninNumber
        } = req.body;
        
        // Use the authenticated riderId from JWT, NOT the request body
        const riderId = req.user.riderId;
        const rider = dbHelpers.getRiderById(riderId);
        if (!rider) return res.status(404).json({ success: false, message: 'Rider not found' });

        // Verify payment before allowing update if not already active
        if (rider.status !== 'Active') {
            const isPaid = await verifyPaystackPayment(reference || rider.reference);
            if (!isPaid) {
                return res.status(401).json({ success: false, message: 'Payment not verified. Please complete payment first.' });
            }
            rider.status = 'Active';
            const expiry = new Date();
            expiry.setMonth(expiry.getMonth() + 12);
            rider.expiryDate = expiry.toISOString().split('T')[0];
        }

        // Update Rider's Own Medical Info
        rider.medical = {
            bloodGroup: riderBloodGroup,
            genotype: riderGenotype,
            allergies: riderAllergies || 'None',
            hospitalPreference: riderHospital || ''
        };

        // Update Emergency Contact
        rider.emergencyContact = { 
            name: emergencyName, 
            phone: emergencyPhone,
            relationship: emergencyRel,
            secondaryPhone: emergencyAltPhone,
            bloodGroup,
            genotype
        };

        // Update Vehicle Info
        rider.vehicleType = req.body.vehicleType || req.body.type || rider.vehicleType || 'motorcycle';
        rider.vehicle = {
            type: rider.vehicleType,
            brand: bikeBrand || '',
            model: bikeModel || '',
            color: bikeColor || '',
            ownershipType: ownershipType || ''
        };
        // Backward compatibility mapping
        rider.bike = {
            brand: rider.vehicle.brand,
            model: rider.vehicle.model,
            color: rider.vehicle.color,
            ownershipType: rider.vehicle.ownershipType,
            plateNumber: rider.plateNumber
        };

        // Update Documents & Numbers
        const fieldNames = ['passportPhoto', 'licenseDoc', 'bikePapers', 'proofOfOwnership', 'insuranceDoc', 'ninDoc', 'medicalDirectiveDoc'];
        const docNumbers = {
            licenseDoc: licenseNumber,
            insuranceDoc: insuranceNumber,
            ninDoc: ninNumber
        };
        const docExpirations = {
            licenseDoc: req.body.licenseExpiry,
            insuranceDoc: req.body.insuranceExpiry
        };

        fieldNames.forEach(field => {
            if (req.files && req.files[field]) {
                rider.documents[field] = {
                    url: `/uploads/${req.files[field][0].filename}`,
                    number: docNumbers[field] || '',
                    uploadDate: new Date().toISOString().split('T')[0],
                    expiryDate: docExpirations[field] || ''
                };
            } else if (rider.documents[field]) {
                if (docNumbers[field] !== undefined) rider.documents[field].number = docNumbers[field];
                if (docExpirations[field] !== undefined) rider.documents[field].expiryDate = docExpirations[field];
            }
        });

        if (req.body.unionDuesExpiry) {
            rider.unionDuesExpiry = req.body.unionDuesExpiry;
        }

        dbHelpers.updateRider(riderId, rider);
        saveToGoogleSheets(rider); 

        res.json({ success: true, message: 'Profile completed successfully' });
    } catch (error) {
        console.error('Update Error:', error);
        res.status(500).json({ success: false, message: 'Update failed' });
    }
});

// 4. Verify Payment (Webhook or Frontend trigger)
app.post('/api/payment/verify', async (req, res) => {
    const { reference, riderId } = req.body;
    try {
        const rider = dbHelpers.getRiderById(riderId) || dbHelpers.findByReference(reference);
        if (!rider) return res.status(404).json({ success: false, message: 'Rider not found' });

        const isPaid = await verifyPaystackPayment(reference);
        if (isPaid) {
            rider.status = 'Active';
            const expiry = new Date();
            expiry.setMonth(expiry.getMonth() + 12);
            rider.expiryDate = expiry.toISOString().split('T')[0];
            dbHelpers.updateRider(rider.riderId, rider);
            res.json({ success: true, message: 'Payment verified' });
        } else {
            res.status(400).json({ success: false, message: 'Payment verification failed' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Verification failed' });
    }
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://127.0.0.1:${PORT}`);
});

