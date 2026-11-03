/*
   Copyright 2016 kanreisa

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/
"use strict";

if (process.platform !== "win32") {
    console.error("Windows service management is only available on win32.");
    process.exit(1);
}

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const serviceName = "mirakurun-nyanz";
const serviceDisplayName = "mirakurun-nyanz";
const rootDir = path.resolve(__dirname, "..");

function findWinserCommands() {
    try {
        return childProcess.execFileSync("where.exe", ["winser.cmd"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"]
        }).trim().split(/\r?\n/).filter(Boolean);
    } catch (e) {
        return [];
    }
}

function getWinserCliCandidates() {
    const candidates = [
        path.join(rootDir, "node_modules", "winser", "bin", "winser"),
        path.join(rootDir, "node_modules", "winser", "bin", "winser.js")
    ];

    for (const commandPath of [
        path.join(rootDir, "node_modules", ".bin", "winser.cmd"),
        ...findWinserCommands()
    ]) {
        const commandDir = path.dirname(commandPath);

        candidates.push(path.resolve(commandDir, "..", "winser", "bin", "winser"));
        candidates.push(path.resolve(commandDir, "..", "winser", "bin", "winser.js"));
        candidates.push(path.resolve(commandDir, "node_modules", "winser", "bin", "winser"));
        candidates.push(path.resolve(commandDir, "node_modules", "winser", "bin", "winser.js"));
    }

    return candidates;
}

function resolveWinserCli() {
    const candidates = getWinserCliCandidates();
    const winserCliPath = candidates.find((candidate) => fs.existsSync(candidate));

    if (winserCliPath) {
        return winserCliPath;
    }

    console.error("winser was not found. Run npm install, or install winser with npm install -g winser.");
    process.exit(1);
}

function execWinser(args) {
    childProcess.execFileSync(process.execPath, [resolveWinserCli(), ...args], {
        stdio: "inherit"
    });
}

function serviceExists() {
    try {
        childProcess.execFileSync("sc.exe", ["query", serviceName], {
            stdio: "ignore"
        });

        return true;
    } catch (e) {
        return false;
    }
}

const action = process.argv[2];

if (action !== "install" && action !== "uninstall") {
    console.error("Usage: node bin/service.win32.js <install|uninstall>");
    process.exit(1);
}

if (action === "uninstall") {
    if (serviceExists() === false) {
        console.log(`Windows service "${serviceName}" is not installed.`);
        process.exit(0);
    }

    execWinser(["-r", "-x", "-s", "--name", serviceName]);
    process.exit(0);
}

if (serviceExists()) {
    console.log(`Windows service "${serviceName}" is already installed. Reinstalling...`);
    execWinser(["-r", "-x", "-s", "--name", serviceName]);
}

const logDir = path.join(rootDir, "data", "log");
if (fs.existsSync(logDir) === false) {
    fs.mkdirSync(logDir, { recursive: true });
}
const stdoutLogPath = path.join(logDir, "stdout.log");
const stderrLogPath = path.join(logDir, "stderr.log");
const initScriptPath = path.join(rootDir, "bin", "init.win32.js");
const startCommand = `"${process.execPath}" --max-semi-space-size=2 "${initScriptPath}"`;

execWinser([
    "-i", "-a", "--name", serviceName, "--displayname", serviceDisplayName, "--startuptype", "auto",
    "--startcmd", startCommand,
    "--set", "AppPriority ABOVE_NORMAL_PRIORITY_CLASS",
    "--set", "Type SERVICE_WIN32_OWN_PROCESS",
    "--set", `AppDirectory ${rootDir}`,
    "--set", `AppStdout ${stdoutLogPath}`,
    "--set", `AppStderr ${stderrLogPath}`,
    "--env", `USERPROFILE=${process.env.USERPROFILE || ""}`,
    "--env", `LOCALAPPDATA=${process.env.LOCALAPPDATA || ""}`,
    "--env", "USING_WINSER=1"
]);
