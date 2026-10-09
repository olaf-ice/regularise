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
const crypto = require('crypto');

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
app.disable('x-powered-by');

// Load critical secrets from environment variables. If missing, the app will abort on startup.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ Fatal: JWT_SECRET environment variable is not set. Exiting.');
  process.exit(1);
}

// Ensure critical security configuration in production
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
if (IS_PRODUCTION) {
  if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 64) {
    console.error('❌ [SECURITY] Fatal: ENCRYPTION_KEY environment variable is missing or invalid in production.');
  }
  if (!process.env.ADMIN_PASSWORD_HASH && (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'adminpass123')) {
    console.warn('[SECURITY] Notice: Default ADMIN_PASSWORD active. Configure custom ADMIN_PASSWORD in Render dashboard for added security.');
  }
}

// ── QR Security & Anti-Screenshot Tokens ────────────────────────────────────
function generateQrToken(riderId, timestamp) {
    return crypto.createHmac('sha256', JWT_SECRET)
                 .update(`${riderId}:${timestamp}`)
                 .digest('hex')
                 .substring(0, 16);
}

function generateCardCvv(riderId) {
    const hash = crypto.createHmac('sha256', JWT_SECRET)
                       .update(`cvv:${riderId}`)
                       .digest('hex')
                       .toUpperCase();
    return `SEC-${hash.substring(0, 3)}`;
}
const PORT = process.env.PORT || 3001;
let adminTokenVersion = 0;

// Persistence Configuration for Render
const DATA_DIR = IS_PRODUCTION ? '/data' : __dirname;
const RIDERS_FILE = path.join(DATA_DIR, 'riders.json');
const UPLOADS_DIR = IS_PRODUCTION ? path.join('/data', 'uploads') : path.join(__dirname, '../public/uploads');

// Ensure directories exist
if (!fs.existsSync(path.dirname(RIDERS_FILE))) fs.mkdirSync(path.dirname(RIDERS_FILE), { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(path.join(__dirname, '../public/uploads'))) fs.mkdirSync(path.join(__dirname, '../public/uploads'), { recursive: true });

// Lock down SQLite database permissions (POSIX/Render)
try {
    const dbFile = path.join(DATA_DIR, 'riders.db');
    if (fs.existsSync(dbFile) && process.platform !== 'win32') {
        fs.chmodSync(dbFile, 0o600);
    }
} catch (e) {
    console.warn('[SECURITY] Database permission notice:', e.message);
}

// Security Middleware: Helmet with customized Content Security Policy
// Security Middleware: Helmet with customized Content Security Policy and HSTS
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                "'unsafe-eval'",
                "https://js.paystack.co",
                "https://cdn.jsdelivr.net",
                "https://cdn.tailwindcss.com",
                "https://cdnjs.cloudflare.com",
                "https://embed.tawk.to",
                "https://*.tawk.to"
            ],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://cdnjs.cloudflare.com",
                "https://*.tawk.to"
            ],
            fontSrc: [
                "'self'",
                "https://*.tawk.to",
                "data:"
            ],
            imgSrc: [
                "'self'",
                "data:",
                "blob:",
                "https:"
            ],
            connectSrc: [
                "'self'",
                "https://api.paystack.co",
                "https://*.tawk.to",
                "wss://*.tawk.to",
                "https://nominatim.openstreetmap.org",
                "https://api.allorigins.win",
                "https://overpass-api.de",
                "https://overpass.kumi.systems",
                "https://lz4.overpass-api.de"
            ],
            frameSrc: [
                "'self'",
                "https://js.paystack.co",
                "https://embed.tawk.to",
                "https://*.tawk.to",
                "https://docs.google.com",
                "https://forms.gle"
            ],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'", "https://api.paystack.co", "https://docs.google.com"]
        }
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Permissions-Policy Header Middleware
app.use((req, res, next) => {
    res.setHeader(
        'Permissions-Policy',
        'camera=(self), microphone=(), geolocation=(self), payment=(self "https://js.paystack.co")'
    );
    next();
});

// Restrict CORS: Allow only trusted origins and safe HTTP methods (GET, POST, OPTIONS)
const allowedOrigins = [
    'https://myvault.com.ng',
    'https://www.myvault.com.ng',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://localhost:5000'
];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps, curl, server-to-server, or same-origin)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(null, false);
        }
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    credentials: true,
    maxAge: 86400
}));

// Capture raw body for secure webhook signature validation
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(express.urlencoded({ extended: true }));

// ── Cookie Helpers (Keep tokens out of insecure browser localStorage) ───────
function getCookie(req, name) {
    if (!req.headers.cookie) return null;
    const match = req.headers.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
}

function setAuthCookie(res, name, token, maxAgeMs) {
    const isProd = process.env.NODE_ENV === 'production';
    const cookieParts = [
        `${name}=${encodeURIComponent(token)}`,
        'HttpOnly',
        'Path=/',
        `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
        'SameSite=Strict'
    ];
    if (isProd) cookieParts.push('Secure');
    res.append('Set-Cookie', cookieParts.join('; '));
}

function clearAuthCookies(res) {
    const isProd = process.env.NODE_ENV === 'production';
    ['auth_token', 'admin_token'].forEach(name => {
        const parts = [
            `${name}=`,
            'HttpOnly',
            'Path=/',
            'Max-Age=0',
            'SameSite=Strict'
        ];
        if (isProd) parts.push('Secure');
        res.append('Set-Cookie', parts.join('; '));
    });
}

function extractToken(req, preferredCookie = 'auth_token') {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.split(' ')[1];
    }
    return getCookie(req, preferredCookie) || getCookie(req, 'auth_token') || getCookie(req, 'admin_token');
}

// ── Granular Rate Limiters ──────────────────────────────────────────────────
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { success: false, message: 'Too many requests, please try again later.' }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, message: 'Too many authentication attempts, please try again later.' }
});

const adminAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { success: false, message: 'Too many admin authentication attempts. Please wait 15 minutes.' }
});

const otpRequestLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    message: { success: false, message: 'Too many OTP requests. Please wait 15 minutes.' }
});

const otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { success: false, message: 'Too many OTP verification attempts. Please wait 15 minutes.' }
});

const paymentVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    message: { success: false, message: 'Payment verification limit reached. Please wait.' }
});

// Apply general rate limiter to all API routes
app.use('/api/', apiLimiter);

// ── Authentication & Authorization Middlewares ──────────────────────────────
function authenticateToken(req, res, next) {
    const token = extractToken(req, 'auth_token');
    if (!token) return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            console.warn('[AUTH] Token verification failed:', err.message);
            return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
        }
        
        // Ensure single active session via tokenVersion for riders
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
    const token = extractToken(req, 'admin_token');
    if (!token) return res.status(401).json({ success: false, message: 'Admin access denied. No token provided.' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err || user.role !== 'admin') {
            console.warn('[AUTH] Admin role authorization rejected');
            return res.status(403).json({ success: false, message: 'Invalid or expired admin token.' });
        }
        req.user = user;
        next();
    });
}

function authenticateAgentToken(req, res, next) {
    const token = extractToken(req, 'auth_token');
    if (!token) return res.status(401).json({ success: false, message: 'Agent access denied. No token provided.' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err || user.role !== 'agent') return res.status(403).json({ success: false, message: 'Invalid or expired agent token.' });
        
        const dbAgent = dbHelpers.getAgentById(user.agentId);
        if (!dbAgent) return res.status(401).json({ success: false, message: 'Agent not found.' });
        if (dbAgent.tokenVersion && dbAgent.tokenVersion !== user.tokenVersion) {
            return res.status(401).json({ success: false, message: 'Session expired. You have logged in from another device.' });
        }

        req.user = user;
        next();
    });
}

// Global Logout Endpoint (Clears HttpOnly tokens)
app.post('/api/auth/logout', (req, res) => {
    clearAuthCookies(res);
    res.json({ success: true, message: 'Logged out successfully' });
});

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

// Development request logger (suppressed in production)
if (!IS_PRODUCTION) {
    app.use((req, res, next) => {
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
        next();
    });
}

const PUBLIC_DIR = IS_PRODUCTION && fs.existsSync(path.join(__dirname, '../dist/public')) ? path.join(__dirname, '../dist/public') : path.join(__dirname, '../public');

// ── Server-Side Protected Admin Route (Role-Level Security) ─────────────────
// Ensures admin dashboard HTML and scripts can NEVER be downloaded by unauthenticated users
app.get(['/admin', '/admin.html'], (req, res) => {
    const token = extractToken(req, 'admin_token');
    if (!token) {
        return res.redirect('/admin-login.html?auth=required');
    }
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err || user.role !== 'admin') {
            clearAuthCookies(res);
            return res.redirect('/admin-login.html?auth=invalid');
        }
        res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
    });
});

// ── Admin Login Route (Public Portal for Administrators) ────────────────────
app.get(['/admin-login', '/admin-login.html'], (req, res) => {
    const token = extractToken(req, 'admin_token');
    if (token) {
        try {
            const user = jwt.verify(token, JWT_SECRET);
            if (user && user.role === 'admin') {
                return res.redirect('/admin');
            }
        } catch (_) {}
    }
    res.sendFile(path.join(PUBLIC_DIR, 'admin-login.html'));
});

// Route legacy ?role=admin queries directly to dedicated admin portal
app.get('/login.html', (req, res, next) => {
    if (req.query.role === 'admin') {
        const query = req.query.auth ? `?auth=${encodeURIComponent(req.query.auth)}` : '';
        return res.redirect(`/admin-login.html${query}`);
    }
    next();
});

// ── Server-Side Protected Agent Dashboard Route ─────────────────────────────
app.get(['/agent-dashboard', '/agent-dashboard.html'], (req, res) => {
    const token = extractToken(req, 'auth_token');
    if (!token) {
        return res.redirect('/agent-login.html?auth=required');
    }
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err || user.role !== 'agent') {
            clearAuthCookies(res);
            return res.redirect('/agent-login.html?auth=invalid');
        }
        res.sendFile(path.join(PUBLIC_DIR, 'agent-dashboard.html'));
    });
});

// Intercept direct static access to sensitive templates before express.static
app.use((req, res, next) => {
    if (req.path === '/admin.html' || req.path === '/agent-dashboard.html') {
        return res.status(403).send('Forbidden: Direct access prohibited.');
    }
    next();
});

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// Hardened uploads serving: Prevent script execution and XSS
const secureUploadHeaders = (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
};
app.use('/uploads', secureUploadHeaders, express.static(UPLOADS_DIR));
app.use('/uploads', secureUploadHeaders, express.static(path.join(__dirname, '../public/uploads')));

// ── Hardened Storage Configuration (Whitelisted Extensions & UUID Filenames) ─
const ALLOWED_MIME_EXT_MAP = {
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/webp': ['.webp'],
    'application/pdf': ['.pdf']
};

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOADS_DIR);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        const allowedExts = ALLOWED_MIME_EXT_MAP[file.mimetype] || [];
        const finalExt = allowedExts.includes(ext) ? ext : (allowedExts[0] || '.bin');
        const safeName = `${file.fieldname}-${uuidv4()}${finalExt}`;
        cb(null, safeName);
    }
});

const fileFilter = (req, file, cb) => {
    const rawName = String(file.originalname || '');
    // Reject path traversals, null bytes, and double extensions
    if (rawName.includes('\0') || rawName.includes('/') || rawName.includes('\\')) {
        return cb(new Error('Invalid filename structure.'), false);
    }
    const ext = path.extname(rawName).toLowerCase();
    const allowedExts = ALLOWED_MIME_EXT_MAP[file.mimetype];
    if (!allowedExts || !allowedExts.includes(ext)) {
        return cb(new Error('Invalid file type or extension mismatch. Only JPEG, PNG, WEBP, and PDF files are allowed.'), false);
    }
    cb(null, true);
};

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024, files: 10 }, // 5MB limit per file
    fileFilter: fileFilter
});

// Helper to save rider to Google Sheets (NON-BLOCKING)
async function saveToGoogleSheets(rider) {
    const scriptUrl = process.env.GOOGLE_SCRIPT_URL;
    if (!scriptUrl) return;

    try {
        const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
        const payload = {
            riderId: rider.riderId,
            name: rider.name,
            phone: rider.phone,
            altPhone: rider.altPhone || '',
            address: rider.address || '',
            dob: rider.dob || '',
            plateNumber: rider.plateNumber,
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
            passportUrl: rider.documents?.passportPhoto ? `${baseUrl}${rider.documents.passportPhoto.url}` : '',
            licenseUrl: rider.documents?.licenseDoc ? `${baseUrl}${rider.documents.licenseDoc.url}` : '',
            licenseNumber: rider.documents?.licenseDoc?.number || '',
            bikePapersUrl: rider.documents?.bikePapers ? `${baseUrl}${rider.documents.bikePapers.url}` : '',
            insuranceUrl: rider.documents?.insuranceDoc ? `${baseUrl}${rider.documents.insuranceDoc.url}` : '',
            insuranceNumber: rider.documents?.insuranceDoc?.number || '',
            // Emergency
            emergencyName: rider.emergencyContact?.name || '',
            emergencyPhone: rider.emergencyContact?.phone || '',
            emergencyRel: rider.emergencyContact?.relationship || '',
            emergencyBloodGroup: rider.emergencyContact?.bloodGroup || '',
            emergencyGenotype: rider.emergencyContact?.genotype || '',
            // User Medical
            riderBloodGroup: rider.medical?.bloodGroup || '',
            riderGenotype: rider.medical?.genotype || '',
            riderAllergies: rider.medical?.allergies || '',
            riderHospital: rider.medical?.hospitalPreference || ''
        };

        await axios.post(scriptUrl, payload, { timeout: 10000 });
        if (!IS_PRODUCTION) console.log('[SHEETS] Rider successfully synced to Google Sheets');
    } catch (err) {
        console.error('Google Sheets Sync Failed:', err.message);
    }
}

// --- SMS SERVICE (With PII & Secret Masking in Logs) ---
async function sendSMS(phone, message) {
    const maskedPhone = String(phone || '').replace(/(\d{4})\d+(\d{3})/, '$1****$2');
    if (!IS_PRODUCTION) {
        console.log(`[SMS-DEV] Dispatched message to: ${maskedPhone} (${message.length} chars)`);
    } else {
        console.log(`[SMS] Notification dispatched to: ${maskedPhone}`);
    }
    return true;
}

// --- DOCUMENT EXPIRY CRON JOB ---
// Runs every 24 hours to check for documents expiring in exactly 14 days
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
setInterval(() => {
    try {
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

            docsToCheck.forEach(item => {
                if (item.doc && item.doc.expiryDate === targetDateStr) {
                    sendSMS(rider.phone, `Hello ${rider.name}, your ${item.name} expires in 14 days (${targetDateStr}). Please upload a new copy to your MyVault to remain compliant.`);
                }
            });
        });
    } catch (err) {
        console.error('[CRON] Error running expiry check:', err.message);
    }
}, TWENTY_FOUR_HOURS);

// ---------------------------------------------------------
// ADMIN ROUTES
// ---------------------------------------------------------

// Admin Login (Secure Constant-Time & Bcrypt Verification)
app.post('/api/admin/login', adminAuthLimiter, async (req, res) => {
    const { username, password } = req.body || {};
    const inputUser = String(username || '').trim();
    const inputPass = String(password || '').trim();

    if (!inputUser || !inputPass) {
        return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }

    const configuredUser = (process.env.ADMIN_USERNAME || 'admin').trim();
    const configuredPass = process.env.ADMIN_PASSWORD ? process.env.ADMIN_PASSWORD.trim() : null;
    const configuredPassHash = process.env.ADMIN_PASSWORD_HASH;

    if (!configuredPass && !configuredPassHash) {
        if (IS_PRODUCTION) {
            console.error('[SECURITY FATAL] Admin password is unconfigured in production.');
            return res.status(500).json({ success: false, message: 'Admin authentication is unconfigured in production.' });
        }
        console.warn('[SECURITY] ADMIN_PASSWORD env var is not set - using default local dev credentials.');
    }

    // Constant-time username matching
    const maxLen = Math.max(inputUser.length, configuredUser.length, 32);
    const userBuf1 = Buffer.from(inputUser.toLowerCase().padEnd(maxLen, ' '));
    const userBuf2 = Buffer.from(configuredUser.toLowerCase().padEnd(maxLen, ' '));
    const isUserMatch = crypto.timingSafeEqual(userBuf1, userBuf2);

    let isPassMatch = false;
    if (configuredPassHash) {
        isPassMatch = await bcrypt.compare(inputPass, configuredPassHash);
    } else if (configuredPass) {
        // Compare with bcrypt hash or constant-time comparison
        const passMaxLen = Math.max(inputPass.length, configuredPass.length, 32);
        const passBuf1 = Buffer.from(inputPass.padEnd(passMaxLen, ' '));
        const passBuf2 = Buffer.from(configuredPass.padEnd(passMaxLen, ' '));
        isPassMatch = crypto.timingSafeEqual(passBuf1, passBuf2);
    } else {
        isPassMatch = (inputPass === 'adminpass123');
    }

    if (isUserMatch && isPassMatch) {
        adminTokenVersion++;
        const token = jwt.sign({ role: 'admin', tokenVersion: adminTokenVersion }, JWT_SECRET, { expiresIn: '12h' });
        // Set secure HttpOnly cookie
        setAuthCookie(res, 'admin_token', token, 12 * 60 * 60 * 1000);
        console.log(`[AUTH] Admin successfully authenticated (user: ${inputUser})`);
        return res.json({ success: true, token });
    } else {
        console.warn(`[AUTH] Failed admin login attempt for username: "${inputUser}"`);
        return res.status(401).json({ success: false, message: 'Invalid admin username or password.' });
    }
});

// Get Admin Notifications
app.get('/api/admin/notifications', authenticateAdminToken, (req, res) => {
    try {
        const pendingCount = dbHelpers.getPendingRequestsCount();
        res.json({ success: true, pendingCount });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
    }
});

// Get All Users (Admin)
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

// Get Analytics (Admin)
app.get('/api/admin/analytics', authenticateAdminToken, (req, res) => {
    try {
        const data = dbHelpers.getAnalyticsData();
        res.json({ success: true, data });
    } catch (error) {
        console.error("Analytics Error: ", error);
        res.status(500).json({ success: false, message: 'Failed to fetch analytics' });
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

// Update User Status (Admin)
app.post('/api/admin/rider/status', authenticateAdminToken, (req, res) => {
    const { riderId, status } = req.body;
    if (!riderId || !status) return res.status(400).json({ success: false, message: 'User ID and Status required' });

    try {
        const rider = dbHelpers.getRiderById(riderId);
        if (!rider) return res.status(404).json({ success: false, message: 'Rider not found' });

        rider.status = status;

        // If activating and no expiry date is set, grant 12 months from now
        if (status === 'Active' && !rider.expiryDate) {
            const expiry = new Date();
            expiry.setMonth(expiry.getMonth() + 12);
            rider.expiryDate = expiry.toISOString().split('T')[0];
        }

        dbHelpers.updateRider(rider.riderId, rider);
        saveToGoogleSheets(rider);
        res.json({ success: true, message: `Rider ${riderId} status updated to ${status}`, expiryDate: rider.expiryDate });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update status' });
    }
});

// Admin Force Reset User PIN
app.post('/api/admin/rider/reset-pin', authenticateAdminToken, async (req, res) => {
    const { riderId, newPin } = req.body;
    if (!riderId || !newPin) return res.status(400).json({ success: false, message: 'User ID and new PIN required' });
    if (newPin.length !== 4) return res.status(400).json({ success: false, message: 'PIN must be exactly 4 digits' });

    try {
        const rider = dbHelpers.getRiderById(riderId);
        if (!rider) return res.status(404).json({ success: false, message: 'Rider not found' });

        const salt = await bcrypt.genSalt(10);
        rider.pin = await bcrypt.hash(newPin, salt);
        dbHelpers.updateRider(riderId, rider);
        
        res.json({ success: true, message: `PIN for ${riderId} reset successfully` });
    } catch (err) {
        console.error('Admin PIN reset error:', err);
        res.status(500).json({ success: false, message: 'Failed to reset PIN' });
    }
});

// Admin Delete Rider
app.delete('/api/admin/rider/:id', authenticateAdminToken, async (req, res) => {
    const riderId = req.params.id;
    try {
        const rider = dbHelpers.getRiderById(riderId);
        if (!rider) return res.status(404).json({ success: false, message: 'Rider not found' });
        
        // Delete rider and associations from DB
        dbHelpers.deleteRider(riderId);
        
        // Try to delete physical images if they exist
        const fs = require('fs');
        const path = require('path');
        if (rider.passportImage) {
            const passportPath = path.join(UPLOADS_DIR, rider.passportImage.replace('/uploads/', ''));
            if (fs.existsSync(passportPath)) fs.unlinkSync(passportPath);
        }
        if (rider.idCardImage) {
            const idCardPath = path.join(UPLOADS_DIR, rider.idCardImage.replace('/uploads/', ''));
            if (fs.existsSync(idCardPath)) fs.unlinkSync(idCardPath);
        }
        
        res.json({ success: true, message: `Rider ${riderId} deleted successfully` });
    } catch (err) {
        console.error('Admin delete rider error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete rider' });
    }
});

// Admin Delete Agent
app.delete('/api/admin/agent/:id', authenticateAdminToken, async (req, res) => {
    const agentId = req.params.id;
    try {
        const agent = dbHelpers.getAgentById(agentId);
        if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });
        
        dbHelpers.deleteAgent(agentId);
        res.json({ success: true, message: `Agent ${agentId} deleted successfully` });
    } catch (err) {
        console.error('Admin delete agent error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete agent' });
    }
});

// Admin Free Registration Links Endpoints
app.post('/api/admin/free-links/generate', authenticateAdminToken, (req, res) => {
    try {
        const count = parseInt(req.body.count) || 300;
        const notes = req.body.notes || '';
        const result = dbHelpers.createFreeLinks(count, notes);
        const stats = dbHelpers.getFreeLinksStats();
        res.json({ success: true, message: `Successfully generated ${result.count} free registration links.`, result, stats });
    } catch (error) {
        console.error('Error generating free links:', error);
        res.status(500).json({ success: false, message: 'Failed to generate free registration links' });
    }
});

app.get('/api/admin/free-links', authenticateAdminToken, (req, res) => {
    try {
        const { status, search, page, limit } = req.query;
        const linksData = dbHelpers.getFreeLinks({ status, search, page: parseInt(page) || 1, limit: parseInt(limit) || 50 });
        const stats = dbHelpers.getFreeLinksStats();
        res.json({ success: true, ...linksData, stats });
    } catch (error) {
        console.error('Error fetching free links:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch free links' });
    }
});

app.post('/api/admin/free-links/delete', authenticateAdminToken, (req, res) => {
    try {
        const { ids, clearUnused } = req.body;
        const result = dbHelpers.deleteFreeLinks({ ids, clearUnused });
        const stats = dbHelpers.getFreeLinksStats();
        res.json({ success: true, message: `Deleted ${result.deletedCount} links.`, stats });
    } catch (error) {
        console.error('Error deleting free links:', error);
        res.status(500).json({ success: false, message: 'Failed to delete free links' });
    }
});

// ── CLINICAL EMERGENCY & BREAK-GLASS SURVEILLANCE ENDPOINTS ──────────────────

// GET /api/admin/access-logs - Fetch national emergency & QR access audit logs with filtering
app.get('/api/admin/access-logs', authenticateAdminToken, (req, res) => {
    try {
        const { type, flagStatus, riderId, limit } = req.query;
        const logs = dbHelpers.getAllAccessLogs({ type, flagStatus, riderId, limit });
        res.json({ success: true, logs });
    } catch (error) {
        console.error('Error fetching admin access logs:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch access logs' });
    }
});

// POST /api/admin/access-logs/flag - Update compliance audit flag on an access log
app.post('/api/admin/access-logs/flag', authenticateAdminToken, (req, res) => {
    try {
        const { id, flagStatus, adminNotes } = req.body;
        if (!id) return res.status(400).json({ success: false, message: 'Log ID is required' });
        const ok = dbHelpers.flagAccessLog(id, flagStatus, adminNotes);
        if (ok) {
            res.json({ success: true, message: 'Access log audit flag updated successfully' });
        } else {
            res.status(500).json({ success: false, message: 'Failed to update access log audit flag' });
        }
    } catch (error) {
        console.error('Error flagging access log:', error);
        res.status(500).json({ success: false, message: 'Server error flagging access log' });
    }
});

// GET /api/admin/emergency-sessions/active - Surveillance of currently active emergency sessions
app.get('/api/admin/emergency-sessions/active', authenticateAdminToken, (req, res) => {
    try {
        const seen = new Set();
        const active = [];
        for (const session of emergencySessions.values()) {
            if (session && session.sessionId && !seen.has(session.sessionId)) {
                seen.add(session.sessionId);
                active.push({
                    sessionId: session.sessionId,
                    numericId: session.numericId,
                    riderId: session.riderId,
                    sessionUrl: session.sessionUrl,
                    createdAt: session.createdAt,
                    location: session.location,
                    isClinicallyUnlocked: !!session.isClinicallyUnlocked,
                    clinicalAccessDetails: session.clinicalAccessDetails || null,
                    citizenName: session.rider?.fullName || session.rider?.name || 'Unknown Patient',
                    citizenPhone: session.rider?.phone || '',
                    bloodGroup: session.rider?.emergencyBloodGroup || session.rider?.medical?.bloodGroup || '',
                    genotype: session.rider?.emergencyGenotype || session.rider?.medical?.genotype || ''
                });
            }
        }
        res.json({ success: true, activeSessions: active });
    } catch (error) {
        console.error('Error fetching active emergency sessions:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch active emergency sessions' });
    }
});

// POST /api/admin/emergency-sessions/terminate/:sessionId - Remote kill-switch for emergency sessions
app.post('/api/admin/emergency-sessions/terminate/:sessionId', authenticateAdminToken, (req, res) => {
    try {
        const key = req.params.sessionId;
        let session = emergencySessions.get(key);
        if (!session && !isNaN(key)) session = emergencySessions.get(parseInt(key, 10));

        if (!session) {
            return res.status(404).json({ success: false, message: 'Emergency session not found or already terminated' });
        }

        emergencySessions.delete(session.sessionId);
        emergencySessions.delete(session.numericId);

        // Record statutory administrative override into access_logs
        if (session.riderId) {
            dbHelpers.logAccess(session.riderId, req.ip, req.headers['user-agent'], 'National Command Center', {
                accessType: 'admin_killswitch',
                accessorName: req.body.adminName || 'MyVault National Admin',
                facility: 'National Command Center (Surveillance)',
                role: 'System Administrator',
                reason: req.body.reason || 'Administrative termination of active emergency session'
            });
        }

        res.json({ success: true, message: `Emergency session ${session.sessionId} successfully terminated.` });
    } catch (error) {
        console.error('Error terminating emergency session:', error);
        res.status(500).json({ success: false, message: 'Failed to terminate emergency session' });
    }
});

// Public Free Registration Link Validation Endpoint
app.get('/api/free-token/validate', apiLimiter, (req, res) => {
    try {
        const token = req.query.token;
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const validation = dbHelpers.claimOrValidateFreeLink(token, clientIp);
        res.json(validation);
    } catch (error) {
        console.error('Error validating token:', error);
        res.status(500).json({ valid: false, message: 'Server error validating link' });
    }
});

// ---------------------------------------------------------
// AGENT ROUTES
// ---------------------------------------------------------

app.post('/api/agent/login', authLimiter, async (req, res) => {
    const { phone, pin } = req.body || {};
    if (!phone || !pin) return res.status(400).json({ success: false, message: 'Phone and PIN are required.' });
    
    const agent = dbHelpers.getAgentByPhone(phone);
    if (!agent) return res.status(401).json({ success: false, message: 'Invalid phone number or PIN' });

    try {
        const isMatch = await bcrypt.compare(String(pin).trim(), agent.pin);
        if (isMatch) {
            agent.tokenVersion = (agent.tokenVersion || 0) + 1;
            dbHelpers.updateAgent(agent.agentId, agent);
            const token = jwt.sign({ agentId: agent.agentId, role: 'agent', tokenVersion: agent.tokenVersion }, JWT_SECRET, { expiresIn: '12h' });
            setAuthCookie(res, 'auth_token', token, 12 * 60 * 60 * 1000);
            res.json({ success: true, token, agent: { name: agent.name, agentId: agent.agentId } });
        } else {
            res.status(401).json({ success: false, message: 'Invalid phone number or PIN' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: IS_PRODUCTION ? 'Login error' : err.message });
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

        const { name, phone, altPhone, address, dob, plateNumber, userType, vehicleType, bloodType, allergies, emergencyContactName, emergencyContactPhone, emergencyContactsStr } = req.body;
        let emergencyContacts = [];
        try { if (emergencyContactsStr) emergencyContacts = JSON.parse(emergencyContactsStr); } catch(e) {}
        if (emergencyContacts.length === 0 && emergencyContactName) {
            emergencyContacts.push({ name: emergencyContactName, phone: emergencyContactPhone });
        }
        if (dbHelpers.getRiderByPhone(phone)) return res.status(400).json({ success: false, message: 'Phone number already registered' });

        // Generate random PIN if agent didn't provide one
        const plainPin = req.body.pin || Math.floor(1000 + Math.random() * 9000).toString();
        const salt = await bcrypt.genSalt(10);
        const hashedPin = await bcrypt.hash(plainPin, salt);

        const riderId = `SID-${Math.floor(10000 + Math.random() * 90000)}`;
        const reference = `PAY-${Date.now()}`;
        
        const newRider = {
            riderId, name, phone, altPhone, address, dob, plateNumber: plateNumber || '',
            pin: hashedPin,
            userType: userType || 'driver',
            registrationDate: new Date().toISOString().split('T')[0],
            vehicleType: vehicleType || (userType === 'non-driver' ? null : 'motorcycle'),
            bike: { plateNumber: plateNumber || '' },
            vehicle: { type: vehicleType || (userType === 'non-driver' ? null : 'motorcycle'), plateNumber: plateNumber || '' },
            documents: {}, 
            medical: { bloodGroup: bloodType || '', allergies: allergies || 'None' },
            emergencyContacts: emergencyContacts,
            emergencyContact: emergencyContacts[0] || { name: emergencyContactName || '', phone: emergencyContactPhone || '' },
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

        res.json({ 
            success: true, 
            riderId, 
            reference, 
            paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY,
            message: 'User registered successfully!' 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Registration failed' });
    }
});

app.post('/api/agent/upload-docs/:riderId', authenticateAgentToken, upload.fields([
    { name: 'passportPhoto', maxCount: 1 },
    { name: 'licenseDoc', maxCount: 1 },
    { name: 'bikePapers', maxCount: 1 },
    { name: 'insuranceDoc', maxCount: 1 },
    { name: 'ninDoc', maxCount: 1 },
    { name: 'healthInsuranceDoc', maxCount: 1 }
]), async (req, res) => {
    try {
        const riderId = req.params.riderId;
        const rider = dbHelpers.getRiderById(riderId);
        
        if (!rider) return res.status(404).json({ success: false, message: 'Rider not found' });
        if (rider.onboardedBy !== req.user.agentId) return res.status(403).json({ success: false, message: 'Unauthorized. You did not onboard this user.' });
        if (rider.status === 'Active') return res.status(400).json({ success: false, message: 'User is already active. Cannot modify documents anymore.' });

        // Verify Paystack Payment before accepting docs
        const isPaid = await verifyPaystackPayment(rider.reference);
        if (!isPaid) {
            return res.status(402).json({ success: false, message: 'Payment verification failed. You must pay the fee before uploading documents.' });
        }

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
        
        // Auto-Activate since payment is verified and docs are uploaded
        rider.status = 'Active';
        rider.expiryDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        dbHelpers.updateRider(riderId, rider);
        res.json({ success: true, message: 'Documents uploaded successfully and User is now Active!' });
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

        // Fire-and-forget: notify emergency contacts
        const contacts = rider.emergencyContacts || [];
        if (contacts.length === 0 && rider.emergencyContact) contacts.push(rider.emergencyContact);
        
        contacts.forEach(contact => {
            if (contact && contact.phone) {
                const locText = session.location?.name ? ` near ${session.location.name}` : '';
                const msg = `🚨 EMERGENCY: ${rider.name} has triggered a SOS alert${locText}. ` +
                            `View their emergency profile here: ${sessionUrl}`;
                sendSMS(contact.phone, msg).catch(() => {});
            }
        });

        console.log(`[SOS] Emergency session created: ${sessionId} for rider ${riderId}`);
        res.json({ success: true, sessionId, numericId, sessionUrl });
    } catch (err) {
        console.error('Emergency Create Error:', err);
        res.status(500).json({ success: false, message: 'Failed to create emergency session' });
    }
});

// ── GET /api/qr/token/:riderId ──────────────────────────────────────────────
// Generates a short-lived signed dynamic QR token for digital app screens (anti-screenshot)
app.get('/api/qr/token/:riderId', (req, res) => {
    try {
        const { riderId } = req.params;
        const rider = dbHelpers.getRiderById(riderId);
        if (!rider) return res.status(404).json({ success: false, message: 'Rider not found' });
        
        const t = Date.now();
        const token = generateQrToken(riderId, t);
        const cvv = generateCardCvv(riderId);
        res.json({
            success: true,
            riderId,
            t,
            token,
            cvv,
            ttl: 45 // seconds validity window
        });
    } catch (err) {
        console.error('QR Token Error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ── GET /scan/:riderId ───────────────────────────────────────────────────────
// Smart QR scan endpoint. Detects live app screen, physical PVC/sticker, or stale screenshot.
app.get('/scan/:riderId', async (req, res) => {
    try {
        const riderId = req.params.riderId;
        const rider = dbHelpers.getRiderById(riderId);
        if (!rider) return res.status(404).send('Rider not found or deactivated.');

        const sessionId = generateSessionId();
        const numericId = sessionId.replace('MV-EMG-', '');
        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
        const sessionUrl = `${baseUrl}/emergency/${numericId}`;

        // ── Analyze Scan Source & Screenshot Detection ──────────────────────
        const { src, t, token } = req.query;
        let scanDetails = {
            scanType: src || 'standard',
            status: 'live',
            isLive: true,
            isPhysical: false,
            message: 'Verified Live Scan',
            cvv: generateCardCvv(riderId),
            scannedAt: new Date().toISOString()
        };

        if (src === 'digital') {
            const timestamp = parseInt(t, 10);
            const now = Date.now();
            const ageSeconds = !isNaN(timestamp) ? Math.round((now - timestamp) / 1000) : 999999;
            const expectedToken = !isNaN(timestamp) ? generateQrToken(riderId, timestamp) : '';
            const isSignatureValid = token && token === expectedToken;

            if (!isSignatureValid) {
                scanDetails = {
                    scanType: 'digital_invalid',
                    status: 'screenshot',
                    isLive: false,
                    isPhysical: false,
                    ageSeconds,
                    message: '⚠️ UNVERIFIED DIGITAL PASS',
                    scannedAt: new Date().toISOString()
                };
            } else if (ageSeconds > 60) {
                // Screenshot / Expired Digital Pass
                const minsAgo = Math.round(ageSeconds / 60);
                scanDetails = {
                    scanType: 'digital_screenshot',
                    status: 'screenshot',
                    isLive: false,
                    isPhysical: false,
                    ageSeconds,
                    message: `⚠️ SCREENSHOT / EXPIRED QR DETECTED (${minsAgo > 1 ? minsAgo + ' minutes old' : ageSeconds + ' seconds old'})`,
                    capturedAt: new Date(timestamp).toLocaleTimeString(),
                    scannedAt: new Date().toISOString()
                };
            } else {
                // Verified Live Digital App Scan
                scanDetails = {
                    scanType: 'digital_live',
                    status: 'live',
                    isLive: true,
                    isPhysical: false,
                    ageSeconds,
                    message: '✅ VERIFIED LIVE DIGITAL PASS (Active App Screen)',
                    scannedAt: new Date().toISOString()
                };
            }
        } else {
            // Direct physical card scan (Standard clean URL: /scan/:riderId with no query params)
            const tagLabel = src === 'sticker' ? 'Helmet/Windshield Sticker' : 'Physical PVC ID Card';
            scanDetails = {
                scanType: src || 'physical_pvc',
                status: 'physical',
                isLive: true,
                isPhysical: true,
                tagLabel,
                cvv: generateCardCvv(riderId),
                message: `🏷️ AUTHENTIC PHYSICAL CREDENTIAL (${tagLabel})`,
                scannedAt: new Date().toISOString()
            };
        }

        // Safe rider snapshot
        const { pin, ...safeRider } = rider;

        const session = {
            sessionId,
            numericId,
            riderId,
            sessionUrl,
            createdAt: new Date().toISOString(),
            location: null,
            rider: safeRider,
            scanDetails
        };

        emergencySessions.set(sessionId, session);
        emergencySessions.set(numericId, session);

        // Audit Trail: Log QR scan event
        const clientIp = req.ip || req.headers['x-forwarded-for'] || '';
        const userAgent = req.get('user-agent') || '';
        dbHelpers.logAccess(riderId, clientIp, userAgent, '', {
            accessType: scanDetails.scanType || 'public_scan',
            reason: scanDetails.message || 'QR Code Scan'
        });

        // Notify emergency contacts with appropriate context
        const contacts = rider.emergencyContacts || [];
        if (contacts.length === 0 && rider.emergencyContact) contacts.push(rider.emergencyContact);
        
        contacts.forEach(contact => {
            if (contact && contact.phone) {
                let alertHeader = '🚨 EMERGENCY SCAN';
                if (scanDetails.status === 'screenshot') {
                    alertHeader = '⚠️ EXPIRED / SCREENSHOT SCAN ALERT';
                } else if (scanDetails.isPhysical) {
                    alertHeader = `🚨 PHYSICAL ${scanDetails.tagLabel ? scanDetails.tagLabel.toUpperCase() : 'TAG'} SCAN`;
                }
                const msg = `${alertHeader}: ${rider.name}'s MyVault ID was just scanned. ` +
                            `View emergency profile: ${sessionUrl}`;
                sendSMS(contact.phone, msg).catch(() => {});
            }
        });

        console.log(`[SCAN] QR Code scanned for ${riderId} [${scanDetails.scanType} / ${scanDetails.status}]. Redirecting to ${sessionUrl}`);
        res.redirect(`/emergency/${numericId}`);
    } catch (err) {
        console.error('Scan Error:', err);
        res.status(500).send('Server Error');
    }
});

// Mask phone helper (protects personal privacy on public scan)
function maskPhoneNumber(p) {
    if (!p || p.length < 6) return '---';
    const s = String(p).trim();
    return s.slice(0, 4) + ' *** ' + s.slice(-4);
}

// ── GET Emergency Session (🔴 LEVEL 1 EMERGENCY PROFILE - PUBLIC SCAN) ─────────
// Answers: "What do I need to know about this person RIGHT NOW?"
// Data minimization: excludes NIN, full addresses, internal docs, unmasked phone.
app.get('/api/emergency/:sessionId', (req, res) => {
    const key = req.params.sessionId;
    let session = emergencySessions.get(key);
    if (!session && !isNaN(key)) session = emergencySessions.get(parseInt(key, 10));

    // Fallback: If session was lost from memory (server restart, container sleep)
    // or if accessed directly with a rider ID or numeric ID:
    if (!session) {
        let rider = dbHelpers.getRiderById(key);
        if (!rider && !isNaN(key)) {
            rider = dbHelpers.getRiderById(`RID-${key}`);
        }
        if (rider) {
            const sessionId = generateSessionId();
            const numericId = sessionId.replace('MV-EMG-', '');
            const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
            session = {
                sessionId,
                numericId,
                riderId: rider.riderId,
                sessionUrl: `${baseUrl}/emergency/${numericId}`,
                createdAt: new Date().toISOString(),
                location: null,
                rider,
                scanDetails: {
                    scanType: 'physical_pvc',
                    status: 'physical',
                    isLive: true,
                    isPhysical: true,
                    tagLabel: 'Physical PVC ID Card',
                    cvv: generateCardCvv(rider.riderId),
                    message: '🏷️ AUTHENTIC PHYSICAL CREDENTIAL (Physical PVC ID Card)',
                    scannedAt: new Date().toISOString()
                }
            };
            emergencySessions.set(sessionId, session);
            emergencySessions.set(numericId, session);
            emergencySessions.set(key, session);
        }
    }

    if (!session) {
        return res.status(404).json({ success: false, message: 'Emergency session not found or expired' });
    }

    try {
        const { pin, ...fullRider } = dbHelpers.getRiderById(session.riderId) || session.rider;
        const med = fullRider.medical || {};

        const level1Rider = {
            name: fullRider.name || fullRider.fullName || 'Citizen Profile',
            maskedPhone: maskPhoneNumber(fullRider.phone),
            riderId: fullRider.riderId,
            userType: fullRider.userType || 'citizen',
            plateNumber: fullRider.plateNumber || (fullRider.bike && fullRider.bike.plateNumber) || (fullRider.vehicle && fullRider.vehicle.plateNumber) || '',
            emergencyContact: fullRider.emergencyContact || null,
            emergencyContacts: fullRider.emergencyContacts || (fullRider.emergencyContact ? [fullRider.emergencyContact] : []),
            medical: {
                bloodGroup: med.bloodGroup || '---',
                genotype: med.genotype || '---',
                allergies: med.allergies || 'None reported',
                conditions: med.conditions || 'None reported',
                medications: med.medications || 'None reported',
                refusesBloodTransfusion: !!med.refusesBloodTransfusion,
                advanceDirectiveStatement: med.advanceDirectiveStatement || '',
                primaryDoctorName: med.primaryDoctorName || '',
                primaryDoctorPhone: med.primaryDoctorPhone || '',
                hospitalPreference: med.hospitalPreference || '',
                gender: med.gender || '',
                dateOfBirth: med.dateOfBirth || fullRider.dob || ''
            },
            documents: (fullRider.documents && fullRider.documents.passportPhoto) ? { passportPhoto: fullRider.documents.passportPhoto } : {}
        };

        const level1Session = { 
            sessionId: session.sessionId,
            numericId: session.numericId,
            createdAt: session.createdAt,
            rider: level1Rider,
            isClinicallyUnlocked: !!session.isClinicallyUnlocked,
            clinicalAccessDetails: session.clinicalAccessDetails || null,
            scanDetails: session.scanDetails || { scanType: 'standard', status: 'live', isLive: true, message: 'Standard Scan', cvv: generateCardCvv(session.riderId) }
        };
        
        res.json({ success: true, session: level1Session, isLevel1: true });
    } catch (e) {
        console.error('Level 1 Error:', e);
        res.status(500).json({ success: false, message: 'Error retrieving emergency profile' });
    }
});

// ── CLINICAL EMERGENCY ACCESS / BREAK-GLASS (🔵 LEVEL 2 AUTHORISED CLINICAL DATA) ─────
// Protocol for ER doctors, triage nurses, and paramedics treating patients unable to communicate.
// Required: Clinician Name, Facility/Hospital, Role, Emergency Justification.
// Automatically records immutable audit trail and notifies next of kin.
app.post(['/api/emergency/:sessionId/unlock', '/api/emergency/:sessionId/breakglass'], apiLimiter, async (req, res) => {
    try {
        const key = req.params.sessionId;
        let session = emergencySessions.get(key);
        if (!session && !isNaN(key)) session = emergencySessions.get(parseInt(key, 10));

        if (!session) {
            return res.status(404).json({ success: false, message: 'Emergency session not found or expired' });
        }

        const { accessorName, facility, role, reason, accessorPhone } = req.body || {};

        if (!accessorName || !facility || !reason) {
            return res.status(400).json({ 
                success: false, 
                message: 'Clinical Access requires Clinician Name, Medical Facility, and Emergency Reason.' 
            });
        }

        const riderId = session.riderId;
        const rider = dbHelpers.getRiderById(riderId) || session.rider;

        const auditMeta = {
            accessType: 'clinical_breakglass',
            accessorName: String(accessorName).trim(),
            facility: String(facility).trim(),
            role: (role || 'Healthcare Professional').trim(),
            reason: String(reason).trim(),
            accessorPhone: accessorPhone ? String(accessorPhone).trim() : null
        };

        const clientIp = req.ip || req.headers['x-forwarded-for'] || '';
        const userAgent = req.get('user-agent') || '';

        // 1. Immutable Audit Logging
        const logResult = dbHelpers.logAccess(riderId, clientIp, userAgent, session.location?.name || '', auditMeta);

        // 2. Automated Alert to Next of Kin
        const contacts = rider.emergencyContacts || [];
        if (contacts.length === 0 && rider.emergencyContact) contacts.push(rider.emergencyContact);

        contacts.forEach(contact => {
            if (contact && contact.phone) {
                const alertMsg = `🚨 MyVault Notice: Emergency Clinical Access was requested for ${rider.name} at ${auditMeta.facility} by ${auditMeta.accessorName} (${auditMeta.role}). Reason: ${auditMeta.reason}.`;
                sendSMS(contact.phone, alertMsg).catch(() => {});
            }
        });

        // 3. Mark session as clinically unlocked with audit trail details
        const auditInfo = {
            auditId: logResult.id ? `MV-AUDIT-${logResult.id}` : `MV-AUDIT-${Date.now().toString().slice(-6)}`,
            ...auditMeta,
            accessedAt: logResult.timestamp,
            ip: clientIp
        };

        session.isClinicallyUnlocked = true;
        session.clinicalAccessDetails = auditInfo;

        const { pin, ...safeRider } = rider;
        const unlockedSession = {
            ...session,
            rider: safeRider,
            clinicalAccessDetails: auditInfo
        };

        console.log(`[BREAKGLASS] Clinical access granted for ${riderId} by ${auditMeta.accessorName} at ${auditMeta.facility}`);

        res.json({
            success: true,
            message: 'Clinical emergency access granted and audit log committed.',
            session: unlockedSession,
            audit: auditInfo
        });
    } catch (err) {
        console.error('Break-glass Error:', err);
        res.status(500).json({ success: false, message: 'Failed to process clinical emergency access' });
    }
});

// ── Serve emergency.html for /emergency/* paths ───────────────────────────────
app.get('/emergency/:sessionId', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'emergency.html'));
});

// ── Serve Privacy & Terms Clean Routes ─────────────────────────────────────────
app.get('/privacy', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'privacy.html'));
});

app.get('/terms', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'terms.html'));
});

// ── Legacy SOS Endpoint (kept for ICE hub compatibility) ─────────────────────
// POST /api/sos/:riderId  — alerts next of kin via SMS
app.post('/api/sos/:riderId', authLimiter, async (req, res) => {
    try {
        const riderId = req.params.riderId;
        const rider = dbHelpers.getRiderById(riderId);
        
        if (!rider) return res.status(404).json({ success: false, message: 'Rider not found' });
        
        const contacts = rider.emergencyContacts || [];
        if (contacts.length === 0 && rider.emergencyContact) contacts.push(rider.emergencyContact);
        
        if (contacts.length === 0) {
            return res.status(400).json({ success: false, message: 'No emergency contact on file for this rider.' });
        }

        const message = `URGENT: Someone has just accessed the Emergency Medical Profile for ${rider.name}. If this is unexpected, please try contacting them immediately.`;
        
        for (const contact of contacts) {
            if (contact && contact.phone) {
                await sendSMS(contact.phone, message).catch(() => {});
            }
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
    { name: 'advanceDirectiveDoc', maxCount: 1 },
    { name: 'healthInsuranceDoc', maxCount: 1 }
]), async (req, res) => {
    try {
        const riderId = req.params.riderId;
        // Verify user is updating their own profile or is admin
        if (req.user.riderId !== riderId && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized profile update' });
        }
        
        const rider = dbHelpers.getRiderById(riderId);
        if (!rider) return res.status(404).json({ success: false, message: 'Profile not found' });
        
        const { name, bloodType, allergies, emergencyContactName, emergencyContactPhone, licenseNumber, licenseExpiry, insuranceNumber, insuranceExpiry, ninNumber, bikeBrand, bikeModel, bikeColor, ownershipType, plateNumber, refusesBloodTransfusion, advanceDirectiveStatement, conditions, medications, immunizations, height, weight, gender, dateOfBirth, identifyingMarks, primaryDoctorName, primaryDoctorPhone, hospitalPreference, surgeries, recentVitals, communicationNeeds, healthInsuranceProvider, healthInsurancePolicy, organDonor, donorRestrictions } = req.body;
        
        if (name && name.trim() !== '' && (riderId === 'RID-71447' || riderId === 'SID-71447' || riderId === '71447')) {
            rider.name = name.trim();
        }
        
        rider.documents = rider.documents || {};
        
        // Update documents
        if (req.files && req.files.passportPhoto) {
            rider.documents.passportPhoto = { url: `/uploads/${req.files.passportPhoto[0].filename}` };
        }
        
        const docFields = ['licenseDoc', 'insuranceDoc', 'bikePapers', 'ninDoc', 'advanceDirectiveDoc', 'healthInsuranceDoc'];
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
        if (allergies !== undefined) {
            rider.medical.allergies = allergies;
            rider.allergies = allergies;
        }
        if (refusesBloodTransfusion !== undefined) {
            rider.medical.refusesBloodTransfusion = refusesBloodTransfusion === 'true' || refusesBloodTransfusion === true;
        }
        if (advanceDirectiveStatement !== undefined) {
            rider.medical.advanceDirectiveStatement = advanceDirectiveStatement;
        }
        if (conditions !== undefined) rider.medical.conditions = conditions;
        if (medications !== undefined) rider.medical.medications = medications;
        if (immunizations !== undefined) rider.medical.immunizations = immunizations;
        if (height !== undefined) rider.medical.height = height;
        if (weight !== undefined) rider.medical.weight = weight;
        if (gender !== undefined) rider.medical.gender = gender;
        if (dateOfBirth !== undefined) rider.medical.dateOfBirth = dateOfBirth;
        if (identifyingMarks !== undefined) rider.medical.identifyingMarks = identifyingMarks;
        if (primaryDoctorName !== undefined) rider.medical.primaryDoctorName = primaryDoctorName;
        if (primaryDoctorPhone !== undefined) rider.medical.primaryDoctorPhone = primaryDoctorPhone;
        if (hospitalPreference !== undefined) rider.medical.hospitalPreference = hospitalPreference;
        if (surgeries !== undefined) rider.medical.surgeries = surgeries;
        if (recentVitals !== undefined) rider.medical.recentVitals = recentVitals;
        if (communicationNeeds !== undefined) rider.medical.communicationNeeds = communicationNeeds;
        if (healthInsuranceProvider !== undefined) rider.medical.healthInsuranceProvider = healthInsuranceProvider;
        if (healthInsurancePolicy !== undefined) rider.medical.healthInsurancePolicy = healthInsurancePolicy;
        if (organDonor !== undefined) rider.medical.organDonor = organDonor === 'true' || organDonor === true;
        if (donorRestrictions !== undefined) rider.medical.donorRestrictions = donorRestrictions;
        
        // Update emergency contacts
        let newContacts = [];
        const { emergencyContactsStr } = req.body;
        try { if (emergencyContactsStr) newContacts = JSON.parse(emergencyContactsStr); } catch(e) {}
        
        if (newContacts.length > 0) {
            rider.emergencyContacts = newContacts;
            rider.emergencyContact = newContacts[0];
        } else {
            rider.emergencyContact = rider.emergencyContact || {};
            if (emergencyContactName) rider.emergencyContact.name = emergencyContactName;
            if (emergencyContactPhone) rider.emergencyContact.phone = emergencyContactPhone;
        }
        
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
    if (!rider) {
        return res.json({ success: false, message: 'Rider not found' });
    }

    let isAdmin = false;
    const authHeader = req.headers['authorization'];
    if (authHeader) {
        const token = authHeader.split(' ')[1];
        try {
            const user = jwt.verify(token, JWT_SECRET);
            if (user && user.role === 'admin') isAdmin = true;
        } catch (e) {}
    }

    if (isAdmin) {
        const safeRider = { ...rider, cvv: generateCardCvv(rider.riderId) };
        delete safeRider.pin;
        return res.json({ success: true, rider: safeRider, isLevel1: false, isAdmin: true, paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY });
    }

    // Strip sensitive data for Level 1 access (Public scan)
    const level1Rider = {
        name: rider.name,
        phone: rider.phone,
        riderId: rider.riderId,
        cvv: generateCardCvv(rider.riderId),
        userType: rider.userType || 'driver',
        status: rider.status,
        expiryDate: rider.expiryDate,
        vehicleType: rider.vehicleType,
        safety: rider.safety,
        vehicle: rider.vehicle,
        bike: rider.bike,
        emergencyContact: rider.emergencyContact,
        paymentRequested: rider.paymentRequested,
        allergies: (rider.medical && rider.medical.allergies) || rider.allergies || rider.riderAllergies || 'None',
        dob: rider.dob || (rider.medical && rider.medical.dateOfBirth) || '',
        medical: { 
            bloodGroup: (rider.medical && rider.medical.bloodGroup) || '---',
            genotype: (rider.medical && rider.medical.genotype) || '---',
            allergies: (rider.medical && rider.medical.allergies) || rider.allergies || rider.riderAllergies || 'None',
            dateOfBirth: (rider.medical && rider.medical.dateOfBirth) || rider.dob || '',
            refusesBloodTransfusion: rider.medical ? !!rider.medical.refusesBloodTransfusion : false
        },
        // Only include passport photo, hide all other documents and expiry dates
        documents: rider.documents && rider.documents.passportPhoto ? { passportPhoto: rider.documents.passportPhoto } : {}
    };
    res.json({ success: true, rider: level1Rider, isLevel1: true, paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY });
});

// Unlock Endpoint for Public Profile (Level 2) - Protected by Authentication or PIN
app.post('/api/verify/:query/unlock', authLimiter, async (req, res) => {
    const query = String(req.params.query || '').toLowerCase().trim();
    const rider = dbHelpers.findRiderByQuery(query);
    if (!rider) {
        return res.status(404).json({ success: false, message: 'Rider not found' });
    }

    // Check if caller is authenticated owner or admin via token
    const token = extractToken(req, 'auth_token');
    let isAuthorized = false;
    if (token) {
        try {
            const user = jwt.verify(token, JWT_SECRET);
            if (user && (user.riderId === rider.riderId || user.role === 'admin' || user.role === 'agent')) {
                isAuthorized = true;
            }
        } catch (e) {}
    }

    // If not authenticated via token, check if PIN was submitted in request body
    if (!isAuthorized) {
        const inputPin = req.body && req.body.pin ? String(req.body.pin).trim() : null;
        if (inputPin && rider.pin) {
            const isPinMatch = await bcrypt.compare(inputPin, rider.pin);
            if (isPinMatch) {
                isAuthorized = true;
            }
        }
    }

    if (!isAuthorized) {
        return res.status(401).json({ success: false, message: 'Authentication required. Please provide valid credentials or owner PIN to unlock full profile details.' });
    }

    const { pin, ...safeRiderData } = rider;
    if (safeRiderData.medical) {
        if (!safeRiderData.medical.allergies && (rider.allergies || rider.riderAllergies)) {
            safeRiderData.medical.allergies = rider.allergies || rider.riderAllergies;
        }
    } else if (rider.allergies || rider.riderAllergies) {
        safeRiderData.medical = {
            allergies: rider.allergies || rider.riderAllergies,
            bloodGroup: rider.bloodType || '---',
            genotype: rider.genotype || '---'
        };
    }
    safeRiderData.allergies = (safeRiderData.medical && safeRiderData.medical.allergies) || rider.allergies || rider.riderAllergies || 'None';
    dbHelpers.logAccess(rider.riderId, req.ip, req.headers['user-agent'] || '', 'Level 2 Authenticated Unlock');
    res.json({ success: true, rider: safeRiderData });
});

// --- OTP Cache for PIN Reset (With Anti-Brute-Force Limiters) ---
const otpStore = new Map(); // phone -> { otp, expiresAt, attempts }

app.post('/api/rider/forgot-pin', otpRequestLimiter, async (req, res) => {
    const { loginId, phone } = req.body || {};
    const identifier = String(loginId || phone || '').trim();
    const rider = dbHelpers.getRiderByPhone(identifier) || dbHelpers.getRiderById(identifier);
    
    if (!rider) {
        // Return uniform success to prevent telephone enumeration attacks
        return res.json({ success: true, message: 'If the account exists, an OTP will be sent to the registered phone number.' });
    }

    const targetPhone = rider.phone;
    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    otpStore.set(targetPhone, { otp, expiresAt, attempts: 0 });

    // Send SMS
    const msg = `Your Regularise PIN reset OTP is ${otp}. It expires in 10 minutes.`;
    await sendSMS(targetPhone, msg);
    
    res.json({ success: true, message: 'OTP sent successfully' });
});

app.post('/api/rider/verify-otp', otpVerifyLimiter, (req, res) => {
    const { loginId, phone, otp } = req.body || {};
    const identifier = String(loginId || phone || '').trim();
    const inputOtp = String(otp || '').trim();
    const rider = dbHelpers.getRiderByPhone(identifier) || dbHelpers.getRiderById(identifier);
    const targetPhone = rider ? rider.phone : identifier;

    const record = otpStore.get(targetPhone);

    if (!record) {
        return res.status(400).json({ success: false, message: 'No OTP requested or expired' });
    }

    if (Date.now() > record.expiresAt) {
        otpStore.delete(targetPhone);
        return res.status(400).json({ success: false, message: 'OTP expired. Please request a new one.' });
    }

    record.attempts = (record.attempts || 0) + 1;
    if (record.attempts > 5) {
        otpStore.delete(targetPhone);
        return res.status(429).json({ success: false, message: 'Too many incorrect attempts. OTP has been invalidated.' });
    }

    if (record.otp !== inputOtp) {
        return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    res.json({ success: true, message: 'OTP verified' });
});

app.post('/api/rider/reset-pin', otpVerifyLimiter, async (req, res) => {
    const { loginId, phone, otp, newPin } = req.body || {};
    const identifier = String(loginId || phone || '').trim();
    const inputOtp = String(otp || '').trim();
    const pinStr = String(newPin || '').trim();
    const rider = dbHelpers.getRiderByPhone(identifier) || dbHelpers.getRiderById(identifier);
    
    if (!rider) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }
    const targetPhone = rider.phone;

    const record = otpStore.get(targetPhone);

    if (!record || Date.now() > record.expiresAt || record.otp !== inputOtp) {
        return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    if (!/^\d{4}$/.test(pinStr)) {
        return res.status(400).json({ success: false, message: 'PIN must be exactly 4 numeric digits' });
    }

    try {
        const salt = await bcrypt.genSalt(10);
        const hashedPin = await bcrypt.hash(pinStr, salt);

        rider.pin = hashedPin;
        dbHelpers.updateRider(rider.riderId, rider);
        
        // Invalidate OTP immediately upon successful consumption
        otpStore.delete(targetPhone);

        res.json({ success: true, message: 'PIN updated successfully' });
    } catch (err) {
        console.error("PIN reset error:", err.message);
        res.status(500).json({ success: false, message: IS_PRODUCTION ? 'Failed to reset PIN' : err.message });
    }
});

// User Login Endpoint
app.post('/api/rider/login', authLimiter, async (req, res) => {
    const { loginId, phone, pin } = req.body || {};
    const identifier = String(loginId || phone || '').trim();
    const inputPin = String(pin || '').trim();

    if (!identifier || !inputPin) {
        return res.status(400).json({ success: false, message: 'Login ID / Phone and PIN are required.' });
    }
    
    const rider = dbHelpers.getRiderByPhone(identifier) || dbHelpers.getRiderById(identifier) || dbHelpers.findRiderByQuery(identifier);
    
    if (!rider) {
        return res.status(401).json({ success: false, message: 'Invalid Phone Number, User ID or PIN' });
    }

    if (!rider.pin) {
        return res.status(401).json({ success: false, message: 'No PIN set for this account. Please register again.' });
    }

    try {
        const isMatch = await bcrypt.compare(inputPin, rider.pin);
        if (isMatch) {
            rider.tokenVersion = (rider.tokenVersion || 0) + 1;
            dbHelpers.updateRider(rider.riderId, rider);

            // Log login
            dbHelpers.logAccess(rider.riderId, req.ip, req.headers['user-agent'] || '', 'Owner Login');

            const token = jwt.sign({ riderId: rider.riderId, tokenVersion: rider.tokenVersion }, JWT_SECRET, { expiresIn: '24h' });
            setAuthCookie(res, 'auth_token', token, 24 * 60 * 60 * 1000);
            res.json({ success: true, riderId: rider.riderId, token });
        } else {
            res.status(401).json({ success: false, message: 'Invalid phone number or PIN' });
        }
    } catch (error) {
        console.error("Login error:", error.message);
        res.status(500).json({ success: false, message: IS_PRODUCTION ? 'Internal authentication error' : error.message });
    }
});

// Waitlist Registration (With Email Verification & Input Sanitization)
app.post('/api/waitlist', apiLimiter, [
    body('email').optional({ checkFalsy: true }).isEmail().normalizeEmail().withMessage('Please provide a valid email address'),
    body('phone').optional({ checkFalsy: true }).trim().isLength({ min: 10, max: 15 }).withMessage('Phone number must be between 10 and 15 digits')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: errors.array()[0].msg });
    }
    const { email, phone, wantsWhatsapp } = req.body;
    
    if (!email && !phone) {
        return res.status(400).json({ success: false, message: 'Please provide either an email or a phone number.' });
    }

    try {
        dbHelpers.insertWaitlist({ email, phone, wantsWhatsapp });
        res.json({ success: true, message: 'Successfully added to the waitlist!' });
    } catch (err) {
        console.error('Waitlist error:', err.message);
        res.status(500).json({ success: false, message: IS_PRODUCTION ? 'Failed to process waitlist entry' : err.message });
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

        const { name, phone, altPhone, address, dob, nationality, plateNumber, pin, vehicleType, bloodType, allergies, emergencyContactName, emergencyContactPhone, emergencyContactsStr, userType, freeToken } = req.body;
        let emergencyContacts = [];
        try { if (emergencyContactsStr) emergencyContacts = JSON.parse(emergencyContactsStr); } catch(e) {}
        if (emergencyContacts.length === 0 && emergencyContactName) {
            emergencyContacts.push({ name: emergencyContactName, phone: emergencyContactPhone });
        }
        
        if (dbHelpers.getRiderByPhone(phone)) {
            return res.status(400).json({ success: false, message: 'Phone number already registered' });
        }

        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        let isFreeRegistration = false;

        if (freeToken) {
            const validation = dbHelpers.claimOrValidateFreeLink(freeToken, clientIp);
            if (!validation.valid) {
                return res.status(400).json({ success: false, message: validation.message });
            }
            isFreeRegistration = true;
        }

        // Hash the PIN
        const salt = await bcrypt.genSalt(10);
        const hashedPin = await bcrypt.hash(pin, salt);

        const riderId = `SID-${Math.floor(10000 + Math.random() * 90000)}`;
        const reference = isFreeRegistration ? `FREE-${Date.now()}` : `PAY-${Date.now()}`;
        
        const expiry = new Date();
        expiry.setMonth(expiry.getMonth() + 12);

        const newRider = {
            riderId, name, phone, altPhone, address, dob, nationality: nationality || 'Nigerian', plateNumber: plateNumber || '',
            pin: hashedPin,
            userType: userType || 'driver',
            registrationDate: new Date().toISOString().split('T')[0],
            expiryDate: isFreeRegistration ? expiry.toISOString().split('T')[0] : null,
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
            emergencyContacts: emergencyContacts,
            emergencyContact: emergencyContacts[0] || {
                name: emergencyContactName || '',
                phone: emergencyContactPhone || ''
            },
            safety: {
                sosEnabled: false,
                theftStatus: 'Safe'
            },
            status: isFreeRegistration ? 'Active' : 'Pending',
            isFree: isFreeRegistration,
            reference 
        };
        dbHelpers.insertRider(newRider);

        if (isFreeRegistration && freeToken) {
            dbHelpers.useFreeLink(freeToken, riderId, clientIp);
        }

        const token = jwt.sign({ riderId }, JWT_SECRET, { expiresIn: '24h' });

        res.json({
            success: true, riderId, reference, token, isFree: isFreeRegistration,
            paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Registration failed' });
    }
});

// Request Card or Sticker
app.post('/api/rider/request', authenticateToken, (req, res) => {
    try {
        const { type } = req.body;
        if (!type || (type !== 'card' && type !== 'sticker')) {
            return res.status(400).json({ success: false, message: 'Invalid request type' });
        }
        dbHelpers.insertRequest(req.user.riderId, type);
        res.json({ success: true, message: `${type} request submitted successfully.` });
    } catch (error) {
        console.error("Request error:", error);
        res.status(500).json({ success: false, message: 'Failed to submit request' });
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
    { name: 'medicalDirectiveDoc', maxCount: 1 },
    { name: 'healthInsuranceDoc', maxCount: 1 }
]), async (req, res) => {
    try {
        const { 
            reference, 
            // Rider's own medical
            riderBloodGroup, riderGenotype, riderAllergies, riderHospital, conditions, medications, immunizations, height, weight, gender, dateOfBirth, nationality, identifyingMarks, primaryDoctorName, primaryDoctorPhone, surgeries, recentVitals, communicationNeeds, healthInsuranceProvider, healthInsurancePolicy, organDonor, donorRestrictions,
            // Emergency contact
            emergencyName, emergencyPhone, emergencyRel, emergencyAltPhone,
            bloodGroup, genotype,
            // Bike
            bikeBrand, bikeModel, bikeColor, ownershipType,
            // Doc numbers
            licenseNumber, insuranceNumber, ninNumber,
            // Onboarding essentials
            address, altPhone, plateNumber
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
            hospitalPreference: riderHospital || '',
            conditions, medications, immunizations, height, weight, gender, dateOfBirth, identifyingMarks, primaryDoctorName, primaryDoctorPhone, surgeries, recentVitals, communicationNeeds, healthInsuranceProvider, healthInsurancePolicy, organDonor: organDonor === 'true' || organDonor === true, donorRestrictions
        };

        // Update core info from onboarding if provided
        if (address) rider.address = address;
        if (altPhone) rider.altPhone = altPhone;
        if (dateOfBirth) rider.dob = dateOfBirth;
        if (nationality) rider.nationality = nationality;
        if (plateNumber) rider.plateNumber = plateNumber;

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
        const fieldNames = ['passportPhoto', 'licenseDoc', 'bikePapers', 'proofOfOwnership', 'insuranceDoc', 'ninDoc', 'medicalDirectiveDoc', 'healthInsuranceDoc'];
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



        dbHelpers.updateRider(riderId, rider);
        saveToGoogleSheets(rider); 

        res.json({ success: true, message: 'Profile completed successfully' });
    } catch (error) {
        console.error('Update Error:', error);
        res.status(500).json({ success: false, message: 'Update failed' });
    }
});

// 4. Verify Payment (Rate Limited)
app.post('/api/payment/verify', paymentVerifyLimiter, async (req, res) => {
    const { reference, riderId } = req.body || {};
    if (!reference && !riderId) {
        return res.status(400).json({ success: false, message: 'Reference or Rider ID is required' });
    }
    try {
        const rider = dbHelpers.getRiderById(riderId) || dbHelpers.findByReference(reference);
        if (!rider) return res.status(404).json({ success: false, message: 'Rider not found' });

        const isPaid = await verifyPaystackPayment(reference);
        if (isPaid) {
            rider.status = 'Active';
            delete rider.paymentRequested;
            const expiry = new Date();
            expiry.setMonth(expiry.getMonth() + 12);
            rider.expiryDate = expiry.toISOString().split('T')[0];
            dbHelpers.updateRider(rider.riderId, rider);
            saveToGoogleSheets(rider);
            res.json({ success: true, message: 'Payment verified' });
        } else {
            res.status(400).json({ success: false, message: 'Payment verification failed' });
        }
    } catch (error) {
        console.error('Payment verify error:', error.message);
        res.status(500).json({ success: false, message: IS_PRODUCTION ? 'Verification failed' : error.message });
    }
});

// ── Webhook Signature Verification (Paystack) ──────────────────────────────
app.post('/api/payment/webhook', async (req, res) => {
    try {
        const signature = req.headers['x-paystack-signature'];
        const secret = process.env.PAYSTACK_SECRET_KEY;
        if (!signature || !secret) {
            console.warn('[SECURITY] Webhook signature or secret unconfigured/missing');
            return res.status(401).send('Webhook authentication unconfigured');
        }

        const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
        const hash = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
        
        const sigBuf = Buffer.from(signature, 'utf8');
        const hashBuf = Buffer.from(hash, 'utf8');
        if (sigBuf.length !== hashBuf.length || !crypto.timingSafeEqual(sigBuf, hashBuf)) {
            console.warn('[SECURITY] Paystack webhook signature mismatch detected');
            return res.status(400).send('Invalid webhook signature');
        }

        const event = req.body;
        if (event && event.event === 'charge.success') {
            const data = event.data || {};
            const reference = data.reference;
            const riderId = data.metadata?.riderId;

            const rider = (riderId ? dbHelpers.getRiderById(riderId) : null) || dbHelpers.findByReference(reference);
            if (rider) {
                rider.status = 'Active';
                delete rider.paymentRequested;
                const expiry = new Date();
                expiry.setMonth(expiry.getMonth() + 12);
                rider.expiryDate = expiry.toISOString().split('T')[0];
                dbHelpers.updateRider(rider.riderId, rider);
                saveToGoogleSheets(rider);
                console.log(`[PAYMENT-WEBHOOK] Automated payment confirmed for ${rider.riderId} (Ref: ${reference})`);
            }
        }

        res.sendStatus(200);
    } catch (err) {
        console.error('[PAYMENT-WEBHOOK] Handler error:', err.message);
        res.status(500).send('Webhook error');
    }
});

// Security & Emergency Endpoints
app.post('/api/riders/:id/emergency-link', authenticateToken, (req, res) => {
    try {
        if (req.user.riderId !== req.params.id && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }
        const linkId = dbHelpers.createEmergencyLink(req.params.id);
        const url = `${req.protocol}://${req.get('host')}/api/emergency/onetime/${linkId}`;
        res.json({ success: true, link: url });
    } catch (e) {
        console.error('Create link error:', e.message);
        res.status(500).json({ success: false, message: 'Failed to create link' });
    }
});

app.get('/api/emergency/onetime/:linkId', (req, res) => {
    const link = dbHelpers.consumeEmergencyLink(req.params.linkId);
    if (link) {
        dbHelpers.logAccess(link.riderId, req.ip, req.headers['user-agent'] || '', 'One-Time Emergency Link');
        
        const sessionId = generateSessionId();
        const numericId = sessionId.split('-')[2];
        const session = {
            riderId: link.riderId,
            createdAt: new Date().toISOString(),
            status: 'active'
        };
        emergencySessions.set(sessionId, session);
        emergencySessions.set(numericId, session);
        
        res.redirect(`/emergency/${numericId}`);
    } else {
        res.status(404).send('Invalid or expired emergency link.');
    }
});

app.get('/api/riders/:id/access-logs', authenticateToken, (req, res) => {
    try {
        if (req.user.riderId !== req.params.id && req.user.role !== 'admin' && req.user.role !== 'agent') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }
        const logs = dbHelpers.getAccessLogs(req.params.id);
        res.json({ success: true, logs });
    } catch (e) {
        console.error('Fetch logs error:', e.message);
        res.status(500).json({ success: false, message: 'Failed to fetch logs' });
    }
});

// 5. Change PIN Route
app.post('/api/rider/change-pin', authenticateToken, async (req, res) => {
    try {
        const { currentPin, newPin } = req.body || {};
        const riderId = req.user.riderId;
        const rider = dbHelpers.getRiderById(riderId);

        if (!rider) return res.status(404).json({ success: false, message: 'Rider not found' });
        
        const isMatch = await bcrypt.compare(String(currentPin || ''), rider.pin);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: 'Current PIN is incorrect' });
        }

        if (!/^\d{4}$/.test(String(newPin || ''))) {
            return res.status(400).json({ success: false, message: 'New PIN must be exactly 4 numeric digits' });
        }

        const salt = await bcrypt.genSalt(10);
        rider.pin = await bcrypt.hash(String(newPin), salt);
        dbHelpers.updateRider(riderId, rider);

        res.json({ success: true, message: 'PIN updated successfully' });
    } catch (err) {
        console.error('Change PIN error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to update PIN' });
    }
});

// Admin Request Payment Endpoint (Protected by authenticateAdminToken)
app.post('/api/admin/request-payment/:riderId', authenticateAdminToken, async (req, res) => {
    try {
        const riderId = req.params.riderId;
        const rider = dbHelpers.getRiderById(riderId);
        
        if (!rider) {
            return res.status(404).json({ success: false, message: 'Rider not found' });
        }
        
        if (rider.status !== 'Pending') {
            return res.status(400).json({ success: false, message: 'User is not Pending' });
        }
        
        rider.paymentRequested = true;
        dbHelpers.updateRider(riderId, rider);
        
        res.json({ success: true, message: 'Payment request pushed to user profile successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: IS_PRODUCTION ? 'Failed to process payment request' : error.message });
    }
});

function ensureRider71447() {
    try {
        const bcrypt = require('bcryptjs');
        const existing = dbHelpers.getRiderById('RID-71447') || dbHelpers.getRiderByPhone('08079506543');
        if (!existing) {
            console.log('[STARTUP] Seeding and Restoring RID-71447 (TIMILEYIN OLADIPUPO)...');
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
            dbHelpers.insertRider(rider71447);
            console.log('[STARTUP] RID-71447 successfully restored!');
        } else if (existing.status !== 'Active') {
            existing.status = 'Active';
            if (!existing.expiryDate) existing.expiryDate = '2028-12-31';
            dbHelpers.updateRider(existing.riderId, existing);
            console.log('[STARTUP] RID-71447 status ensured Active!');
        }
    } catch (err) {
        console.error('[STARTUP] Failed to check/restore RID-71447:', err.message);
    }
}

ensureRider71447();

// ── API 404 HANDLER ─────────────────────────────────────────────────────────────
app.use('/api', (req, res) => {
    res.status(404).json({ success: false, message: 'API endpoint not found' });
});

// ── CENTRAL ERROR HANDLER ───────────────────────────────────────────────────────
// Sanitizes 500 errors in production to avoid exposing stack traces or internals
app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (!IS_PRODUCTION) {
        console.error('[UNCAUGHT ERROR]', err);
    } else {
        console.error('[SERVER ERROR]', err.message || 'Internal server error');
    }

    if (res.headersSent) {
        return next(err);
    }

    res.status(status).json({
        success: false,
        message: (IS_PRODUCTION && status === 500) 
            ? 'An unexpected server error occurred.' 
            : (err.message || 'Internal server error')
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://127.0.0.1:${PORT}`);
});


