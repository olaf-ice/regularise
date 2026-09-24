const fs = require('fs');
let html = fs.readFileSync('public/profile.html', 'utf8');

// 1. Add Paystack script in <head>
if (!html.includes('js.paystack.co')) {
    html = html.replace('</head>', '    <script src="https://js.paystack.co/v1/inline.js"></script>\n</head>');
}

// 2. Add Paywall Overlay HTML
const paywallHtml = `
    <!-- Paywall Overlay -->
    <div id="paywallOverlay" style="display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.95); z-index: 9999; flex-direction: column; align-items: center; justify-content: center; backdrop-filter: blur(8px);">
        <div style="background: var(--surface); padding: 2.5rem; border-radius: 1.5rem; text-align: center; max-width: 400px; width: 90%; border: 1px solid var(--glass-border); box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
            <div style="font-size: 3rem; margin-bottom: 1rem;">🔒</div>
            <h2 style="color: var(--text); font-size: 1.5rem; margin-bottom: 0.5rem; font-weight: 800;">Activation Required</h2>
            <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 2rem;">Your account status is currently <b>PENDING</b>. Please complete your registration payment to unlock your MyVault profile and features.</p>
            <button id="paywallBtn" class="btn btn-primary" style="width: 100%; font-size: 1.1rem; padding: 1rem; font-weight: 700;">Pay ₦3,500 Now</button>
            <div style="margin-top: 1rem; font-size: 0.75rem; color: var(--text-light);">Secure payment via Paystack</div>
        </div>
    </div>
</body>`;

html = html.replace('</body>', paywallHtml);

// 3. Add Paywall JS logic to fetchProfile
// Inside fetchProfile, after:
// const rider = data.rider;

const paywallLogic = `
                    if (rider.status && rider.status.toLowerCase() === 'pending') {
                        document.getElementById('paywallOverlay').style.display = 'flex';
                        document.getElementById('paywallBtn').onclick = function() {
                            const handler = PaystackPop.setup({
                                key: data.paystackPublicKey,
                                email: (rider.phone || 'user') + '@riderid.com',
                                amount: 3500 * 100, // 3500 NGN in kobo
                                currency: 'NGN',
                                reference: 'MV_' + Math.floor((Math.random() * 1000000000) + 1),
                                callback: function(response) {
                                    alert('Payment complete! Redirecting to verify...');
                                    window.location.href = '?q=' + (rider.riderId || query) + '&status=success&ref=' + response.reference;
                                },
                                onClose: function() {
                                    alert('Transaction cancelled. You must pay to access your profile.');
                                }
                            });
                            handler.openIframe();
                        };
                        return; // Stop rendering the rest of the profile until paid
                    }
                    
                    window.globalRiderData = rider;`;

html = html.replace('window.globalRiderData = rider; // Store globally for edit modal', paywallLogic);

fs.writeFileSync('public/profile.html', html, 'utf8');
console.log('Paywall injected into profile.html successfully!');
