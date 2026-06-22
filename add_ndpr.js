const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'public');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

const snippet = `
<!-- NDPR Consent Banner -->
<style>
#ndpr-banner {
    position: fixed;
    bottom: 0;
    left: 0;
    width: 100%;
    background: var(--surface, #ffffff);
    color: var(--text, #0f172a);
    padding: 1rem 2rem;
    box-shadow: 0 -4px 10px rgba(0, 0, 0, 0.05);
    z-index: 9999;
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    border-top: 1px solid var(--glass-border, rgba(0,0,0,0.1));
    font-family: 'Inter', system-ui, sans-serif;
}
@media (min-width: 768px) {
    #ndpr-banner {
        flex-direction: row;
    }
}
#ndpr-banner p {
    margin: 0;
    font-size: 0.9rem;
    max-width: 800px;
    line-height: 1.5;
}
#ndpr-banner .ndpr-buttons {
    display: flex;
    gap: 1rem;
    flex-shrink: 0;
}
#ndpr-banner button {
    padding: 0.6rem 1.5rem;
    border-radius: 0.5rem;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: all 0.3s ease;
    font-size: 0.9rem;
}
#ndpr-accept {
    background: var(--primary, #0d9488);
    color: white;
}
#ndpr-reject {
    background: transparent;
    border: 1px solid var(--text-muted, #64748b);
    color: var(--text, #0f172a);
}
#ndpr-accept:hover { background: var(--primary-dark, #0f766e); }
#ndpr-reject:hover { background: rgba(0,0,0,0.05); }
</style>
<div id="ndpr-banner">
    <p><strong>NDPR Compliance:</strong> We use cookies and collect data in accordance with the Nigeria Data Protection Regulation (NDPR) to improve your experience and provide our services. Do you consent to our data collection practices?</p>
    <div class="ndpr-buttons">
        <button id="ndpr-reject">Reject</button>
        <button id="ndpr-accept">Accept</button>
    </div>
</div>
<script>
document.addEventListener('DOMContentLoaded', () => {
    const banner = document.getElementById('ndpr-banner');
    if (!banner) return;
    
    if (!localStorage.getItem('ndpr_consent')) {
        banner.style.display = 'flex';
    }

    document.getElementById('ndpr-accept').addEventListener('click', () => {
        localStorage.setItem('ndpr_consent', 'accepted');
        banner.style.display = 'none';
    });

    document.getElementById('ndpr-reject').addEventListener('click', () => {
        localStorage.setItem('ndpr_consent', 'rejected');
        banner.style.display = 'none';
    });
});
</script>
`;

for (const file of files) {
  const filepath = path.join(dir, file);
  let content = fs.readFileSync(filepath, 'utf8');
  
  // Remove existing NDPR banner if any (for idempotency)
  content = content.replace(/<!-- NDPR Consent Banner -->[\s\S]*?<\/script>/, '');
  
  // Inject before </body>
  if (content.includes('</body>')) {
      content = content.replace('</body>', snippet + '\n</body>');
  } else {
      content += snippet;
  }

  fs.writeFileSync(filepath, content, 'utf8');
}
console.log('NDPR Banner injected.');
