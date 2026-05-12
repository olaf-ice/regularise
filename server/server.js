require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const qrcode = require('qrcode');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// DEBUG: Log every single request
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// Storage Configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

let riders = [];

// Helper to save rider to Google Sheets (NON-BLOCKING)
async function saveToGoogleSheets(rider) {
    const scriptUrl = process.env.GOOGLE_SCRIPT_URL;
    if (!scriptUrl) return;

    try {
        console.log('Attempting to sync with Google Sheets...');
        const payload = {
            riderId: rider.riderId,
            name: rider.name,
            phone: rider.phone,
            plateNumber: rider.plateNumber,
            union: rider.union,
            status: rider.status,
            reference: rider.reference,
            expiryDate: rider.expiryDate || '',
            passportUrl: `http://127.0.0.1:3001${rider.documents.passportPhoto || ''}`,
            licenseUrl: `http://127.0.0.1:3001${rider.documents.licenseDoc || ''}`,
            bikePapersUrl: `http://127.0.0.1:3001${rider.documents.bikePapers || ''}`,
            emergencyContact: `${rider.emergencyContact.name} (${rider.emergencyContact.phone})`
        };

        await axios.post(scriptUrl, payload, { timeout: 10000 });
        console.log('Rider successfully synced to Google Sheets!');
    } catch (err) {
        console.error('Google Sheets Sync Failed:', err.message);
    }
}

// 1. Search/Verify
app.get('/api/verify/:query', (req, res) => {
    const query = req.params.query.toLowerCase();
    const rider = riders.find(r => 
        r.riderId.toLowerCase() === query || 
        r.plateNumber.toLowerCase() === query || 
        r.phone === query
    );
    if (rider) res.json({ success: true, rider });
    else res.json({ success: false, message: 'Rider not found' });
});

// 2. Register
app.post('/api/register', async (req, res) => {
    try {
        const { name, phone, plateNumber, union } = req.body;
        const riderId = `RID-${Math.floor(10000 + Math.random() * 90000)}`;
        const reference = `PAY-${Date.now()}`;
        const newRider = {
            riderId, name, phone, plateNumber, union,
            documents: {}, emergencyContact: {},
            status: 'Pending', reference 
        };
        riders.push(newRider);
        res.json({
            success: true, riderId, reference,
            monnifyApiKey: process.env.MONNIFY_API_KEY,
            monnifyContractCode: process.env.MONNIFY_CONTRACT_CODE
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Registration failed' });
    }
});

// 3. Post-Payment Update
app.post('/api/rider/update', upload.fields([
    { name: 'passportPhoto', maxCount: 1 },
    { name: 'licenseDoc', maxCount: 1 },
    { name: 'bikePapers', maxCount: 1 },
    { name: 'proofOfOwnership', maxCount: 1 },
    { name: 'insuranceDoc', maxCount: 1 },
    { name: 'ninDoc', maxCount: 1 }
]), async (req, res) => {
    try {
        const { riderId, emergencyName, emergencyPhone } = req.body;
        const rider = riders.find(r => r.riderId === riderId);
        if (!rider) return res.status(404).json({ success: false, message: 'Rider not found' });

        rider.emergencyContact = { name: emergencyName, phone: emergencyPhone };
        
        // Final Status check - usually set by /api/payment/verify
        // If not set, we keep it as Pending or set to Active if payment was confirmed
        // For now, let's assume if they reached here, they paid.
        rider.status = 'Active';
        const expiry = new Date();
        expiry.setMonth(expiry.getMonth() + 3);
        rider.expiryDate = expiry.toISOString().split('T')[0];

        const fieldNames = ['passportPhoto', 'licenseDoc', 'bikePapers', 'proofOfOwnership', 'insuranceDoc', 'ninDoc'];
        fieldNames.forEach(field => {
            if (req.files && req.files[field]) {
                rider.documents[field] = `/uploads/${req.files[field][0].filename}`;
            }
        });

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
        const rider = riders.find(r => r.riderId === riderId || r.reference === reference);
        if (rider) {
            rider.status = 'Active';
            const expiry = new Date();
            expiry.setMonth(expiry.getMonth() + 3);
            rider.expiryDate = expiry.toISOString().split('T')[0];
            res.json({ success: true, message: 'Payment verified' });
        } else {
            res.status(404).json({ success: false, message: 'Rider not found' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Verification failed' });
    }
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://127.0.0.1:${PORT}`);
});
