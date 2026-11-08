/* Copyright 2026 nyanz00. Licensed under the Apache License, Version 2.0.
 * http://www.apache.org/licenses/LICENSE-2.0
 */
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "lib", "native");
const manifestPath = path.join(out, "bon-helper-build.json");
const ifBuilt = process.argv.includes("--if-built");
if (ifBuilt && (process.platform !== "win32" || !fs.existsSync(manifestPath))) process.exit(0);
if (process.platform !== "win32") throw new Error("BonDriver helper is Windows-only");
const hash = crypto.createHash("sha256");
for (const file of [__filename, path.join(root, "native", "bon-helper", "main.cpp"), path.join(root, "native", "bon-helper", "BonDriver.h")]) hash.update(fs.readFileSync(file));
const version = hash.digest("hex").slice(0, 16);
if (ifBuilt && ["x64", "x86"].every(arch => fs.existsSync(path.join(out, `bon-helper-${version}-${arch}.exe`)))) process.exit(0);
const vswhere = path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
const vs = cp.execFileSync(vswhere, ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"], { encoding: "utf8" }).trim();
if (!vs) throw new Error("Visual Studio C++ Build Tools (Desktop development with C++) are required");
fs.mkdirSync(out, { recursive: true });
for (const arch of ["x64", "x86"]) {
    // Put user-specific paths in environment variables, not interpolated shell code.
    const env = { ...process.env, BON_VCVARS: path.join(vs, "VC", "Auxiliary", "Build", "vcvarsall.bat"), BON_SOURCE: path.join(root, "native", "bon-helper", "main.cpp") };
    const batch = path.join(out, `build-${arch}.cmd`);
    const name = `bon-helper-${version}-${arch}`;
    let commands = `cl /nologo /std:c++17 /EHsc /O2 /MT /W4 /DUNICODE /D_UNICODE "%BON_SOURCE%" /Fo:${name}.obj /Fe:${name}.exe /link /DYNAMICBASE /NXCOMPAT\r\nif errorlevel 1 exit /b 1\r\n`;
    if (process.argv.includes("--test-driver")) {
        env.BON_TEST_SOURCE = path.join(root, "native", "bon-helper", "test-driver.cpp");
        commands += `cl /nologo /std:c++17 /EHsc /O2 /MT /W4 /LD /DUNICODE /D_UNICODE "%BON_TEST_SOURCE%" /Fo:bon-test-${arch}.obj /Fe:bon-test-${arch}.dll /link /DYNAMICBASE /NXCOMPAT\r\n`;
    }
    fs.writeFileSync(batch, `@echo off\r\ncall "%BON_VCVARS%" ${arch} >nul\r\nif errorlevel 1 exit /b 1\r\n${commands}`);
    try {
        cp.execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/c", path.basename(batch)], { cwd: out, env, stdio: "inherit", windowsHide: true });
    } finally {
        fs.unlinkSync(batch);
    }
}
// Versioned filenames allow rebuilding during a Web update while an old helper is still running.
const manifestTemp = manifestPath + ".tmp";
fs.writeFileSync(manifestTemp, JSON.stringify({ version }) + "\n");
fs.renameSync(manifestTemp, manifestPath);
for (const file of fs.readdirSync(out)) {
    if (/^bon-helper-[a-f0-9]{16}-(?:x64|x86)\.(?:exe|obj)$/.test(file) && !file.includes(version)) {
        try {
            fs.unlinkSync(path.join(out, file));
        } catch (err) {
            // An old running helper is locked on Windows. A subsequent build can remove it.
            if (!["EPERM", "EACCES", "EBUSY"].includes(err.code)) throw err;
        }
    }
}
console.log(`Built BonDriver helpers (${version}, x64 / x86)`);
