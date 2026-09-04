const db = require('./server/db');
const bcrypt = require('bcryptjs');

async function fixRiderPin() {
    const phone = '08065658212';
    const plainPin = '1234';

    // Look up rider
    let rider = db.getRiderByPhone(phone);
    if (!rider) {
        console.error('Rider not found for phone:', phone);
        return;
    }

    console.log('Found rider:', rider.riderId, rider.name || rider.fullName);
    console.log('Current pin value:', rider.pin);

    // Hash the PIN properly
    const salt = await bcrypt.genSalt(10);
    const hashedPin = await bcrypt.hash(plainPin, salt);
    console.log('Generated hash:', hashedPin);

    // Update rider record
    rider.pin = hashedPin;
    rider.status = 'active';

    db.updateRider(rider.riderId, rider);
    console.log('PIN updated successfully for', rider.riderId);

    // Verify it works
    const check = await bcrypt.compare(plainPin, hashedPin);
    console.log('Verification check (should be true):', check);
}

fixRiderPin().catch(console.error);
