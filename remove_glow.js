const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'public');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));
for (const file of files) {
  const filepath = path.join(dir, file);
  let content = fs.readFileSync(filepath, 'utf8');
  
  // Remove class="glow-bg"
  content = content.replace(/<body([^>]*)class=(['"])(.*?)\2([^>]*)>/gi, (match, p1, p2, p3, p4) => {
      let classes = p3.split(' ').map(c => c.trim()).filter(c => c !== 'glow-bg');
      if (classes.length > 0) {
          return `<body${p1}class=${p2}${classes.join(' ')}${p2}${p4}>`;
      } else {
          return `<body${p1}${p4}>`;
      }
  });

  // Remove <div class="glow-orb orb-X"></div>
  content = content.replace(/<div\s+class=['"]glow-orb\s+orb-\d+['"]>\s*<\/div>\s*/gi, '');

  fs.writeFileSync(filepath, content, 'utf8');
}
console.log('Done');
