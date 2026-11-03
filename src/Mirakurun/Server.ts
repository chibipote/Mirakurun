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
import * as path from "path";
import * as fs from "fs";
import * as http from "http";
import { promisify } from "util";
import express from "express";
import cors from "cors";
import * as openapi from "express-openapi";
import morgan from "morgan";
import * as yaml from "js-yaml";
import { OpenAPIV2 } from "openapi-types";
import RPCServer from "jsonrpc2-ws/lib/server";
import { sleep } from "./common";
import * as log from "./log";
import * as system from "./system";
import regexp from "./regexp";
import _ from "./_";
import { createRPCServer, initRPCNotifier } from "./rpc";
import remoteManager from "./remote/RemoteManager";

const pkg = require("../../package.json");
const fsRoutesModule = require("fs-routes");
const fsRoutes = fsRoutesModule.default || fsRoutesModule;

function getOpenAPIPathSpecs() {
    return fsRoutes("./lib/Mirakurun/api").map(route => ({
        path: route.route.replace(/\\/g, "/"),
        module: require(route.path)
    }));
}

const DISABLE_RESPONSE_VALIDATION = "x-express-openapi-disable-response-validation-middleware";

export class Server {
    /** used for test */
    testMode = false;

    private _isRunning = false;
    private _servers = new Set<http.Server>();
    private _rpcs = new Set<RPCServer>();
    private _tailscaleTimer?: NodeJS.Timeout;
    private _tailscaleCheck?: Promise<void>;

    get isRunning() {
        return this._isRunning;
    }

    get servers() {
        return this._servers;
    }

    async init() {
        if (this._isRunning === true) {
            throw new Error("Server is running");
        }
        this._isRunning = true;

        const serverConfig = _.config.server;
        const waitForTailscale = serverConfig.waitForTailscale === true && !this.testMode && typeof serverConfig.port === "number";

        const addresses: string[] = [];

        if (serverConfig.path) {
            addresses.push(process.platform === "win32" ? serverConfig.path : path.resolve(serverConfig.path));
        }

        if (typeof serverConfig.port === "number") {
            if (!this.testMode) {
                while (true) {
                    try {
                        const systemIPv4s = system.getIPv4AddressesForListen(waitForTailscale);
                        if (systemIPv4s.length > 0 || waitForTailscale) {
                            addresses.push(...systemIPv4s);
                            break;
                        }
                    } catch (e) {
                        console.error(e);
                    }
                    log.warn("Server hasn't detected IPv4 addresses...");
                    await sleep(5000);
                }
            }

            addresses.push("127.0.0.1");

            if (serverConfig.disableIPv6 !== true) {
                if (!this.testMode) {
                    addresses.push(...system.getIPv6AddressesForListen());
                }

                addresses.push("::1");
            }
        }

        const app = express();

        app.disable("x-powered-by");
        app.disable("etag");

        app.use((req: express.Request, res: express.Response, next) => {
            req.url = req.url.replace(/\\/g, "/");
            next();
        });

        app.use(morgan(":remote-addr :remote-user :method :url HTTP/:http-version :status :res[content-length] - :response-time ms :user-agent", {
            stream: log.event as any
        }));
        app.use(express.urlencoded({ extended: false }));
        app.use(express.json());

        app.use((req: express.Request, res: express.Response, next) => {
            if (req.ip && system.isPermittedIPAddress(req.ip) === false) {
                req.socket.end();
                return;
            }

            const origin = req.get("Origin");
            if (origin !== undefined) {
                if (!system.isPermittedHost(origin, serverConfig.hostname) && !serverConfig.allowOrigins.includes(origin)) {
                    res.status(403).end();
                    return;
                }
            }

            const referer = req.get("Referer");
            if (referer !== undefined) {
                if (!system.isPermittedHost(referer, serverConfig.hostname) && serverConfig.allowOrigins.every(o => !referer.startsWith(o))) {
                    res.status(403).end();
                    return;
                }
            }

            if (serverConfig.allowPNA && req.get("Access-Control-Request-Method") && req.get("Access-Control-Request-Private-Network") === "true") {
                res.set({
                    "Access-Control-Allow-Private-Network": "true",
                    "Private-Network-Access-Name": `Mirakurun_${serverConfig.hostname}`,
                    "Private-Network-Access-ID": "00:00:00:00:00"
                });
            }

            res.set({
                "Cross-Origin-Resource-Policy": "cross-origin",
                "Cross-Origin-Embedder-Policy": "require-corp",
                "Server": "Mirakurun/" + pkg.version,
                "X-Content-Type-Options": "nosniff",
                "X-Your-IP": req.ip
            });

            next();
        });

        // do not place before the access control
        app.use(cors());

        if (!serverConfig.disableWebUI) {
            // API のリクエストでは lib/ui のファイルを探さない
            const serveUI = express.static("lib/ui");
            app.use((req, res, next) => {
                if (req.path === "/api" || req.path.startsWith("/api/")) {
                    next();
                    return;
                }
                serveUI(req, res, next);
            });
            app.use("/redoc", express.static("node_modules/redoc/bundles"));
            app.use("/redoc-try", express.static("node_modules/redoc-try/dist"));
            app.use("/api/debug", express.static("lib/ui/redoc-ui.html"));

            const indexPath = path.join(__dirname, "..", "ui", "index.html");
            app.get(/^\/(?!(api|assets|redoc))/, (request, response) => {
                response.sendFile(indexPath);
            });
        }

        const api = yaml.load(fs.readFileSync("api.yml", "utf8")) as OpenAPIV2.Document;
        api.info.version = pkg.version;

        // 応答の検証 (res.validateResponse) は使っていないため、検証器を組み立てない
        api[DISABLE_RESPONSE_VALIDATION] = true;

        const framework = openapi.initialize({
            app: app,
            apiDoc: api,
            docsPath: "/docs",
            paths: getOpenAPIPathSpecs()
        });

        // 公開する API 定義 (/api/docs) は従来のままにする
        delete framework.apiDoc[DISABLE_RESPONSE_VALIDATION];
        // API 定義の検証器は初期化の後に使わないため、常駐させない
        (framework as unknown as { validator: unknown }).validator = null;

        app.use((err, req, res: express.Response, next) => {
            if (err.message === "Not allowed by CORS") {
                res.status(403).end();
                return;
            }

            log.error(JSON.stringify(err, null, "  "));
            console.error(err.stack);

            if (res.headersSent === false) {
                res.writeHead(err.status || 500, {
                    "Content-Type": "application/json"
                });
            }

            res.end(JSON.stringify({
                code: res.statusCode,
                reason: err.message || res.statusMessage,
                errors: err.errors
            }));

            next();
        });

        if (!this._isRunning) {
            return;
        }

        for (const address of addresses) {
            const server = http.createServer(app);
            server.timeout = 1000 * 15; // 15 sec.

            this._servers.add(server);
            this._rpcs.add(createRPCServer(server));

            if (regexp.unixDomainSocket.test(address) || regexp.windowsNamedPipe.test(address)) {
                if (fs.existsSync(address)) {
                    fs.unlinkSync(address);
                }

                await new Promise<void>(resolve => {
                    server.listen(address, () => {
                        if (regexp.windowsNamedPipe.test(address)) {
                            log.info("listening on http+pipe://%s", address);
                        } else {
                            log.info("listening on http+unix://%s", address.replace(/\//g, "%2F"));
                        }
                        resolve();
                    });
                });

                if (regexp.unixDomainSocket.test(address)) {
                    fs.chmodSync(address, "777");
                }
            } else {
                await new Promise<void>(resolve => {
                    server.listen(serverConfig.port, address, () => {
                        const serverAddr = server.address();
                        const port = typeof serverAddr === "string" ? serverConfig.port : serverAddr.port;
                        if (address.includes(":")) {
                            const [addr, iface] = address.split("%");
                            log.info("listening on http://[%s]:%d (%s)", addr, port, iface);
                        } else {
                            log.info("listening on http://%s:%d", address, port);
                        }
                        resolve();
                    });
                });
            }
        }

        // event notifications for RPC
        initRPCNotifier(this._rpcs);

        log.info("RPC interface is enabled");
        remoteManager.start();
        if (waitForTailscale && this._isRunning) {
            this._startTailscaleCheck(app, serverConfig.port);
            await this._tailscaleCheck;
        }
    }

    async deinit() {
        if (this._isRunning === false) {
            return;
        }

        this._isRunning = false;
        clearTimeout(this._tailscaleTimer);
        await remoteManager.stop();
        this._tailscaleTimer = undefined;
        await this._tailscaleCheck;
        this._tailscaleCheck = undefined;

        for (const rpc of this._rpcs) {
            await rpc.close();
        }

        for (const server of this._servers) {
            const serverCloseAsync = promisify(server.close).bind(server);
            await serverCloseAsync();
        }

        this._rpcs.clear();
        this._servers.clear();

        this._isRunning = false;
    }

    private _startTailscaleCheck(app: express.Express, port: number) {
        this._tailscaleCheck = this._checkTailscale(app, port);
    }

    private async _checkTailscale(app: express.Express, port: number) {
        let listening = false;
        try {
            for (const address of system.getTailscaleIPv4AddressesForListen()) {
                if (!this._isRunning) {
                    return;
                }
                if ([...this._servers].some(server => {
                    const bound = server.address();
                    return bound && typeof bound !== "string" && bound.address === address;
                })) {
                    listening = true;
                    break;
                }
                const server = http.createServer(app);
                server.timeout = 1000 * 15;
                try {
                    await new Promise<void>((resolve, reject) => {
                        server.once("error", reject);
                        server.listen(port, address, () => {
                            server.removeListener("error", reject);
                            resolve();
                        });
                    });
                    this._servers.add(server);
                    this._rpcs.add(createRPCServer(server));
                    listening = true;
                    log.info("Tailscale listening on http://%s:%d; startup checks stopped", address, port);
                    break;
                } catch (error) {
                    this._servers.delete(server);
                    if (server.listening) {
                        await new Promise<void>(resolve => server.close(() => resolve()));
                    }
                    log.warn("Tailscale listen failed on %s:%d; retrying in 30 seconds: %s", address, port, error);
                }
            }
        } catch (error) {
            log.warn("Tailscale interface check failed; retrying in 30 seconds: %s", error);
        } finally {
            if (this._isRunning && !listening) {
                this._tailscaleTimer = setTimeout(() => {
                    this._tailscaleTimer = undefined;
                    this._startTailscaleCheck(app, port);
                }, 30000);
                this._tailscaleTimer.unref();
            }
        }
    }
}

export default Server;
