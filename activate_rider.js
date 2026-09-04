const db = require('./server/db');

async function createRider() {
    const newRider = {
        riderId: "RID-42242",
        phone: "08065658212",
        pin: "1234",
        name: "DUROJAYE IZZY LAWRENCE",
        fullName: "DUROJAYE IZZY LAWRENCE",
        status: "active",
        createdAt: new Date().toISOString()
    };
    
    try {
        db.insertRider(newRider);
        console.log("Successfully created user:", newRider.riderId);
    } catch (e) {
        console.error("Error creating user:", e.message);
    }
}

createRider();
