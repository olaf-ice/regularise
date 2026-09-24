const fs = require('fs');
let html = fs.readFileSync('public/login.html', 'utf8');

// Inject Paystack Script
if (!html.includes('js.paystack.co')) {
    html = html.replace('</head>', '    <script src="https://js.paystack.co/v1/inline.js"></script>\n</head>');
}

// Modify riderLogin function
const oldLogic = `                    if (data.success) {
                        localStorage.setItem('riderToken', data.token);
                        window.location.href = \`profile.html?id=\${encodeURIComponent(data.riderId)}\`;
                    } else {
                        alert('Error: ' + data.message);
                        btn.disabled = false;
                        btn.textContent = 'Access My Profile';
                    }`;

const newLogic = `                    if (data.success) {
                        localStorage.setItem('riderToken', data.token);
                        window.location.href = \`profile.html?id=\${encodeURIComponent(data.riderId)}\`;
                    } else if (data.isPending) {
                        const handler = PaystackPop.setup({
                            key: data.paystackPublicKey,
                            email: (data.phone || 'user') + '@riderid.com',
                            amount: 3500 * 100, // 3500 NGN in kobo
                            currency: 'NGN',
                            reference: 'MV_' + Math.floor((Math.random() * 1000000000) + 1),
                            callback: async function(response) {
                                btn.textContent = 'Verifying Payment...';
                                try {
                                    const vRes = await fetch('/api/payment/verify', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ reference: response.reference, riderId: data.riderId })
                                    });
                                    const vData = await vRes.json();
                                    if (vData.success) {
                                        alert('Payment complete! Logging you in...');
                                        // Re-trigger login now that status is Active
                                        btn.disabled = false;
                                        riderLogin();
                                    } else {
                                        alert('Verification failed. Contact support.');
                                        btn.disabled = false;
                                        btn.textContent = 'Access My Profile';
                                    }
                                } catch(e) {
                                    alert('Error verifying payment.');
                                    btn.disabled = false;
                                    btn.textContent = 'Access My Profile';
                                }
                            },
                            onClose: function() {
                                alert('Transaction cancelled. You must pay to access your profile.');
                                btn.disabled = false;
                                btn.textContent = 'Access My Profile';
                            }
                        });
                        handler.openIframe();
                    } else {
                        alert('Error: ' + data.message);
                        btn.disabled = false;
                        btn.textContent = 'Access My Profile';
                    }`;

html = html.replace(oldLogic, newLogic);

fs.writeFileSync('public/login.html', html, 'utf8');
console.log('Login modified successfully');
