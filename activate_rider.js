const db = require('./server/db');
const bcrypt = require('bcryptjs');

async function restoreRiders() {
    const rider71447 = {
        riderId: "RID-71447",
        phone: "08079506543",
        pin: bcrypt.hashSync("1234", 10),
        name: "TIMILEYIN OLADIPUPO",
        fullName: "TIMILEYIN OLADIPUPO",
        plateNumber: "JKG-213-AJ",
        status: "Active",
        userType: "driver",
        vehicleType: "motorcycle",
        bike: {
            plateNumber: "JKG-213-AJ",
            brand: "TVS",
            model: "Motorcycle",
            color: "Red/Black",
            ownershipType: "Owned"
        },
        vehicle: {
            type: "motorcycle",
            plateNumber: "JKG-213-AJ",
            brand: "TVS",
            model: "Motorcycle",
            color: "Red/Black",
            ownershipType: "Owned"
        },
        medical: {
            bloodGroup: "O+",
            genotype: "AA",
            allergies: "None"
        },
        emergencyContact: {
            name: "Joy Oladipupo",
            phone: "08032352737",
            relationship: "Family"
        },
        emergencyContacts: [
            {
                name: "Joy Oladipupo",
                phone: "08032352737",
                relationship: "Family"
            },
            {
                name: "Dorcas Oladipupo",
                phone: "09058233466",
                relationship: "Family"
            }
        ],
        safety: {
            sosEnabled: true,
            theftStatus: "Safe"
        },
        documents: {},
        expiryDate: "2028-12-31",
        createdAt: new Date().toISOString()
    };

    try {
        const existing = db.getRiderById('RID-71447') || db.getRiderByPhone('08079506543');
        if (existing) {
            db.updateRider(existing.riderId, { ...existing, ...rider71447, status: 'Active' });
            console.log("Successfully updated and activated user:", rider71447.riderId);
        } else {
            db.insertRider(rider71447);
            console.log("Successfully restored user:", rider71447.riderId);
        }
    } catch (e) {
        console.error("Error restoring user:", e.message);
    }
}

restoreRiders();
