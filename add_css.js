const fs = require('fs');
const css = `
/* --- Desktop Dashboard Layout --- */
.dashboard-layout {
    max-width: 1200px !important;
    margin: 0 auto;
    width: 100%;
}

@media (min-width: 768px) {
    .dashboard-grid {
        display: grid;
        grid-template-columns: 300px 1fr;
        gap: 2.5rem;
        align-items: start;
        margin-top: 1.5rem;
    }
    
    .dashboard-sidebar {
        background: var(--surface);
        border: 1px solid var(--glass-border);
        border-radius: 1.5rem;
        padding: 1.5rem;
        position: sticky;
        top: 2rem;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }
    
    .dashboard-main {
        background: transparent;
        min-height: 500px;
    }

    .tab-nav {
        flex-direction: column !important;
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
        padding: 0 !important;
        gap: 0.5rem;
    }

    .tab-btn {
        width: 100%;
        text-align: left;
        padding: 1rem 1.5rem !important;
        border-radius: 0.75rem !important;
        justify-content: flex-start;
        background: rgba(0,0,0,0.02) !important;
        color: var(--text) !important;
    }
    
    .tab-btn:hover {
        background: rgba(0,0,0,0.05) !important;
    }
    
    .tab-btn.active {
        background: var(--primary) !important;
        color: white !important;
    }

    #topIdentityContainer {
        border: none !important;
        background: transparent !important;
        padding: 0 !important;
        margin-bottom: 2rem !important;
    }
    
    #ownerActions {
        flex-direction: column;
        margin-top: 2rem;
    }
    
    #ownerActions .btn {
        width: 100%;
        margin-bottom: 0.5rem;
    }
}
`;
fs.appendFileSync('public/css/style.css', css);
console.log('CSS appended.');
