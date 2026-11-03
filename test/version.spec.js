const { describe, it, before, after } = require("node:test");
const assert = require("assert");
const https = require("https");
const { EventEmitter } = require("events");
// nyanz 版では npm の子プロセスではなく HTTPS を使用する。
const originalRequest = https.request;
let calls = 0;
let next = () => Promise.resolve({ stdout: "9.9.9\n", stderr: "" });
https.request = (url, options, callback) => {
  assert.strictEqual(url, "https://registry.npmjs.org/mirakurun/latest");
  calls++;
  const request = new EventEmitter();
  request.end = () => {
    next().then(value => {
      const response = new EventEmitter();
      response.statusCode = 200;
      callback(response);
      response.emit("data", Buffer.from(JSON.stringify({version: value.stdout.trim()})));
      response.emit("end");
    }, error => request.emit("error", error));
  };
  return request;
};

let system;

describe("[version.spec] system.ts: getLatestVersion()", () => {
  before(() => {
    system = require("../lib/Mirakurun/system");
  });
  after(() => { https.request = originalRequest; });

  it("does not cache a failure", async () => {
    next = () => Promise.reject(new Error("network"));
    await assert.rejects(system.getLatestVersion(), /network/);
    assert.strictEqual(calls, 1);

    next = () => Promise.resolve({ stdout: "9.9.9\n", stderr: "" });
    assert.strictEqual(await system.getLatestVersion(), "9.9.9");
    assert.strictEqual(calls, 2);
  });

  it("reuses the HTTPS result for subsequent calls", async () => {
    const results = await Promise.all([system.getLatestVersion(), system.getLatestVersion()]);
    assert.deepStrictEqual(results, ["9.9.9", "9.9.9"]);
    assert.strictEqual(await system.getLatestVersion(), "9.9.9");
    assert.strictEqual(calls, 2);
  });

  it("refreshes after ten minutes and shares an in-flight HTTPS request", async t => {
    const now = Date.now() + 600001;
    t.mock.method(Date, "now", () => now);
    let release;
    next = () => new Promise(resolve => { release = resolve; });
    const first = system.getLatestVersion();
    const second = system.getLatestVersion();
    assert.strictEqual(first, second);
    assert.strictEqual(calls, 3);
    release({ stdout: "9.9.10\n" });
    assert.deepStrictEqual(await Promise.all([first, second]), ["9.9.10", "9.9.10"]);
    assert.strictEqual(await system.getLatestVersion(), "9.9.10");
    assert.strictEqual(calls, 3);
  });
});
