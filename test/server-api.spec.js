const { it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

// The process-wide statistics timer is unrelated to API initialization.
const statusPath = require.resolve("../lib/Mirakurun/status");
require.cache[statusPath] = { id: statusPath, filename: statusPath, loaded: true,
    exports: { __esModule: true, default: { epg: {}, rpcCount: 0, streamCount: { tsFilter: 0, decoder: 0 } } } };
const shared = require("../lib/Mirakurun/_").default;
const { Event } = require("../lib/Mirakurun/Event");
const { Server } = require("../lib/Mirakurun/Server");

it("initializes real API paths, serves chunked JSON and docs, and keeps request validation", async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mirakurun-server-api-"));
    const previousPath = process.env.SERVER_CONFIG_PATH;
    process.env.SERVER_CONFIG_PATH = path.join(directory, "config", "server.yml");
    shared.config.server = { port: 0, disableIPv6: true, allowPNA: false, allowOrigins: [],
        allowIPv4CidrRanges: ["127.0.0.1/32"], allowIPv6CidrRanges: [] };
    shared.event = new Event();
    const programs = Array.from({ length: 500 }, (_, id) => ({ id, serviceId: 1, name: "program".repeat(30) }));
    shared.program = { itemMap: new Map(programs.map(program => [program.id, program])) };
    const server = new Server();
    server.testMode = true;
    t.after(async () => {
        await server.deinit();
        if (previousPath === undefined) delete process.env.SERVER_CONFIG_PATH;
        else process.env.SERVER_CONFIG_PATH = previousPath;
        fs.rmSync(directory, { recursive: true, force: true });
    });
    await server.init();
    const port = Array.from(server.servers)[0].address().port;
    const request = resource => new Promise((resolve, reject) => {
        http.get({ host: "127.0.0.1", port, path: resource, agent: false }, res => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", chunk => { body += chunk; });
            res.on("error", reject);
            res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
        }).on("error", reject);
    });
    const docsResponse = await request("/api/docs");
    assert.equal(docsResponse.status, 200);
    const docs = JSON.parse(docsResponse.body);
    assert.equal(docs.info.version, require("../package.json").version);
    assert.ok(docs.paths["/remote/health"]);
    assert.ok(docs.paths["/system/update"]);
    assert.equal(docs["x-express-openapi-disable-response-validation-middleware"], undefined);
    const response = await request("/api/programs");
    assert.equal(response.status, 200);
    assert.equal(response.headers["transfer-encoding"], "chunked");
    assert.deepEqual(JSON.parse(response.body), programs);
    assert.equal((await request("/api/programs?serviceId=bad")).status, 400);
    assert.equal((await request("/")).status, 200);
    assert.equal((await request("/api/debug")).status, 200);
});
