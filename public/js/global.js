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

// ── Client-Side Anti-Reverse Engineering & Anti-Inspection Shield ───────────
(function() {
    'use strict';

    // 1. Disable Context Menu (Right Click) across the application
    document.addEventListener('contextmenu', function(e) {
        // Permit right-click on input fields for standard typing/copy/paste
        const tag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
            return true;
        }
        e.preventDefault();
        return false;
    }, false);

    // 2. Intercept DevTools & Source View Keyboard Shortcuts
    document.addEventListener('keydown', function(e) {
        // F12 (DevTools)
        if (e.keyCode === 123) {
            e.preventDefault();
            return false;
        }
        // Ctrl+Shift+I / Cmd+Option+I (Inspect)
        // Ctrl+Shift+J / Cmd+Option+J (Console)
        // Ctrl+Shift+C / Cmd+Option+C (Element Selector)
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67)) {
            e.preventDefault();
            return false;
        }
        // Ctrl+U / Cmd+U (View Page Source)
        if ((e.ctrlKey || e.metaKey) && (e.keyCode === 85 || e.keyCode === 117)) {
            e.preventDefault();
            return false;
        }
        // Ctrl+S / Cmd+S (Save Page HTML)
        if ((e.ctrlKey || e.metaKey) && (e.keyCode === 83 || e.keyCode === 115)) {
            e.preventDefault();
            return false;
        }
    }, false);

    // 3. DevTools Open Detection & Console Stripping
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!isLocalhost) {
        // Periodic console protection to wipe exposed data
        setInterval(function() {
            try {
                if (window.console && window.console.clear) {
                    console.clear();
                }
            } catch (_) {}
        }, 3000);

        // Anti-Debugger Loop: Traps manual debugger attachment
        setInterval(function() {
            (function() {
                try {
                    const before = performance.now();
                    (function() {}['constructor']('debugger')());
                    const after = performance.now();
                    if (after - before > 100) {
                        // Execution was paused by a debugger
                        console.clear();
                    }
                } catch (_) {}
            })();
        }, 3500);
    }
})();

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
