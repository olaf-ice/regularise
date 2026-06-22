(function() {
    const THEME_KEY = 'myvault-theme-preference';
    
    function applyTheme(theme) {
        if (theme === 'system') {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
        } else {
            document.documentElement.setAttribute('data-theme', theme);
        }
    }

    function initTheme() {
        const savedTheme = localStorage.getItem(THEME_KEY) || 'system';
        applyTheme(savedTheme);

        // Listen for system changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (localStorage.getItem(THEME_KEY) === 'system') {
                document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
            }
        });

        // Add UI
        window.addEventListener('DOMContentLoaded', addThemeUI);
    }

    function setTheme(theme) {
        localStorage.setItem(THEME_KEY, theme);
        applyTheme(theme);
    }

    function addThemeUI() {
        // Only add if not already present
        if (document.getElementById('theme-switcher-container')) return;

        const container = document.createElement('div');
        container.id = 'theme-switcher-container';
        container.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            background: var(--surface);
            border: 1px solid var(--glass-border);
            border-radius: 50px;
            padding: 5px 10px;
            display: flex;
            align-items: center;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        `;

        const select = document.createElement('select');
        select.style.cssText = `
            appearance: none;
            background: transparent;
            border: none;
            color: var(--text);
            font-size: 0.875rem;
            cursor: pointer;
            outline: none;
            padding-right: 5px;
            font-weight: 500;
        `;
        
        const options = [
            { value: 'light', text: '☀️ Light' },
            { value: 'dark', text: '🌙 Dark' },
            { value: 'system', text: '💻 System' }
        ];

        const currentTheme = localStorage.getItem(THEME_KEY) || 'system';

        options.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.text;
            if (opt.value === currentTheme) option.selected = true;
            // set dark background for options if needed, but default works fine
            select.appendChild(option);
        });

        select.addEventListener('change', (e) => {
            setTheme(e.target.value);
        });

        container.appendChild(select);
        document.body.appendChild(container);
    }

    initTheme();
})();
