const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { execSync } = require('child_process');
const sanitize = require('sanitize-html');
const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('.')); // Serve index.html

app.post('/build', upload.fields([{ name: 'htmlFile' }, { name: 'iconFile' }]), (req, res) => {
    const { appName, packageName, htmlInput } = req.body;
    const htmlFile = req.files['htmlFile'] ? req.files['htmlFile'][0] : null;
    const iconFile = req.files['iconFile'] ? req.files['iconFile'][0] : null;

    // Validate inputs
    if (!appName || !packageName) {
        return res.status(400).send('Missing required fields');
    }
    if (!htmlInput && !htmlFile) {
        return res.status(400).send('Please provide HTML code or file');
    }
    if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(packageName)) {
        return res.status(400).send('Invalid package name');
    }

    // Get HTML content
    let htmlContent = htmlInput ? sanitize(htmlInput, {
        allowedTags: sanitize.defaults.allowedTags.concat(['style']),
        allowedAttributes: { ...sanitize.defaults.allowedAttributes, '*': ['style'] }
    }) : fs.readFileSync(htmlFile.path, 'utf-8');

    const projectDir = `temp-${Date.now()}`;
    try {
        // Create Cordova project
        execSync(`cordova create ${projectDir} ${packageName} ${appName}`, { stdio: 'inherit' });

        // Save HTML to www/index.html
        fs.writeFileSync(`${projectDir}/www/index.html`, htmlContent);

        // Handle icon if provided
        if (iconFile) {
            const iconPath = `${projectDir}/res/icon.png`;
            fs.renameSync(iconFile.path, iconPath);
            const configPath = `${projectDir}/config.xml`;
            let config = fs.readFileSync(configPath, 'utf-8');
            config = config.replace('</widget>', '<platform name="android"><icon src="res/icon.png" /></platform></widget>');
            fs.writeFileSync(configPath, config);
        }

        // Add Android platform and build
        process.chdir(projectDir);
        execSync('cordova platform add android', { stdio: 'inherit' });
        execSync('cordova build android', { stdio: 'inherit' });

        // Send APK
        const apkPath = `platforms/android/app/build/outputs/apk/debug/app-debug.apk`;
        res.sendFile(apkPath, { root: '.' }, (err) => {
            // Clean up
            process.chdir('..');
            fs.rmSync(projectDir, { recursive: true, force: true }, () => {});
            if (htmlFile) fs.unlinkSync(htmlFile.path, () => {});
            if (iconFile && !iconFile.path.includes('res/icon.png')) fs.unlinkSync(iconFile.path, () => {});
            if (err) res.status(500).send('Error sending APK');
        });
    } catch (error) {
        process.chdir('..');
        fs.rmSync(projectDir, { recursive: true, force: true }, () => {});
        if (htmlFile) fs.unlinkSync(htmlFile.path, () => {});
        if (iconFile && !iconFile.path.includes('res/icon.png')) fs.unlinkSync(iconFile.path, () => {});
        res.status(500).send('Build failed: ' + error.message);
    }
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
