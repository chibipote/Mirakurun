/*
 * Copyright 2026 nyanz00
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
 * Distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const serviceName = "mirakurun-nyanz.service";
const unitPath = `/etc/systemd/system/${serviceName}`;

function quote(value) {
    if (/[\r\n\0]/.test(value)) {
        throw new Error("Service settings cannot contain newlines or NUL.");
    }
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`;
}

function createUnit(root, node, user, home) {
    if (!/^[a-z_][a-z0-9_-]*\$?$/i.test(user) || user === "root") {
        throw new Error("Specify a non-root Linux user with --user.");
    }
    const nodeDir = path.posix.dirname(node);
    const executable = quote(node.replace(/\$/g, () => "$$"));
    const entry = quote(path.posix.join(root, "bin", "init.js").replace(/\$/g, () => "$$"));
    return `[Unit]
Description=Mirakurun nyanz
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${root.replace(/%/g, "%%")}
Environment=${quote(`HOME=${home}`)}
Environment=${quote(`PATH=${nodeDir}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`)}
Environment=USING_SYSTEMD=1
ExecStart=${executable} --max-semi-space-size=2 -r source-map-support/register ${entry}
Restart=always
RestartSec=3
TimeoutStopSec=30
KillMode=control-group

[Install]
WantedBy=multi-user.target
`;
}

function systemctl(...args) {
    execFileSync("systemctl", args, { stdio: "inherit" });
}

function main() {
    if (process.platform !== "linux" || process.getuid() !== 0) {
        throw new Error("Run this command on Linux with sudo using the Node.js 22/24/26 executable.");
    }
    const [action, ...args] = process.argv.slice(2);
    if (!["install", "uninstall"].includes(action) ||
        (args.length > 0 && !(args.length === 2 && args[0] === "--user" && action === "install"))) {
        throw new Error("Usage: sudo node bin/service.linux.js <install [--user USER]|uninstall>");
    }
    if (action === "uninstall") {
        if (fs.existsSync(unitPath)) {
            systemctl("disable", "--now", serviceName);
            fs.unlinkSync(unitPath);
            systemctl("daemon-reload");
        }
        console.log("Service removed. Config, databases and logos are preserved.");
        return;
    }
    if (!require("semver").satisfies(process.version, require("../package.json").engines.node)) {
        throw new Error("Use the Node.js 22/24/26 executable when registering the service.");
    }
    const user = args[1] || process.env.SUDO_USER;
    if (!user || !/^[a-z_][a-z0-9_-]*\$?$/i.test(user)) {
        throw new Error("Specify the service account with --user USER.");
    }
    const account = execFileSync("getent", ["passwd", user], { encoding: "utf8" }).trim().split(":");
    if (account[2] === "0") {
        throw new Error("The service account must not be root.");
    }
    const root = path.resolve(__dirname, "..");
    const unit = createUnit(root, process.execPath, user, account[5]);
    if (!fs.existsSync(path.join(root, "lib", "server.js"))) {
        throw new Error("Run npm install and npm run build as the service user first.");
    }
    execFileSync("runuser", ["-u", user, "--", "test", "-w", root]);
    if (fs.existsSync(unitPath)) {
        systemctl("stop", serviceName);
    }
    fs.writeFileSync(`${unitPath}.tmp`, unit, { mode: 0o644 });
    fs.renameSync(`${unitPath}.tmp`, unitPath);
    systemctl("daemon-reload");
    systemctl("enable", "--now", serviceName);
    console.log(`Installed ${serviceName} for ${user}. Logs: journalctl -u ${serviceName}`);
}

module.exports = { createUnit };
if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
