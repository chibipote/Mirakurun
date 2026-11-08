/* Copyright 2026 nyanz00. Licensed under the Apache License, Version 2.0.
 * http://www.apache.org/licenses/LICENSE-2.0
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const { default: BonDriverDevice } = require("../lib/Mirakurun/BonDriverDevice");
const enabled = process.platform === "win32" && process.env.TEST_BON_NATIVE === "1";

describe("BonDriver native helper (fixture DLL, no hardware)", { skip: !enabled }, () => {
    for (const arch of ["x64", "x86"]) {
        it(`${arch}: reuses helper, releases idle tuner, rejects stale TS and closes on failure`, { timeout: 20000 }, async () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bon-native-"));
            const driver = path.resolve(__dirname, `../lib/native/bon-test-${arch}.dll`);
            process.env.BON_TEST_TRACE = path.join(dir, "trace");
            process.env.BON_TEST_LOCK = path.join(dir, "hardware-lock");
            const device = new BonDriverDevice(driver);
            const second = new BonDriverDevice(driver);
            const errors = [];
            device.on("error", err => errors.push(err));
            second.on("error", () => {});
            const options = channel => ({ driver, space: 0, channel });
            const trace = () => fs.readFileSync(process.env.BON_TEST_TRACE, "utf8").trim().split(/\r?\n/);
            try {
                let data = once(device, "data");
                await device.start(options(24));
                assert.equal((await data)[0][4], 24);
                const pid = device.pid;
                await assert.rejects(second.start(options(25)), /OpenTuner failed/);
                await device.stopStream();
                assert.equal(device.pid, pid, "helper stays resident");
                assert.equal(trace().at(-1), "close", "idle hardware is closed");
                // A second independent helper can acquire the exclusive test device while the first is idle.
                await second.start(options(26));
                await second.stopStream();
                let stoppedData = 0;
                const count = () => ++stoppedData;
                device.on("data", count);
                await new Promise(resolve => setTimeout(resolve, 80));
                assert.equal(stoppedData, 0);
                device.removeListener("data", count);
                const chunks = [];
                const collect = chunk => chunks.push(chunk);
                device.on("data", collect);
                data = once(device, "data");
                await device.start(options(27));
                await data;
                assert.equal(device.pid, pid);
                assert.ok(chunks.length > 0);
                assert.ok(chunks.every(chunk => chunk[4] === 27), "no TS from the previous channel");
                device.removeListener("data", collect);
                await device.stopStream();
                await assert.rejects(device.start(options(999)), /SetChannel failed/);
                assert.equal(device.pid, null);
                assert.equal(trace().filter(line => line === "open").length, trace().filter(line => line === "close").length);
                assert.equal(errors.length, 0);
                data = once(second, "data");
                await second.start(options(28));
                await data;
                await second.close();
                assert.equal(second.pid, null);
            } finally {
                await Promise.allSettled([device.close(), second.close()]);
                delete process.env.BON_TEST_TRACE;
                delete process.env.BON_TEST_LOCK;
                fs.rmSync(dir, { recursive: true, force: true });
            }
        });
    }

    it("terminates a hung driver after the parent is forcibly killed and releases its hardware", { timeout: 10000 }, async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bon-parent-"));
        const driver = path.resolve(__dirname, "../lib/native/bon-test-x64.dll");
        const lock = path.join(dir, "lock");
        const script = `const Bon = require(process.argv[1]).default;
            const b = new Bon(process.argv[2]); b.on('error', () => {});
            b.start({driver:process.argv[2], space:0, channel:997}).catch(() => {});
            const poll = setInterval(() => { if(b.pid) { process.send(b.pid); clearInterval(poll); } }, 10);`;
        const parent = spawn(process.execPath, ["-e", script, require.resolve("../lib/Mirakurun/BonDriverDevice"), driver],
            { env: { ...process.env, BON_TEST_LOCK: lock }, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
        const probe = new BonDriverDevice(driver);
        probe.on("error", () => {});
        try {
            await once(parent, "message");
            // Wait until the native fixture owns the exclusive hardware handle, before killing Node.
            const deadline = Date.now() + 4000;
            while (!fs.existsSync(lock)) {
                assert.ok(Date.now() < deadline, "test driver has not opened");
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            const closed = once(parent, "close");
            parent.kill("SIGKILL");
            await closed;
            process.env.BON_TEST_LOCK = lock;
            await probe.start({ driver, space: 0, channel: 24 });
            await probe.stopStream();
        } finally {
            parent.kill();
            await probe.close();
            delete process.env.BON_TEST_LOCK;
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("TunerDevice: shares a channel, respects priority, closes after the final user and reuses helper", { timeout: 20000 }, async () => {
        const statusPath = require.resolve("../lib/Mirakurun/status");
        require.cache[statusPath] = { id: statusPath, filename: statusPath, loaded: true,
            exports: { __esModule: true, default: { epg: {}, streamCount: {}, errorCount: { tunerDeviceRespawn: 0 } } } };
        const _ = require("../lib/Mirakurun/_").default;
        _.event = { emit: () => true };
        const log = require("../lib/Mirakurun/log");
        for (const level of ["debug", "info", "warn", "error", "fatal"]) log[level] = () => {};
        const TunerDevice = require("../lib/Mirakurun/TunerDevice").default;
        const driver = path.resolve(__dirname, "../lib/native/bon-test-x64.dll");
        const device = new TunerDevice(1, { name: "fixture", types: ["GR", "GR-ALT"],
            command: `BonRecTest.exe --driver "${driver}" --space <space> --channel <channel> --output -`, enableBonDriverHelper: true });
        const channel = (n, type = "GR") => ({ type, channel: String(n), commandVars: { space: 0 } });
        const output = () => {
            const stream = new EventEmitter();
            stream.closed = false;
            stream.chunks = [];
            stream.write = chunk => { stream.chunks.push(chunk); stream.emit("data", chunk); };
            stream.flush = () => {};
            stream.end = () => {
                if (!stream.closed) { stream.closed = true; stream.emit("close"); }
            };
            return stream;
        };
        const a = { id: "recording-a", priority: 1 };
        const b = { id: "recording-b", priority: 1 };
        const c = { id: "recording-c", priority: 2 };
        const outA = output(), outB = output(), outC = output();
        try {
            let data = once(outA, "data");
            await device.startStream(a, outA, channel(24));
            await data;
            const pid = device.pid;
            data = once(outB, "data");
            await device.startStream(b, outB, channel(24));
            await data;
            assert.equal(device.pid, pid);
            assert.equal(device.users.length, 2);
            await assert.rejects(device.startStream({ id: "epg", priority: -1 }, output(), channel(25)), /higher priority/);
            data = once(outC, "data");
            await device.startStream(c, outC, channel(26, "GR-ALT"));
            await data;
            assert.ok(outA.closed && outB.closed);
            assert.equal(device.pid, pid, "preemption reuses the same helper process");
            assert.ok(outC.chunks.every(chunk => chunk[4] === 26));
            const release = once(device, "release");
            device.endStream(c);
            await release;
            assert.equal(device.isFree, true);
            assert.equal(device.pid, null, "idle tuner API hides the resident helper pid");
            assert.equal(device._bon.pid, pid);
            assert.equal(device.command, null);
            // End the stream synchronously during tuning to cover cancellation / close event recursion.
            const d = { id: "cancelled", priority: 0 };
            const outD = output();
            const started = device.startStream(d, outD, channel(27));
            const cancelled = once(device, "release");
            outD.end();
            await started;
            await cancelled;
            assert.equal(device.isFree, true);
            assert.equal(device.users.length, 0);
        } finally {
            if (device._bonActive) await device.kill();
            await device._bon?.close();
        }
    });
});
