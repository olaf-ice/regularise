const fs = require('fs');
let html = fs.readFileSync('public/profile.html', 'utf8');

// 1. Replace container class
html = html.replace(
    '<div class="container animate-fade-in" style="max-width: 500px; position: relative; z-index: 1;">',
    '<div class="container dashboard-layout animate-fade-in" style="position: relative; z-index: 1;">'
);

// 2. Extract block from <main id="profileContent"... to end of ownerActions
const startPattern = /<main id="profileContent"[\s\S]*?<div id="ownerActions"[\s\S]*?<\/div>\r?\n/;
const replacement = `<main id="profileContent" style="display: none;">
        <div class="dashboard-grid">
            <aside class="dashboard-sidebar no-print">
                <div id="topIdentityContainer" style="display: flex; flex-direction: column; gap: 1rem; align-items: center; justify-content: center; margin-bottom: 1.5rem; border: 1px solid var(--glass-border); border-radius: 1rem; padding: 1rem; background: var(--surface);">
                    <div id="passportFrame" style="width: 120px; height: 120px; border-radius: 50%; border: 3px solid var(--primary); margin: 0; overflow: hidden; background: var(--surface); transition: all 0.3s ease;">
                        <img id="passportImg" src="assets/default-avatar.png" alt="Passport" style="width: 100%; height: 100%; object-fit: cover;">
                    </div>
                    <div id="namePlateContainer" style="text-align: center;">
                        <h2 id="riderName" style="margin-bottom: 0.25rem; font-size: 1.5rem; font-weight: 800; color: var(--text); transition: all 0.3s ease;">Rider Name</h2>
                        <p id="riderPlate" style="color: var(--primary-light); font-weight: 900; font-size: 1.35rem; letter-spacing: 1px; transition: all 0.3s ease;">PLATE: ---</p>
                    </div>
                </div>

                <div class="tab-nav no-print">
                    <button class="tab-btn active" onclick="switchTab('overview')">Overview</button>
                    <button class="tab-btn" onclick="switchTab('vehicle')">Vehicle</button>
                    <button class="tab-btn" onclick="switchTab('wallet')">Document Vault 🔒</button>
                    <button class="tab-btn" onclick="switchTab('emergency')">Emergency</button>
                    <button class="tab-btn" onclick="switchTab('printables')">Printables 🔒</button>
                    <button class="tab-btn" onclick="switchTab('security')">Security 🔒</button>
                </div>

                <div id="ownerActions" class="no-print" style="display: none;">
                    <button onclick="openEditProfileModal()" class="btn btn-outline" style="border-color: var(--primary-light); color: var(--primary-light);">✏️ Edit Profile</button>
                    <button onclick="logoutRider()" class="btn btn-outline" style="border-color: var(--error); color: var(--error);">🚪 Log Out</button>
                </div>
            </aside>
            <div class="dashboard-main">
                <div id="tab-overview" class="tab-content active">\n`;

html = html.replace(startPattern, replacement);

// 3. Add closing tags before </main>
html = html.replace('        </main>', '            </div><!-- end dashboard-main -->\n        </div><!-- end dashboard-grid -->\n        </main>');

fs.writeFileSync('public/profile.html', html, 'utf8');
console.log('Profile HTML restructured!');
