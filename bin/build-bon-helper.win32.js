/* Copyright 2026 nyanz00. Licensed under the Apache License, Version 2.0.
 * http://www.apache.org/licenses/LICENSE-2.0
 */
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");

// Normalize checkout line endings so a Windows Git checkout matches the published source hash.
function getSourceHash(root) {
    const hash = crypto.createHash("sha256");
    for (const file of ["bin/build-bon-helper.win32.js", "native/bon-helper/main.cpp", "native/bon-helper/BonDriver.h"]) {
        hash.update(file + "\n");
        hash.update(fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n"));
    }
    return hash.digest("hex");
}

function build() {
    if (process.platform !== "win32") throw new Error("BonDriver helper is Windows-only");
    const root = path.resolve(__dirname, "..");
    const cacheDir = path.join(root, "lib", "native");
    const bundleDir = path.join(__dirname, "native");
    const vswhere = path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
    const vs = cp.execFileSync(vswhere, ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"], { encoding: "utf8" }).trim();
    if (!vs) throw new Error("Visual Studio C++ Build Tools (Desktop development with C++) are required");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.mkdirSync(bundleDir, { recursive: true });
    const workDir = fs.mkdtempSync(path.join(cacheDir, "build-"));
    try {
        for (const arch of ["x64", "x86"]) {
            // Keep paths in environment variables to avoid interpolating them into shell code.
            const env = { ...process.env, BON_VCVARS: path.join(vs, "VC", "Auxiliary", "Build", "vcvarsall.bat"), BON_SOURCE: path.join(root, "native", "bon-helper", "main.cpp") };
            const name = `bon-helper-${arch}`;
            let commands = `cl /nologo /std:c++17 /EHsc /O2 /MT /W4 /DUNICODE /D_UNICODE "%BON_SOURCE%" /Fo:${name}.obj /Fe:${name}.exe /link /DYNAMICBASE /NXCOMPAT /Brepro\r\nif errorlevel 1 exit /b 1\r\n`;
            if (process.argv.includes("--test-driver")) {
                env.BON_TEST_SOURCE = path.join(root, "native", "bon-helper", "test-driver.cpp");
                commands += `cl /nologo /std:c++17 /EHsc /O2 /MT /W4 /LD /DUNICODE /D_UNICODE "%BON_TEST_SOURCE%" /Fo:bon-test-${arch}.obj /Fe:bon-test-${arch}.dll /link /DYNAMICBASE /NXCOMPAT /Brepro\r\n`;
            }
            const batch = `build-${arch}.cmd`;
            fs.writeFileSync(path.join(workDir, batch), `@echo off\r\ncall "%BON_VCVARS%" ${arch} >nul\r\nif errorlevel 1 exit /b 1\r\n${commands}`);
            cp.execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/c", batch], { cwd: workDir, env, stdio: "inherit", windowsHide: true });
        }
        // Publish only when both architectures compiled. Test DLLs and compiler intermediates stay ignored.
        const manifest = { sourceHash: getSourceHash(root), sha256: {} };
        for (const arch of ["x64", "x86"]) {
            const name = `bon-helper-${arch}.exe`;
            const binary = fs.readFileSync(path.join(workDir, name));
            manifest.sha256[arch] = crypto.createHash("sha256").update(binary).digest("hex");
            const temp = path.join(bundleDir, `${name}.tmp`);
            fs.writeFileSync(temp, binary);
            fs.renameSync(temp, path.join(bundleDir, name));
            if (process.argv.includes("--test-driver")) {
                fs.copyFileSync(path.join(workDir, `bon-test-${arch}.dll`), path.join(cacheDir, `bon-test-${arch}.dll`));
            }
        }
        const manifestPath = path.join(bundleDir, "bon-helper-build.json");
        fs.writeFileSync(manifestPath + ".tmp", JSON.stringify(manifest, null, 2) + "\n");
        fs.renameSync(manifestPath + ".tmp", manifestPath);
        console.log("Built bundled BonDriver helpers in bin/native (x64 / x86)");
    } finally {
        // This directory was created for this invocation; never recurse outside lib/native.
        if (path.dirname(fs.realpathSync(workDir)) !== fs.realpathSync(cacheDir) || !path.basename(workDir).startsWith("build-")) {
            throw new Error("Unexpected native build directory");
        }
        fs.rmSync(workDir, { recursive: true, force: true });
    }
}

module.exports = { getSourceHash };
if (require.main === module) build();
