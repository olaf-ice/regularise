
        function verifyRider() {
            const query = document.getElementById('officerSearch').value.trim();
            if (query) {
                window.location.href = `profile.html?q=${encodeURIComponent(query)}`;
            } else {
                alert('Please enter a plate number, phone, or User ID.');
            }
        }


        async function riderLogin() {
            const phone = document.getElementById('riderPhone').value.trim();
            const pin = document.getElementById('riderPin').value.trim();
            const btn = document.getElementById('riderLoginBtn');
            
            if (phone && pin) {
                btn.disabled = true;
                btn.textContent = 'Opening Vault...';
                try {
                    const res = await fetch('/api/rider/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ loginId: phone, pin })
                    });
                    const data = await res.json();
                    if (data.success) {
                        localStorage.setItem('riderToken', data.token);
                        window.location.href = `profile.html?id=${encodeURIComponent(data.riderId)}`;
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
                    }
                } catch (error) {
                    console.error(error);
                    alert('Connection error. Please try again.');
                    btn.disabled = false;
                    btn.textContent = 'Access My Profile';
                }
            } else {
                alert('Please enter your registered phone number and PIN.');
            }
        }

        // Allow Enter key on both inputs
        document.getElementById('officerSearch').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') verifyRider();
        });
        document.getElementById('riderPhone').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') riderLogin();
        });
        document.getElementById('riderPin').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') riderLogin();
        });

        // Forgot PIN Logic
        function openForgotPinModal() {
            document.getElementById('forgotPinModal').style.display = 'flex';
            document.getElementById('fpStep1').style.display = 'block';
            document.getElementById('fpStep2').style.display = 'none';
            document.getElementById('fpStep3').style.display = 'none';
            document.getElementById('fpPhone').value = document.getElementById('riderPhone').value;
        }

        function closeForgotPinModal() {
            document.getElementById('forgotPinModal').style.display = 'none';
        }

        async function requestOTP() {
            const phone = document.getElementById('fpPhone').value.trim();
            if(!phone) return alert('Enter phone number');
            const btn = document.getElementById('fpBtn1');
            btn.disabled = true; btn.textContent = 'Sending...';

            try {
                const res = await fetch('/api/rider/forgot-pin', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ loginId: phone })
                });
                const data = await res.json();
                if(data.success) {
                    document.getElementById('fpStep1').style.display = 'none';
                    document.getElementById('fpStep2').style.display = 'block';
                } else {
                    alert(data.message);
                }
            } catch(e) {
                alert('Network error');
            }
            btn.disabled = false; btn.textContent = 'Send OTP';
        }

        async function verifyOTP() {
            const phone = document.getElementById('fpPhone').value.trim();
            const otp = document.getElementById('fpOtp').value.trim();
            if(!otp) return alert('Enter OTP');
            const btn = document.getElementById('fpBtn2');
            btn.disabled = true; btn.textContent = 'Verifying...';

            try {
                const res = await fetch('/api/rider/verify-otp', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ loginId: phone, otp })
                });
                const data = await res.json();
                if(data.success) {
                    document.getElementById('fpStep2').style.display = 'none';
                    document.getElementById('fpStep3').style.display = 'block';
                } else {
                    alert(data.message);
                }
            } catch(e) {
                alert('Network error');
            }
            btn.disabled = false; btn.textContent = 'Verify OTP';
        }

        async function resetPin() {
            const phone = document.getElementById('fpPhone').value.trim();
            const otp = document.getElementById('fpOtp').value.trim();
            const newPin = document.getElementById('fpNewPin').value.trim();
            if(newPin.length !== 4) return alert('PIN must be 4 digits');
            
            const btn = document.getElementById('fpBtn3');
            btn.disabled = true; btn.textContent = 'Resetting...';

            try {
                const res = await fetch('/api/rider/reset-pin', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ loginId: phone, otp, newPin })
                });
                const data = await res.json();
                if(data.success) {
                    alert('PIN reset successful! You can now login.');
                    closeForgotPinModal();
                    document.getElementById('riderPin').value = '';
                } else {
                    alert(data.message);
                }
            } catch(e) {
                alert('Network error');
            }
            btn.disabled = false; btn.textContent = 'Reset PIN';
        }
    