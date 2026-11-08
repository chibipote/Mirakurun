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
Buffer.poolSize = 0; // disable memory pool

require("dotenv").config();

// DVB デバイスの ioctl と dvr の読み出しは libuv のスレッドプールで実行するため、既定の 4 から増やす
// (複数のチューナーを同時に選局する間も、配信中の読み出しを待たせないため。スレッドプールを使う前に設定する)
// (.env で指定した値を優先するため、dotenv の後に設定する)
if (!process.env.UV_THREADPOOL_SIZE) {
    process.env.UV_THREADPOOL_SIZE = "16";
}

import { execSync } from "child_process";
import { createHash } from "crypto";
import { createWriteStream, existsSync, mkdirSync, statSync } from "fs";
import { join, resolve } from "path";

const isWindows = process.platform === "win32";
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

if (process.platform !== "linux" && !isWindows) {
    console.warn("running in not linux!");
}

if (!isWindows && isRoot) {
    try {
        execSync(`renice -n -10 -p ${ process.pid }`);
        execSync(`ionice -c 1 -n 7 -p ${ process.pid }`);
    } catch (e) {
        console.warn("error on modify nice: " + (e as Error).message);
    }
} else if (!isWindows) {
    console.warn("running in not root!");
}

process.title = "Mirakurun: Server";

function setEnv(name: string, value: string) {
    process.env[name] = process.env[name] || value;
}

function setPortableEnv(): void {
    const rootDir = resolve(__dirname, "..");
    const configDir = join(rootDir, "data", "config");
    const dataDir = join(rootDir, "data", "db");
    const logDir = join(rootDir, "data", "log");

    ensurePortableData(configDir, dataDir, logDir);

    setEnv("SERVER_CONFIG_PATH", join(configDir, "server.yml"));
    setEnv("TUNERS_CONFIG_PATH", join(configDir, "tuners.yml"));
    setEnv("CHANNELS_CONFIG_PATH", join(configDir, "channels.yml"));
    setEnv("SERVICES_DB_PATH", join(dataDir, "services.json"));
    setEnv("PROGRAMS_DB_PATH", join(dataDir, "programs.json"));
    setEnv("LOGO_DATA_DIR_PATH", join(dataDir, "logo-data"));
    setEnv("LOGO_MAP_PATH", join(dataDir, "logo-map.json"));
    setEnv("MIRAKURUN_PLATFORM", process.platform);

    setupCliLogFiles(logDir);
}

function ensurePortableData(configDir: string, dataDir: string, logDir: string): void {
    ensureDirectory(configDir, "config");
    ensureDirectory(dataDir, "db");
    ensureDirectory(logDir, "log");
}

function ensureDirectory(path: string, name: string): void {
    if (existsSync(path) === true) {
        if (statSync(path).isDirectory() === false) {
            console.error(`Portable ${name} path exists but is not a directory: ${path}`);
            process.exit(1);
        }
        return;
    }

    mkdirSync(path, { recursive: true });
}

function setupCliLogFiles(logDir: string): void {
    if (process.env.USING_WINSER === "1" || process.env.USING_SYSTEMD === "1" || process.env.MIRAKURUN_CLI_LOG === "0") {
        return;
    }

    if (existsSync(logDir) === false) {
        mkdirSync(logDir, { recursive: true });
    }

    const stdout = createWriteStream(join(logDir, "stdout.log"), { flags: "a" });
    const stderr = createWriteStream(join(logDir, "stderr.log"), { flags: "a" });
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    const originalStderrWrite = process.stderr.write.bind(process.stderr);

    stdout.on("error", () => undefined);
    stderr.on("error", () => undefined);

    process.stdout.write = ((chunk: any, encoding?: any, callback?: any) => {
        stdout.write(chunk, encoding);
        return originalStdoutWrite(chunk, encoding, callback);
    }) as typeof process.stdout.write;

    process.stderr.write = ((chunk: any, encoding?: any, callback?: any) => {
        stderr.write(chunk, encoding);
        return originalStderrWrite(chunk, encoding, callback);
    }) as typeof process.stderr.write;
}

if (isWindows || (process.env.MIRAKURUN_PORTABLE === "1" && process.env.DOCKER !== "YES")) {
    setPortableEnv();
} else {
    setEnv("SERVER_CONFIG_PATH", "/usr/local/etc/mirakurun/server.yml");
    setEnv("TUNERS_CONFIG_PATH", "/usr/local/etc/mirakurun/tuners.yml");
    setEnv("CHANNELS_CONFIG_PATH", "/usr/local/etc/mirakurun/channels.yml");
    setEnv("SERVICES_DB_PATH", "/usr/local/var/db/mirakurun/services.json");
    setEnv("PROGRAMS_DB_PATH", "/usr/local/var/db/mirakurun/programs.json");
    setEnv("LOGO_DATA_DIR_PATH", "/usr/local/var/db/mirakurun/logo-data");
    setEnv("LOGO_MAP_PATH", "/usr/local/var/db/mirakurun/logo-map.json");
}

import _ from "./Mirakurun/_";
import status from "./Mirakurun/status";
import Event from "./Mirakurun/Event";
import Job from "./Mirakurun/Job";
import Tuner from "./Mirakurun/Tuner";
import Channel from "./Mirakurun/Channel";
import Service from "./Mirakurun/Service";
import Program from "./Mirakurun/Program";
import Server from "./Mirakurun/Server";
import * as config from "./Mirakurun/config";
import * as log from "./Mirakurun/log";

// Bootstrap failures must reach Node's default handler before status is available.
process.on("uncaughtException", err => {
    ++status.errorCount.uncaughtException;
    console.error(err.stack);
});
process.on("unhandledRejection", err => {
    ++status.errorCount.unhandledRejection;
    console.error(err);
});

(async function top() {
    _.config.server = await config.loadServer();
    _.config.channels = await config.loadChannels();
    _.configIntegrity.channels = createHash("sha256").update(JSON.stringify(_.config.channels)).digest("base64");
    _.config.tuners = await config.loadTuners();

    if (typeof _.config.server.logLevel === "number") {
        (<any> log).logLevel = _.config.server.logLevel;
    }
    if (typeof _.config.server.maxLogHistory === "number") {
        (<any> log).maxLogHistory = _.config.server.maxLogHistory;
    }

    _.event = new Event();
    _.job = new Job();
    _.tuner = new Tuner();
    _.channel = new Channel();
    _.service = new Service();
    _.program = new Program();
    _.server = new Server();

    await _.service.load();
    await _.program.load();

    if (process.env.SETUP === "true") {
        log.info("setup is done.");
        process.exit(0);
    }

    _.server.init();
})();
