const fs = require('fs');
const cheerio = require('cheerio');
const JavaScriptObfuscator = require('javascript-obfuscator');

let html = fs.readFileSync('public/admin.html', 'utf8');
const $ = cheerio.load(html, { decodeEntities: false });
let modified = false;

$('script').each((index, element) => {
    if (!$(element).attr('src')) {
        const originalCode = $(element).html();
        console.log('Found script tag with length:', originalCode ? originalCode.length : 0);
        if (originalCode && originalCode.trim().length > 0) {
            try {
                const obfuscated = JavaScriptObfuscator.obfuscate(originalCode, { compact: true });
                console.log('Obfuscated successfully, length:', obfuscated.getObfuscatedCode().length);
            } catch(e) {
                console.error('Error:', e.message);
            }
        }
    }
});
