// Global Security Helper: Anti-XSS HTML Sanitizer
window.escapeHTML = function(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

document.addEventListener('DOMContentLoaded', () => {
    // 1. NDPR Privacy Banner Logic
    const bannerHTML = `
        <div id="ndpr-banner">
            <p><strong>Privacy Notice:</strong> We use cookies and local storage to ensure your security and provide a better experience in compliance with NDPR. <a href="privacy.html" style="color: var(--primary); text-decoration: underline;">Learn More</a></p>
            <div class="ndpr-buttons">
                <button id="ndpr-reject">Reject</button>
                <button id="ndpr-accept">Accept</button>
            </div>
        </div>
    `;

    if (!localStorage.getItem('ndpr_consent')) {
        document.body.insertAdjacentHTML('beforeend', bannerHTML);
        const banner = document.getElementById('ndpr-banner');
        banner.style.display = 'flex';

        document.getElementById('ndpr-accept').addEventListener('click', () => {
            localStorage.setItem('ndpr_consent', 'accepted');
            banner.style.display = 'none';
            document.dispatchEvent(new Event('ndpr-consent-accepted'));
        });

        document.getElementById('ndpr-reject').addEventListener('click', () => {
            localStorage.setItem('ndpr_consent', 'rejected');
            banner.style.display = 'none';
        });
    }

    // 2. Tawk.to Live Chat Widget - loaded ONLY after the visitor accepts (NDPA consent)
    let tawkLoaded = false;
    function loadTawk() {
        if (tawkLoaded) return;
        tawkLoaded = true;
        window.Tawk_API = window.Tawk_API || {};
        window.Tawk_LoadStart = new Date();
        var s1 = document.createElement("script"), s0 = document.getElementsByTagName("script")[0];
        s1.async = true;
        s1.src = 'https://embed.tawk.to/6a1da712f961bc1c2ff57452/1jq1t989h';
        s1.charset = 'UTF-8';
        s1.setAttribute('crossorigin', '*');
        if (s0 && s0.parentNode) {
            s0.parentNode.insertBefore(s1, s0);
        } else {
            document.head.appendChild(s1);
        }
    }

    if (localStorage.getItem('ndpr_consent') === 'accepted') {
        loadTawk();
    } else {
        document.addEventListener('ndpr-consent-accepted', loadTawk, { once: true });
    }
});
