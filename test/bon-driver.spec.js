/* Copyright 2026 nyanz00. Licensed under the Apache License, Version 2.0.
 * http://www.apache.org/licenses/LICENSE-2.0
 */
const { describe, it, before, after } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHash } = require("crypto");

const {
  parseBonRecTestCommand,
  getBonDriverArchitecture,
  prepareBonDriverHelper,
  default: BonDriverDevice
} = require("../lib/Mirakurun/BonDriverDevice");

let dir;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mirakurun-bon-driver-"));
});

describe("[bon-driver.spec] bundled BonDriver helpers", () => {
  const sha256 = binary => createHash("sha256").update(binary).digest("hex");

  it("ships x86/x64 executables matching the manifest and current native sources", () => {
    const root = path.resolve(__dirname, "..");
    const bundleDir = path.join(root, "bin/native");
    const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, "bon-helper-build.json"), "utf8"));
    const { getSourceHash } = require("../bin/build-bon-helper.win32");
    assert.strictEqual(manifest.sourceHash, getSourceHash(root), "native sources changed: rebuild and commit both EXEs and their manifest");
    for (const arch of ["x64", "x86"]) {
      const exe = path.join(bundleDir, `bon-helper-${arch}.exe`);
      assert.strictEqual(sha256(fs.readFileSync(exe)), manifest.sha256[arch]);
      assert.strictEqual(getBonDriverArchitecture(exe), arch);
    }
  });

  it("repairs the runtime cache and gives a changed bundled EXE a different cache path", () => {
    const root = path.join(dir, "cache-project");
    const bundleDir = path.join(root, "bin/native");
    fs.mkdirSync(bundleDir, { recursive: true });
    const exe = path.join(bundleDir, "bon-helper-x64.exe");
    const manifest = path.join(bundleDir, "bon-helper-build.json");
    const first = Buffer.from("first bundled executable");
    fs.writeFileSync(exe, first);
    fs.writeFileSync(manifest, JSON.stringify({ sha256: { x64: sha256(first) } }));
    const cached = prepareBonDriverHelper("x64", root);
    assert.notStrictEqual(cached, exe);
    assert.deepStrictEqual(fs.readFileSync(cached), first);
    fs.writeFileSync(cached, "corrupted cache");
    assert.strictEqual(prepareBonDriverHelper("x64", root), cached);
    assert.deepStrictEqual(fs.readFileSync(cached), first);
    fs.unlinkSync(cached);
    assert.strictEqual(prepareBonDriverHelper("x64", root), cached);
    const next = Buffer.from("updated bundled executable");
    fs.writeFileSync(exe, next);
    assert.throws(() => prepareBonDriverHelper("x64", root), /checksum mismatch/);
    fs.writeFileSync(manifest, JSON.stringify({ sha256: { x64: sha256(next) } }));
    const newCached = prepareBonDriverHelper("x64", root);
    assert.notStrictEqual(newCached, cached);
    assert.deepStrictEqual(fs.readFileSync(cached), first);
    assert.deepStrictEqual(fs.readFileSync(newCached), next);
  });

  it("rejects a missing or malformed bundled manifest", () => {
    const root = path.join(dir, "bad-bundle");
    assert.throws(() => prepareBonDriverHelper("x64", root), /manifest is missing or invalid/);
    const bundleDir = path.join(root, "bin/native");
    fs.mkdirSync(bundleDir, { recursive: true });
    fs.writeFileSync(path.join(bundleDir, "bon-helper-build.json"), JSON.stringify({ sha256: { x64: "../../other" } }));
    assert.throws(() => prepareBonDriverHelper("x64", root), /hash is invalid/);
  });
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeFakePe(name, machine, { dosSignature = 0x5A4D, peSignature = 0x4550 } = {}) {
  const file = path.join(dir, name);
  const data = Buffer.alloc(0x86);
  data.writeUInt16LE(dosSignature, 0);
  data.writeUInt32LE(0x80, 0x3C);
  data.writeUInt32LE(peSignature, 0x80);
  data.writeUInt16LE(machine, 0x84);
  fs.writeFileSync(file, data);
  return file;
}

function bonRecCommand(args) {
  return "BonRecTest.exe --driver \"C:\\Program Files\\BonDriver\\BonDriver.dll\" --output - " + args;
}

function frame(session, payload) {
  const data = Buffer.alloc(12 + payload.length);
  data.writeUInt32LE(0x314E424E, 0);
  data.writeUInt32LE(session, 4);
  data.writeUInt32LE(payload.length, 8);
  payload.copy(data, 12);
  return data;
}

describe("[bon-driver.spec] BonDriverDevice.ts: parseBonRecTestCommand()", () => {
  it("parses a quoted Windows executable and driver path and defaults space to zero", () => {
    const driver = "C:\\Program Files\\BonDriver\\BonDriver_BS.dll";
    const options = parseBonRecTestCommand(
      "\"C:\\Program Files\\BonRecTest.EXE\" --driver \"" + driver + "\" --channel 101 --output -"
    );

    assert.deepStrictEqual(options, {
      driver: path.resolve(driver),
      space: 0,
      channel: 101
    });
  });

  it("accepts a Windows executable basename and the uint32 upper bound", () => {
    const options = parseBonRecTestCommand(
      "C:\\tools\\BonRecTest.exe --driver \"C:\\BonDriver.dll\" --space 4294967295 --channel 4294967295 --output -"
    );

    assert.deepStrictEqual(options, {
      driver: path.resolve("C:\\BonDriver.dll"),
      space: 0xFFFFFFFF,
      channel: 0xFFFFFFFF
    });
  });

  it("rejects commands for another executable", () => {
    assert.throws(
      () => parseBonRecTestCommand("OtherRecTest.exe --driver BonDriver.dll --channel 1 --output -"),
      /requires a BonRecTest command/
    );
  });

  it("rejects unsupported options instead of ignoring them", () => {
    assert.throws(
      () => parseBonRecTestCommand(bonRecCommand("--channel 101 --verbose yes")),
      /Unsupported BonDriver helper argument: --verbose/
    );
  });

  it("rejects values outside the unsigned 32-bit range", () => {
    assert.throws(
      () => parseBonRecTestCommand(bonRecCommand("--channel 4294967296")),
      /unsigned integer --channel/
    );
    assert.throws(
      () => parseBonRecTestCommand(bonRecCommand("--space -1 --channel 1")),
      /unsigned integer --space/
    );
    assert.throws(
      () => parseBonRecTestCommand(bonRecCommand("--space 1.5 --channel 1")),
      /unsigned integer --space/
    );
  });
});

describe("[bon-driver.spec] BonDriverDevice.ts: getBonDriverArchitecture()", () => {
  it("reads x86 and x64 machine types from minimal PE headers", () => {
    assert.strictEqual(getBonDriverArchitecture(writeFakePe("x86.dll", 0x014C)), "x86");
    assert.strictEqual(getBonDriverArchitecture(writeFakePe("x64.dll", 0x8664)), "x64");
  });

  it("rejects invalid DOS and PE signatures and unsupported machine types", () => {
    assert.throws(
      () => getBonDriverArchitecture(writeFakePe("bad-dos.dll", 0x014C, { dosSignature: 0 })),
      /Invalid BonDriver DLL header/
    );
    assert.throws(
      () => getBonDriverArchitecture(writeFakePe("bad-pe.dll", 0x014C, { peSignature: 0 })),
      /Invalid BonDriver PE header/
    );
    assert.throws(
      () => getBonDriverArchitecture(writeFakePe("arm64.dll", 0xAA64)),
      /supports x86 \/ x64 DLLs only/
    );
  });
});

describe("[bon-driver.spec] BonDriverDevice.ts: _onData()", () => {
  it("reassembles split frames and discards data from an obsolete session", () => {
    const device = new BonDriverDevice("unused.dll");
    let kills = 0;
    device._process = { kill: () => ++kills };
    device._session = 7;
    const received = [];
    device.on("data", chunk => received.push(Buffer.from(chunk)));

    const stale = frame(6, Buffer.from("stale"));
    const current = frame(7, Buffer.from("current"));
    const data = Buffer.concat([stale, current]);
    const currentFrameOffset = stale.length;
    const firstCut = currentFrameOffset + 5;
    const secondCut = currentFrameOffset + 12 + 3;

    device._onData(data.subarray(0, firstCut));
    device._onData(data.subarray(firstCut, secondCut));
    device._onData(data.subarray(secondCut));

    assert.deepStrictEqual(received, [Buffer.from("current")]);
    assert.strictEqual(kills, 0);
  });
});
