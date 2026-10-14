const fs = require('fs-extra');
const path = require('path');
const cheerio = require('cheerio');
const JavaScriptObfuscator = require('javascript-obfuscator');

const srcDir = path.join(__dirname, 'public');
const distDir = path.join(__dirname, 'dist/public');

// Optimized High-Speed Production Obfuscation Profile (Memory-Safe for Render Cloud Containers)
const OBFUSCATION_OPTIONS = {
    compact: true,
    controlFlowFlattening: false, // Disabled on monolithic HTML templates to prevent 5-minute CPU stalls on cloud builds
    deadCodeInjection: false,     // Prevents memory exhaustion on 512MB RAM instances
    debugProtection: true,
    debugProtectionInterval: 3000,
    disableConsoleOutput: true,
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: false,
    renameGlobals: false, // Preserves globally referenced HTML onclick handlers
    selfDefending: false,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 8,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.8,
    stringArrayWrappersCount: 1,
    stringArrayWrappersChainedCalls: true,
    transformObjectKeys: true,
    unicodeEscapeSequence: false
};

async function build() {
    try {
        console.log('Cleaning dist directory...');
        await fs.emptyDir(distDir);

        console.log('Copying public files to dist/public...');
        await fs.copy(srcDir, distDir);

        console.log('Obfuscating HTML inline scripts with anti-reverse engineering protection...');
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
                                const obfuscationResult = JavaScriptObfuscator.obfuscate(originalCode, OBFUSCATION_OPTIONS);
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
                    console.log(`Protected & Obfuscated inline scripts in ${file}`);
                }
            }
        }

        // Obfuscate custom standalone JS files (skipping third-party vendor minified libs)
        const jsDir = path.join(distDir, 'js');
        if (await fs.pathExists(jsDir)) {
            const jsFiles = await fs.readdir(jsDir);
            for (const jsFile of jsFiles) {
                if (jsFile.endsWith('.js') && !jsFile.endsWith('.min.js')) {
                    const jsPath = path.join(jsDir, jsFile);
                    const originalJs = await fs.readFile(jsPath, 'utf8');
                    try {
                        const obfuscatedJs = JavaScriptObfuscator.obfuscate(originalJs, OBFUSCATION_OPTIONS);
                        await fs.writeFile(jsPath, obfuscatedJs.getObfuscatedCode());
                        console.log(`Protected & Obfuscated standalone script: js/${jsFile}`);
                    } catch (e) {
                        console.error(`Failed to obfuscate standalone script js/${jsFile}:`, e.message);
                    }
                }
            }
        }

        // Remove any residual source maps from production dist
        const cleanMaps = async (dir) => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await cleanMaps(fullPath);
                } else if (entry.name.endsWith('.map')) {
                    await fs.remove(fullPath);
                    console.log(`Removed source-map: ${entry.name}`);
                }
            }
        };
        await cleanMaps(distDir);

        console.log('Build completed successfully. All client assets armored.');
    } catch (err) {
        console.error('Build failed:', err);
        process.exit(1);
    }
}

build();
