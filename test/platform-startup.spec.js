const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { createUnit } = require("../bin/service.linux");

const root = path.resolve(__dirname, "..");
function init(platform, env) {
    const script = `
        const Module = require("node:module");
        Object.defineProperty(process, "platform", { value: ${JSON.stringify(platform)} });
        for (const key of Object.keys(process.env)) {
            if (/^(MIRAKURUN_|.*_CONFIG_PATH$|.*_DB_PATH$|LOGO_|DOCKER$)/.test(key)) delete process.env[key];
        }
        Object.assign(process.env, ${JSON.stringify(env)});
        const load = Module._load;
        Module._load = function(request, parent, isMain) {
            if (request === "dotenv") return { config() {} };
            if (request === "../lib/server") {
                console.log(JSON.stringify({ env: process.env, cwd: process.cwd() }));
                return {};
            }
            return load.call(this, request, parent, isMain);
        };
        require(${JSON.stringify(path.join(root, "bin", "init.js"))});
    `;
    const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", cwd: path.dirname(root) });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
}

describe("platform startup", () => {
    it("uses repository data on Linux while honoring explicit storage paths", () => {
        const value = init("linux", { SERVER_CONFIG_PATH: "/custom/server.yml" });
        assert.equal(value.cwd, root);
        assert.equal(value.env.MIRAKURUN_PORTABLE, "1");
        assert.equal(value.env.SERVER_CONFIG_PATH, "/custom/server.yml");
        assert.equal(value.env.PROGRAMS_DB_PATH, path.join(root, "data", "db", "programs.json"));
        assert.equal(value.env.LOGO_MAP_PATH, path.join(root, "data", "db", "logo-map.json"));
    });
    it("leaves legacy and Docker storage to server defaults or explicit mounts", () => {
        const legacy = init("linux", { MIRAKURUN_PORTABLE: "0" });
        assert.equal(legacy.env.SERVER_CONFIG_PATH, undefined);
        const docker = init("linux", { DOCKER: "YES", SERVER_CONFIG_PATH: "/app-config/server.yml" });
        assert.equal(docker.env.MIRAKURUN_PORTABLE, undefined);
        assert.equal(docker.env.SERVER_CONFIG_PATH, "/app-config/server.yml");
        assert.equal(docker.env.LOGO_DATA_DIR_PATH, undefined);
    });
    it("preserves the existing Windows portable defaults and override opt-out", () => {
        const value = init("win32", { SERVER_CONFIG_PATH: "custom.yml" });
        assert.equal(value.env.SERVER_CONFIG_PATH, path.join(root, "data", "config", "server.yml"));
        const custom = init("win32", { MIRAKURUN_PORTABLE: "0", SERVER_CONFIG_PATH: "custom.yml" });
        assert.equal(custom.env.SERVER_CONFIG_PATH, "custom.yml");
    });
});

describe("systemd registration", () => {
    it("restarts clean exits and runs node/npm as the specified account", () => {
        const unit = createUnit("/home/nyanz/Mirakurun folder", "/opt/node/bin/node", "nyanz", "/home/nyanz");
        assert.match(unit, /User=nyanz\n/);
        assert.match(unit, /Restart=always\n/);
        assert.match(unit, /KillMode=control-group\n/);
        assert.match(unit, /WorkingDirectory=\/home\/nyanz\/Mirakurun folder\n/);
        assert.match(unit, /ExecStart="\/opt\/node\/bin\/node".*"\/home\/nyanz\/Mirakurun folder\/bin\/init.js"/);
        assert.match(unit, /ExecStart=.* --max-semi-space-size=2 /);
        assert.match(unit, /PATH=\/opt\/node\/bin:/);
        assert.match(unit, /Environment=USING_SYSTEMD=1/);
    });
    it("escapes unit specifiers and rejects privileged users or injected directives", () => {
        assert.match(createUnit("/repo%name", "/bin/node", "nyanz", "/home/nyanz"), /repo%%name/);
        assert.throws(() => createUnit("/repo", "/bin/node", "root", "/root"));
        assert.throws(() => createUnit("/repo\nUser=root", "/bin/node", "nyanz", "/home/nyanz"));
    });
});

describe("Windows service registration", () => {
    it("uses the portable entry point with the memory option when registering winser", () => {
        const fs = require("node:fs");
        const vm = require("node:vm");
        const calls = [];
        const executable = path.join(root, "Node folder", "node.exe");
        vm.runInNewContext(fs.readFileSync(path.join(root, "bin", "service.win32.js"), "utf8"), {
            __dirname: path.join(root, "bin"),
            console: { log() {}, error: assert.fail },
            process: { platform: "win32", execPath: executable, argv: [executable, "service.win32.js", "install"],
                env: {}, exit: assert.fail },
            require(name) {
                if (name === "path") return path;
                if (name === "fs") return { existsSync: () => true };
                if (name === "child_process") return { execFileSync(command, args) {
                    if (command === "sc.exe" || command === "where.exe") throw new Error("not installed");
                    calls.push({ command, args: Array.from(args) });
                } };
                assert.fail(`Unexpected import: ${name}`);
            }
        });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].command, executable);
        const args = calls[0].args;
        assert.equal(args[args.indexOf("--startcmd") + 1],
            `"${executable}" --max-semi-space-size=2 "${path.join(root, "bin", "init.win32.js")}"`);
        assert.ok(args.includes("USING_WINSER=1"));
    });
});
