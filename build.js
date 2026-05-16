const fs = require('fs-extra');
const path = require('path');
const cheerio = require('cheerio');
const JavaScriptObfuscator = require('javascript-obfuscator');

const srcDir = path.join(__dirname, 'public');
const distDir = path.join(__dirname, 'dist/public');

async function build() {
    try {
        console.log('Cleaning dist directory...');
        await fs.emptyDir(distDir);

        console.log('Copying public files to dist/public...');
        await fs.copy(srcDir, distDir);

        console.log('Obfuscating HTML inline scripts...');
        const files = await fs.readdir(distDir);
        for (const file of files) {
            if (file.endsWith('.html')) {
                const filePath = path.join(distDir, file);
                let html = await fs.readFile(filePath, 'utf8');
                
                const $ = cheerio.load(html, { decodeEntities: false });
                let modified = false;

                $('script').each((index, element) => {
                    // Only obfuscate inline scripts (no src attribute)
                    if (!$(element).attr('src')) {
                        const originalCode = $(element).html();
                        if (originalCode && originalCode.trim().length > 0) {
                            try {
                                const obfuscationResult = JavaScriptObfuscator.obfuscate(originalCode, {
                                    compact: true,
                                    controlFlowFlattening: true,
                                    controlFlowFlatteningThreshold: 0.75,
                                    deadCodeInjection: true,
                                    deadCodeInjectionThreshold: 0.4,
                                    debugProtection: false,
                                    disableConsoleOutput: true,
                                    identifierNamesGenerator: 'hexadecimal',
                                    log: false,
                                    numbersToExpressions: true,
                                    renameGlobals: false,
                                    selfDefending: true,
                                    simplify: true,
                                    splitStrings: true,
                                    splitStringsChunkLength: 10,
                                    stringArray: true,
                                    stringArrayCallsTransform: true,
                                    stringArrayEncoding: ['base64'],
                                    stringArrayIndexShift: true,
                                    stringArrayRotate: true,
                                    stringArrayShuffle: true,
                                    stringArrayWrappersCount: 1,
                                    stringArrayWrappersChainedCalls: true,
                                    stringArrayWrappersParametersMaxCount: 2,
                                    stringArrayWrappersType: 'variable',
                                    stringArrayThreshold: 0.75,
                                    unicodeEscapeSequence: false
                                });
                                $(element).html(obfuscationResult.getObfuscatedCode());
                                modified = true;
                            } catch (e) {
                                console.error(`Failed to obfuscate script in ${file}:`, e.message);
                            }
                        }
                    }
                });

                if (modified) {
                    await fs.writeFile(filePath, $.html());
                    console.log(`Obfuscated scripts in ${file}`);
                }
            }
        }
        console.log('Build completed successfully.');
    } catch (err) {
        console.error('Build failed:', err);
        process.exit(1);
    }
}

build();
