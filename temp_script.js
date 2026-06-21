
    <script>
        let sessionData = null;
        const currentUrl = window.location.href;
        let isUnlocked = false;

        // --- SIREN & VIBRATION LOGIC ---
        let audioCtx, sirenOscillator, sirenGain, sirenInterval;
        let isSirenActive = false;

        function toggleSiren() {
            if (!isSirenActive) {
                startSiren();
                const btn = document.getElementById('sirenBtn');
                btn.innerHTML = '🔇 STOP EMERGENCY ALARM';
                btn.classList.add('active');
                isSirenActive = true;
            } else {
                stopSiren();
                const btn = document.getElementById('sirenBtn');
                btn.innerHTML = '🔊 TAP TO ACTIVATE EMERGENCY ALARM';
                btn.classList.remove('active');
                isSirenActive = false;
            }
        }

        function startSiren() {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();

            sirenOscillator = audioCtx.createOscillator();
            sirenGain = audioCtx.createGain();

            sirenOscillator.type = 'square';
            sirenOscillator.connect(sirenGain);
            sirenGain.connect(audioCtx.destination);

            sirenGain.gain.value = 0.5; // Very loud
            sirenOscillator.start();

            let high = true;
            sirenInterval = setInterval(() => {
                // High-low alternating siren
                sirenOscillator.frequency.value = high ? 800 : 600;
                high = !high;
                
                if ("vibrate" in navigator) {
                    navigator.vibrate([300, 100, 300, 100]); // intense vibration pattern
                }
            }, 400);
        }

        function stopSiren() {
            if (sirenInterval) clearInterval(sirenInterval);
            if (sirenOscillator) {
                sirenOscillator.stop();
                sirenOscillator.disconnect();
            }
            if (sirenGain) sirenGain.disconnect();
            if ("vibrate" in navigator) {
                navigator.vibrate(0);
            }
        }
        // -------------------------------

        function showToast(msg, ms = 2500) {
            const t = document.getElementById('toast');
            t.textContent = msg;
            t.classList.add('show');
            setTimeout(() => t.classList.remove('show'), ms);
        }

        function fmt(isoStr) {
            if (!isoStr) return '---';
            const d = new Date(isoStr);
            return d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: true }) +
                   ' · ' + d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
        }

        function cap(s) {
            if (!s) return '---';
            return s.charAt(0).toUpperCase() + s.slice(1);
        }

        // --- UNLOCK LOGIC ---
        const holdBtn = document.getElementById('holdUnlockBtn');
        let holdTimeout;
        
        function startHold(e) {
            if(e.type === 'touchstart') e.preventDefault();
            if(isUnlocked) return;
            holdBtn.classList.add('holding');
            holdTimeout = setTimeout(() => {
                unlockLevel2();
            }, 3000); // 3 seconds hold
        }
        
        function stopHold() {
            if(isUnlocked) return;
            holdBtn.classList.remove('holding');
            clearTimeout(holdTimeout);
        }
        
        holdBtn.addEventListener('mousedown', startHold);
        holdBtn.addEventListener('touchstart', startHold);
        holdBtn.addEventListener('mouseup', stopHold);
        holdBtn.addEventListener('mouseleave', stopHold);
        holdBtn.addEventListener('touchend', stopHold);

        async function unlockLevel2() {
            isUnlocked = true;
            holdBtn.classList.remove('holding');
            holdBtn.innerHTML = '<span class="spinner" style="width:24px;height:24px;border-width:3px;border-top-color:#fff;"></span>';
            
            const pathMatch = window.location.pathname.match(/\/emergency\/([^/?\s]+)/);
            if (!pathMatch) return;
            
            try {
                const res = await fetch('/api/emergency/' + pathMatch[1] + '/unlock', { method: 'POST' });
                const data = await res.json();
                
                if (data.success) {
                    sessionData = data.session;
                    populateLevel2Data(sessionData.rider, sessionData);
                    
                    document.getElementById('unlockContainer').style.display = 'none';
                    document.querySelectorAll('.level-2-data').forEach(el => {
                        el.classList.add('unlocked');
                    });
                    
                    showToast('🔓 Full medical profile unlocked');
                    if ("vibrate" in navigator) navigator.vibrate(200);
                } else {
                    showToast('⚠️ Failed to unlock session');
                    holdBtn.innerHTML = '<span class="hold-btn-icon">🔒</span><span class="hold-btn-text">HOLD TO<br>UNLOCK</span>';
                    isUnlocked = false;
                }
            } catch(e) {
                showToast('Connection error');
                holdBtn.innerHTML = '<span class="hold-btn-icon">🔒</span><span class="hold-btn-text">HOLD TO<br>UNLOCK</span>';
                isUnlocked = false;
            }
        }
        // --------------------

        function buildKinCard(ec) {
            if (!ec || !ec.phone) return;
            document.getElementById('kinCard').style.display = 'block';
            const list = document.getElementById('kinList');
            list.innerHTML = '';
            const contacts = [
                { name: ec.name, phone: ec.phone, rel: ec.relationship || 'Next of Kin' },
                ec.secondaryPhone ? { name: ec.name || 'Contact', phone: ec.secondaryPhone, rel: 'Secondary Contact' } : null
            ].filter(Boolean);

            contacts.forEach(c => {
                const row = document.createElement('div');
                row.className = 'kin-row';
                row.innerHTML = `
                    <div>
                        <div class="kin-name">${c.name || 'Next of Kin'}</div>
                        <div class="kin-rel">${c.rel}</div>
                    </div>
                    <a href="tel:${c.phone}" class="call-btn">📞 CALL</a>
                `;
                list.appendChild(row);
            });
        }

        async function sendKinAlert() {
            const btn = document.getElementById('kinAlertBtn');
            if (!sessionData) return;
            btn.disabled = true;
            btn.innerHTML = '⏳ Sending Alert...';
            try {
                const res = await fetch('/api/sos/' + sessionData.riderId, { method: 'POST' });
                const d = await res.json();
                if (d.success) {
                    btn.innerHTML = '✅ NEXT OF KIN ALERTED';
                    btn.style.background = 'linear-gradient(135deg,#10b981,#059669)';
                    btn.style.animation = 'none';
                    btn.style.boxShadow = '0 8px 30px rgba(16,185,129,0.4)';
                    showToast('✅ Emergency alert sent to next of kin');
                } else {
                    btn.disabled = false;
                    btn.innerHTML = '🚨 ALERT NEXT OF KIN NOW';
                    showToast('⚠️ ' + d.message);
                }
            } catch(e) {
                btn.disabled = false;
                btn.innerHTML = '🚨 ALERT NEXT OF KIN NOW';
                showToast('Connection error. Please try again.');
            }
        }

        function copyLink() {
            const url = currentUrl;
            if (navigator.clipboard) {
                navigator.clipboard.writeText(url).then(() => showToast('✅ Emergency link copied!'));
            } else {
                const el = document.createElement('textarea');
                el.value = url; document.body.appendChild(el);
                el.select(); document.execCommand('copy');
                document.body.removeChild(el);
                showToast('✅ Emergency link copied!');
            }
        }

        async function loadSession() {
            // Extract session ID from URL path: /emergency/XXXXX
            const pathMatch = window.location.pathname.match(/\/emergency\/([^/?\s]+)/);
            if (!pathMatch) {
                document.getElementById('loadingState').style.display = 'none';
                document.getElementById('errorState').style.display = 'block';
                return;
            }
            const sessionId = pathMatch[1];

            try {
                const res = await fetch('/api/emergency/' + sessionId);
                const data = await res.json();
                document.getElementById('loadingState').style.display = 'none';

                if (!data.success) {
                    document.getElementById('errorState').style.display = 'block';
                    return;
                }

                sessionData = data.session;
                const s = sessionData;
                const rider = s.rider;

                document.getElementById('mainContent').style.display = 'block';

                // Check if older than 6h
                if (Date.now() - new Date(s.createdAt).getTime() > 6 * 60 * 60 * 1000) {
                    document.getElementById('expiredBanner').style.display = 'block';
                }

                // Banner
                document.getElementById('sessionIdDisplay').textContent = s.sessionId;
                document.getElementById('sessionLinkText').textContent = currentUrl;

                // Identity (Level 1)
                const isNonDriver = rider.userType === 'non-driver';
                const plate = (rider.plateNumber || '---').toUpperCase();
                document.getElementById('riderName').textContent = rider.name || '---';
                if (isNonDriver) {
                    document.getElementById('riderPlate').style.display = 'none';
                } else {
                    document.getElementById('riderPlate').textContent = plate;
                }
                document.getElementById('riderIdBadge').textContent = 'ID: ' + (rider.riderId || '---');

                if (rider.documents && rider.documents.passportPhoto) {
                    const src = rider.documents.passportPhoto.url || rider.documents.passportPhoto;
                    document.getElementById('riderPhoto').src = src;
                }

                // Medical (Level 1)
                if (rider.medical) {
                    document.getElementById('bloodGroup').textContent = rider.medical.bloodGroup || '---';
                    if (rider.medical.refusesBloodTransfusion) {
                        document.getElementById('noBloodBanner').style.display = 'block';
                    }
                }

                // Kin (Level 1)
                buildKinCard(rider.emergencyContact);

                // Session timing
                const created = new Date(s.createdAt);
                const expires = new Date(created.getTime() + 6 * 60 * 60 * 1000);
                document.getElementById('sessionIdSmall').textContent = s.sessionId;
                document.getElementById('triggeredAt').textContent = fmt(s.createdAt);
                document.getElementById('expiresAt').textContent = fmt(expires.toISOString());

                // WhatsApp share
                const shareText = encodeURIComponent(
                    '🚨 *EMERGENCY ALERT — MyVault SOS*\n\n' +
                    'A rider may need immediate assistance!\n\n' +
                    '👤 *Name:* ' + (rider.name || '---') + '\n' +
                    '🕐 *Time:* ' + fmt(s.createdAt) + '\n\n' +
                    'View full emergency profile:\n' + currentUrl
                );
                document.getElementById('waShareBtn').href = 'https://api.whatsapp.com/send?text=' + shareText;

            } catch(err) {
                console.error(err);
                document.getElementById('loadingState').style.display = 'none';
                document.getElementById('errorState').style.display = 'block';
            }
        }

        function populateLevel2Data(rider, s) {
            const isNonDriver = rider.userType === 'non-driver';
            // Identity Details
            const vehicleInfo = rider.vehicle || rider.bike || {};
            
            if (isNonDriver) {
                document.getElementById('licenseNumber').parentElement.style.display = 'none';
                document.getElementById('vehicleColor').parentElement.style.display = 'none';
                document.getElementById('vehicleType').parentElement.style.display = 'none';
            } else {
                document.getElementById('licenseNumber').textContent = rider.documents?.licenseDoc?.number || '---';
                document.getElementById('vehicleColor').textContent = vehicleInfo.color || '---';
                document.getElementById('vehicleType').textContent = cap(rider.vehicleType || 'motorcycle');
            }
            
            const phone = rider.phone || '---';
            document.getElementById('riderPhoneLink').textContent = phone;
            document.getElementById('riderPhoneLink').href = 'tel:' + phone;

            // Medical Details
            if (rider.medical) {
                document.getElementById('genotype').textContent = rider.medical.genotype || '---';
                document.getElementById('allergies').textContent = rider.medical.allergies || 'None reported';
                document.getElementById('hospital').textContent = rider.medical.hospitalPreference || 'Not specified';
                
                if (rider.medical.advanceDirectiveStatement) {
                    document.getElementById('directiveStatement').textContent = '"' + rider.medical.advanceDirectiveStatement + '"';
                    document.getElementById('emergencyDirectiveBlock').style.display = 'block';
                }
            }
            if (rider.documents && rider.documents.advanceDirectiveDoc) {
                document.getElementById('emergencyDirectiveBlock').style.display = 'block';
                document.getElementById('directiveDocBtn').href = rider.documents.advanceDirectiveDoc.url;
                document.getElementById('directiveDocBtn').style.display = 'block';
            }

            // Location
            if (s.location) {
                const loc = s.location;
                document.getElementById('locationName').textContent = loc.name || 'Unknown Location';
                if (loc.latitude && loc.longitude) {
                    document.getElementById('locationCoords').textContent =
                        loc.latitude.toFixed(6) + ', ' + loc.longitude.toFixed(6);
                    const ml = document.getElementById('mapsLink');
                    ml.href = 'https://www.google.com/maps?q=' + loc.latitude + ',' + loc.longitude;
                    ml.style.display = 'inline-flex';
                }
                document.getElementById('locationTime').textContent = '⏱ Captured: ' + fmt(s.createdAt);
            } else {
                document.getElementById('locationName').textContent = 'Location not shared';
            }
            
            // Update WhatsApp share with more info if location exists
            const plate = (rider.plateNumber || '---').toUpperCase();
            const shareText = encodeURIComponent(
                '🚨 *EMERGENCY ALERT — MyVault SOS*\n\n' +
                'A rider may need immediate assistance!\n\n' +
                '👤 *Name:* ' + (rider.name || '---') + '\n' +
                '🏍️ *Plate:* ' + plate + '\n' +
                '📍 *Location:* ' + (s.location?.name || 'Unknown') + '\n' +
                '🕐 *Time:* ' + fmt(s.createdAt) + '\n\n' +
                'View full emergency profile:\n' + currentUrl
            );
            document.getElementById('waShareBtn').href = 'https://api.whatsapp.com/send?text=' + shareText;
        }

        loadSession();
    