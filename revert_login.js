const fs = require('fs');
let html = fs.readFileSync('public/login.html', 'utf8');

const regex = /\} else if \(data\.isPending\) \{[\s\S]*?handler\.openIframe\(\);\n\s*\} else \{/g;
if (regex.test(html)) {
    html = html.replace(regex, '} else {');
}

fs.writeFileSync('public/login.html', html, 'utf8');
console.log('Login reverted successfully');
