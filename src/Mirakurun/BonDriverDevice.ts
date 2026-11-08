/*
   Copyright 2026 nyanz00
   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/
import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import EventEmitter = require("eventemitter3");
import { parseCommandForSpawn } from "./command";

export interface BonDriverOptions {
    driver: string;
    space: number;
    channel: number;
}

/** Interpret only the supported BonRecTest arguments. Never silently discard options. */
export function parseBonRecTestCommand(command: string): BonDriverOptions {
    const parsed = parseCommandForSpawn(command);
    if (!/^BonRecTest(?:\.exe)?$/i.test(parsed.command.split(/[\\/]/).pop())) {
        throw new Error("BonDriver helper requires a BonRecTest command");
    }
    const values = new Map<string, string>();
    for (let i = 0; i < parsed.args.length; i += 2) {
        const key = parsed.args[i];
        const value = parsed.args[i + 1];
        if (!["--driver", "--space", "--channel", "--output"].includes(key) || value === undefined || values.has(key)) {
            throw new Error(`Unsupported BonDriver helper argument: ${key}`);
        }
        values.set(key, value);
    }
    if (!values.get("--driver") || values.get("--output") !== "-") {
        throw new Error("BonDriver helper requires --driver and --output -");
    }
    const number = (key: string, fallback?: string) => {
        const value = values.get(key) ?? fallback;
        if (!/^\d+$/.test(value || "") || Number(value) > 0xffffffff) {
            throw new Error(`BonDriver helper requires an unsigned integer ${key}`);
        }
        return Number(value);
    };
    return { driver: path.resolve(values.get("--driver")), space: number("--space", "0"), channel: number("--channel") };
}

export function getBonDriverArchitecture(driver: string): "x64" | "x86" {
    const file = fs.openSync(driver, "r");
    try {
        const dos = Buffer.alloc(64);
        if (fs.readSync(file, dos, 0, dos.length, 0) !== dos.length || dos.readUInt16LE(0) !== 0x5a4d) {
            throw new Error("Invalid BonDriver DLL header");
        }
        const pe = Buffer.alloc(6);
        if (fs.readSync(file, pe, 0, pe.length, dos.readUInt32LE(0x3c)) !== pe.length || pe.readUInt32LE(0) !== 0x4550) {
            throw new Error("Invalid BonDriver PE header");
        }
        switch (pe.readUInt16LE(4)) {
            case 0x8664: return "x64";
            case 0x14c: return "x86";
            default: throw new Error("BonDriver helper supports x86 / x64 DLLs only");
        }
    } finally {
        fs.closeSync(file);
    }
}

const children = new Set<childProcess.ChildProcess>();
// Covers process.exit(), Windows service restart and unhandled startup errors too.
process.once("exit", () => {
    for (const child of children) {
        child.kill();
    }
});

/** One lazy, persistent helper per tuner; its DLL remains loaded, its tuner never stays open idle. */
export default class BonDriverDevice extends EventEmitter {
    private _process: childProcess.ChildProcess = null;
    private _ready: Promise<void> = null;
    private _pending = new Map<number, { resolve: () => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>();
    private _sequence = 0;
    private _session = 0;
    private _buffer = Buffer.alloc(0);
    private _stderr = "";
    private _queue: Promise<unknown> = Promise.resolve();
    private _destroying: Promise<void> = null;
    private _active = false;
    private _disposed = false;

    constructor(readonly driver: string) {
        super();
    }

    get pid(): number | null {
        return this._process?.pid ?? null;
    }

    start(options: BonDriverOptions): Promise<void> {
        return this._serial(async () => {
            if (this._disposed) {
                throw new Error("BonDriver helper has been disposed");
            }
            if (options.driver !== this.driver) {
                throw new Error("BonDriver helper cannot change its driver DLL");
            }
            await this._ensureProcess();
            this._active = true;
            const id = this._nextId();
            this._session = id;
            try {
                await this._request(id, `TUNE ${id} ${options.space} ${options.channel}`);
            } catch (err) {
                this._session = 0;
                await this._destroy();
                throw err;
            }
        });
    }

    stopStream(): Promise<void> {
        // Suppress queued old-channel frames immediately, before STOP is acknowledged.
        this._session = 0;
        return this._serial(async () => {
            this._session = 0;
            if (!this._process) {
                return;
            }
            const id = this._nextId();
            try {
                await this._request(id, `STOP ${id}`);
                this._active = false;
            } catch (err) {
                await this._destroy();
                throw err;
            }
        });
    }

    close(): Promise<void> {
        this._disposed = true;
        this._session = 0;
        return this._serial(async () => {
            if (!this._process) {
                return;
            }
            const id = this._nextId();
            try {
                await this._request(id, `QUIT ${id}`);
            } finally {
                await this._destroy();
            }
        });
    }

    private _serial(fn: () => Promise<void>): Promise<void> {
        const result = this._queue.then(fn);
        this._queue = result.catch(() => undefined);
        return result;
    }

    private _nextId(): number {
        this._sequence = (this._sequence % 0xffffffff) + 1;
        return this._sequence;
    }

    private async _ensureProcess(): Promise<void> {
        if (this._ready) {
            return this._ready;
        }
        if (process.platform !== "win32") {
            throw new Error("BonDriver helper is Windows-only");
        }
        const nativeDir = path.join(__dirname, "..", "native");
        let version: string;
        try {
            version = JSON.parse(fs.readFileSync(path.join(nativeDir, "bon-helper-build.json"), "utf8")).version;
        } catch (_) {
            version = "";
        }
        if (!/^[a-f0-9]{16}$/.test(version)) {
            throw new Error("BonDriver helper is missing. Run npm run build:bon-helper with Visual Studio C++ Build Tools installed");
        }
        const exe = path.join(nativeDir, `bon-helper-${version}-${getBonDriverArchitecture(this.driver)}.exe`);
        if (!fs.existsSync(exe)) {
            throw new Error("BonDriver helper is missing. Run npm run build:bon-helper");
        }
        const child = childProcess.spawn(exe, [this.driver, String(process.pid)], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
        this._process = child;
        children.add(child);
        this._buffer = Buffer.alloc(0);
        this._stderr = "";
        this._ready = this._request(0);
        child.stdout.on("data", data => this._onData(data));
        child.stderr.on("data", data => this._onStderr(data));
        // Reject commands on close, after OS resources have been released. Error alone precedes close.
        let failure: Error = null;
        child.once("error", err => failure = err);
        child.stdin.on("error", err => {
            failure = err;
            child.kill();
        });
        child.once("close", code => {
            children.delete(child);
            const active = this._active;
            const expected = this._destroying !== null || this._disposed;
            this._active = false;
            this._session = 0;
            this._process = null;
            this._ready = null;
            const err = failure || new Error(`BonDriver helper exited (${code})`);
            for (const pending of this._pending.values()) {
                clearTimeout(pending.timer);
                pending.reject(err);
            }
            this._pending.clear();
            if (active && !expected) {
                this.emit("error", err);
            }
        });
        try {
            await this._ready;
        } catch (err) {
            await this._destroy();
            throw err;
        }
    }

    private _request(id: number, command?: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pending.delete(id);
                reject(new Error("BonDriver helper command timed out (10s)"));
            }, 10000);
            this._pending.set(id, { resolve, reject, timer });
            if (command) {
                this._process.stdin.write(command + "\n");
            }
        });
    }

    private _onStderr(data: Buffer): void {
        this._stderr += data.toString("utf8");
        if (this._stderr.length > 65536) {
            this._process.kill();
            return;
        }
        while (this._stderr.includes("\n")) {
            const newline = this._stderr.indexOf("\n");
            const line = this._stderr.slice(0, newline).trim();
            this._stderr = this._stderr.slice(newline + 1);
            const match = /^NYANZ_BON (\d+) (OK|ERR(?: .*)?)$/.exec(line);
            if (!match) {
                this.emit("log", line);
                continue;
            }
            const pending = this._pending.get(Number(match[1]));
            if (pending) {
                this._pending.delete(Number(match[1]));
                clearTimeout(pending.timer);
                if (match[2] === "OK") {
                    pending.resolve();
                } else {
                    pending.reject(new Error(match[2]));
                }
            }
        }
    }

    private _onData(data: Buffer): void {
        this._buffer = this._buffer.length ? Buffer.concat([this._buffer, data]) : data;
        while (this._buffer.length >= 12) {
            const size = this._buffer.readUInt32LE(8);
            if (this._buffer.readUInt32LE(0) !== 0x314e424e || size > 4 * 1024 * 1024 || size === 0) {
                this._process.kill();
                return;
            }
            if (this._buffer.length < 12 + size) {
                return;
            }
            const session = this._buffer.readUInt32LE(4);
            const chunk = this._buffer.subarray(12, 12 + size);
            this._buffer = this._buffer.subarray(12 + size);
            if (session === this._session && session !== 0) {
                this.emit("data", chunk);
            }
        }
    }

    private _destroy(): Promise<void> {
        if (this._destroying) {
            return this._destroying;
        }
        if (!this._process) {
            return Promise.resolve();
        }
        const child = this._process;
        this._destroying = new Promise<void>(resolve => {
            child.once("close", resolve);
            child.kill();
        }).finally(() => this._destroying = null);
        return this._destroying;
    }
}
