const http = require("http");
const crypto = require("crypto");
const {
    fetchProduction,
    getKkwDetails,
    getMesOverview,
    getProductionConfig,
    getProductionOverview,
    getProductionRiskReport,
    listKkws,
    searchProduction,
} = require("./lib/production-vendo");

const SERVER_NAME = "vendo-production-mcp";
const SERVER_VERSION = "0.1.0";
const DEFAULT_PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_HOST = process.env.MCP_HOST || "127.0.0.1";
const DEFAULT_PORT = Number(process.env.MCP_PORT || 3020);
const AUTH_DISABLED = process.argv.includes("--no-auth")
    || String(process.env.MCP_AUTH || "").trim().toLowerCase() === "none";
const BEARER_TOKEN = AUTH_DISABLED ? "" : (process.env.MCP_BEARER_TOKEN || "");

const sessions = new Map();

const jsonObjectSchema = {
    type: "object",
    additionalProperties: true,
};

const tools = [
    {
        name: "search",
        description: "Search only production data: active production, KKW, orders, costs, MES oven status, risks and production issues.",
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Natural-language query or KKW/order/product text to search in production data.",
                },
                limit: {
                    type: "integer",
                    minimum: 1,
                    maximum: 25,
                    description: "Maximum number of results.",
                },
            },
            required: ["query"],
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            properties: {
                results: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            id: { type: "string" },
                            title: { type: "string" },
                            url: { type: "string" },
                            metadata: jsonObjectSchema,
                        },
                        required: ["id", "title", "url"],
                        additionalProperties: true,
                    },
                },
            },
            required: ["results"],
            additionalProperties: false,
        },
        annotations: {
            readOnlyHint: true,
        },
    },
    {
        name: "fetch",
        description: "Fetch one production result returned by search. Supports KKW details, active production, risk report and MES oven status.",
        inputSchema: {
            type: "object",
            properties: {
                id: {
                    type: "string",
                    description: "Result id returned by search, for example risk:production, overview:active, mes:summary:reflow_1 or kkw:150%2F26.",
                },
            },
            required: ["id"],
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            properties: {
                id: { type: "string" },
                title: { type: "string" },
                url: { type: "string" },
                text: { type: "string" },
                metadata: jsonObjectSchema,
            },
            required: ["id", "title", "url", "text"],
            additionalProperties: true,
        },
        annotations: {
            readOnlyHint: true,
        },
    },
    {
        name: "production_risk_report",
        description: "Build a read-only risk report for production: low efficiency, missing norms, MES stoppages, unassigned oven pulses and quantity anomalies.",
        inputSchema: {
            type: "object",
            properties: {
                deviceId: {
                    type: "string",
                    description: "MES device id, default reflow_1.",
                },
                limit: {
                    type: "integer",
                    minimum: 1,
                    maximum: 100,
                    description: "Maximum active production rows to inspect.",
                },
            },
            additionalProperties: false,
        },
        annotations: {
            readOnlyHint: true,
        },
    },
    {
        name: "production_overview",
        description: "Show active production from Vendo: active operators, stations, KKW, operations, current progress and basic efficiency metrics.",
        inputSchema: {
            type: "object",
            properties: {
                operatorName: {
                    type: "string",
                    description: "Optional operator name filter.",
                },
                limit: {
                    type: "integer",
                    minimum: 1,
                    maximum: 100,
                    description: "Maximum active production rows.",
                },
                includeOperations: {
                    type: "boolean",
                    description: "Whether to fetch operation norms for efficiency metrics.",
                },
            },
            additionalProperties: false,
        },
        annotations: {
            readOnlyHint: true,
        },
    },
    {
        name: "kkw_list",
        description: "List/search production KKW records from Vendo. Use for finding KKW by number, product, production order, customer or due date context.",
        inputSchema: {
            type: "object",
            properties: {
                search: {
                    type: "string",
                    description: "Search text, e.g. KKW number, product code/name, production order or customer.",
                },
                page: {
                    type: "integer",
                    minimum: 0,
                    description: "Zero-based page index.",
                },
                limit: {
                    type: "integer",
                    minimum: 1,
                    maximum: 100,
                    description: "Page size.",
                },
            },
            additionalProperties: false,
        },
        annotations: {
            readOnlyHint: true,
        },
    },
    {
        name: "kkw_details",
        description: "Get production and cost details for a single KKW: quantities, operations, labor, materials, order cost summary and detected risks.",
        inputSchema: {
            type: "object",
            properties: {
                kkwNumber: {
                    type: "string",
                    description: "KKW number, for example 150/26.",
                },
                includeRaw: {
                    type: "boolean",
                    description: "Include selected raw Vendo records for debugging. Default false.",
                },
            },
            required: ["kkwNumber"],
            additionalProperties: false,
        },
        annotations: {
            readOnlyHint: true,
        },
    },
    {
        name: "mes_oven_summary",
        description: "Read MES oven/reflow summary from local SQLite: active batch, pulse counts, takt, flow status, oven speed and pending assignments.",
        inputSchema: {
            type: "object",
            properties: {
                deviceId: {
                    type: "string",
                    description: "MES device id, default reflow_1.",
                },
            },
            additionalProperties: false,
        },
        annotations: {
            readOnlyHint: true,
        },
    },
    {
        name: "mes_oven_batches",
        description: "List recent MES oven/reflow batches from local SQLite by device id or KKW number.",
        inputSchema: {
            type: "object",
            properties: {
                deviceId: {
                    type: "string",
                    description: "Optional MES device id.",
                },
                kkwNumber: {
                    type: "string",
                    description: "Optional KKW number filter.",
                },
                limit: {
                    type: "integer",
                    minimum: 1,
                    maximum: 200,
                    description: "Maximum number of batches.",
                },
            },
            additionalProperties: false,
        },
        annotations: {
            readOnlyHint: true,
        },
    },
    {
        name: "mes_oven_events",
        description: "List recent MES oven/reflow pulse events from local SQLite.",
        inputSchema: {
            type: "object",
            properties: {
                deviceId: {
                    type: "string",
                    description: "Optional MES device id.",
                },
                batchId: {
                    type: "integer",
                    minimum: 1,
                    description: "Optional MES batch id.",
                },
                unassigned: {
                    type: "boolean",
                    description: "Only events without batch assignment.",
                },
                limit: {
                    type: "integer",
                    minimum: 1,
                    maximum: 500,
                    description: "Maximum number of events.",
                },
            },
            additionalProperties: false,
        },
        annotations: {
            readOnlyHint: true,
        },
    },
];

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeArgs(args) {
    return isObject(args) ? args : {};
}

function jsonResult(data) {
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(data, null, 2),
            },
        ],
        structuredContent: data,
    };
}

function toolErrorResult(error) {
    return {
        isError: true,
        content: [
            {
                type: "text",
                text: error?.message || String(error || "Tool error"),
            },
        ],
    };
}

function getMesConfig() {
    return getProductionConfig();
}

async function executeTool(name, args) {
    const input = normalizeArgs(args);

    try {
        if (name === "search") {
            return jsonResult(await searchProduction(input));
        }

        if (name === "fetch") {
            return jsonResult(await fetchProduction(input.id));
        }

        if (name === "production_risk_report") {
            return jsonResult(await getProductionRiskReport(input));
        }

        if (name === "production_overview") {
            return jsonResult(await getProductionOverview(input));
        }

        if (name === "kkw_list") {
            return jsonResult(await listKkws(input));
        }

        if (name === "kkw_details") {
            return jsonResult(await getKkwDetails(input));
        }

        if (name === "mes_oven_summary") {
            const overview = getMesOverview({
                deviceId: input.deviceId || "reflow_1",
                eventsLimit: 0,
                batchesLimit: 0,
            });
            return jsonResult({
                storage: overview.storage,
                summary: overview.summary,
            });
        }

        if (name === "mes_oven_batches") {
            const config = getMesConfig();
            const { listOvenBatches } = require("./lib/mes-sqlite");
            return jsonResult({
                storage: {
                    dbPath: config.mesDbPath,
                },
                batches: listOvenBatches(config.mesDbPath, input),
            });
        }

        if (name === "mes_oven_events") {
            const config = getMesConfig();
            const { listOvenPulses } = require("./lib/mes-sqlite");
            return jsonResult({
                storage: {
                    dbPath: config.mesDbPath,
                },
                events: listOvenPulses(config.mesDbPath, input),
            });
        }

        throw new Error(`Unknown tool: ${name}`);
    } catch (error) {
        return toolErrorResult(error);
    }
}

function rpcError(id, code, message, data) {
    const error = { code, message };
    if (data !== undefined) {
        error.data = data;
    }
    return {
        jsonrpc: "2.0",
        id,
        error,
    };
}

function rpcResult(id, result) {
    return {
        jsonrpc: "2.0",
        id,
        result,
    };
}

async function handleRpcMessage(message) {
    if (!isObject(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
        return rpcError(message?.id ?? null, -32600, "Invalid Request");
    }

    const id = message.id;
    const isNotification = id === undefined || id === null;

    try {
        switch (message.method) {
            case "initialize": {
                const requestedVersion = message.params?.protocolVersion || DEFAULT_PROTOCOL_VERSION;
                return rpcResult(id, {
                    protocolVersion: requestedVersion,
                    capabilities: {
                        tools: {
                            listChanged: false,
                        },
                        resources: {
                            subscribe: false,
                            listChanged: false,
                        },
                        prompts: {
                            listChanged: false,
                        },
                    },
                    serverInfo: {
                        name: SERVER_NAME,
                        version: SERVER_VERSION,
                    },
                    instructions: [
                        "Read-only production MCP for Vendo/MES.",
                        "Scope is limited to production data: KKW, production orders, active production, efficiency, risks, problems and MES oven data.",
                        "No sales, admin, inventory browsing or write operations are exposed.",
                    ].join(" "),
                });
            }

            case "notifications/initialized":
            case "notifications/cancelled":
                return null;

            case "ping":
                return isNotification ? null : rpcResult(id, {});

            case "tools/list":
                return rpcResult(id, { tools });

            case "tools/call": {
                const name = message.params?.name;
                if (!name) {
                    return rpcError(id, -32602, "Missing tool name");
                }
                const result = await executeTool(name, message.params?.arguments || {});
                return rpcResult(id, result);
            }

            case "resources/list":
                return rpcResult(id, { resources: [] });

            case "prompts/list":
                return rpcResult(id, { prompts: [] });

            default:
                return rpcError(id, -32601, `Method not found: ${message.method}`);
        }
    } catch (error) {
        return isNotification ? null : rpcError(id, -32603, error?.message || "Internal error");
    }
}

async function handleRpcPayload(payload) {
    if (Array.isArray(payload)) {
        const responses = [];
        for (const message of payload) {
            const response = await handleRpcMessage(message);
            if (response) {
                responses.push(response);
            }
        }
        return responses.length ? responses : null;
    }

    return handleRpcMessage(payload);
}

function isAuthorized(req) {
    if (!BEARER_TOKEN) {
        return true;
    }

    const header = String(req.headers.authorization || "");
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    return crypto.timingSafeEqual(
        Buffer.from(token),
        Buffer.from(BEARER_TOKEN)
    );
}

function safeIsAuthorized(req) {
    try {
        return isAuthorized(req);
    } catch {
        return false;
    }
}

function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}

function sendJson(res, statusCode, payload, headers = {}) {
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        ...headers,
    });
    res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text, headers = {}) {
    res.writeHead(statusCode, {
        "Content-Type": "text/plain; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        ...headers,
    });
    res.end(text);
}

function sendSseEvent(res, event, data) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
}

function startSse(req, res) {
    if (!safeIsAuthorized(req)) {
        sendText(res, 401, "Unauthorized");
        return;
    }

    const sessionId = crypto.randomUUID();
    res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "X-Accel-Buffering": "no",
    });

    sessions.set(sessionId, {
        res,
        createdAt: Date.now(),
    });

    const endpoint = `/message?sessionId=${encodeURIComponent(sessionId)}`;
    sendSseEvent(res, "endpoint", endpoint);

    const keepAlive = setInterval(() => {
        try {
            res.write(": keepalive\n\n");
        } catch {
            clearInterval(keepAlive);
        }
    }, 15000);

    req.on("close", () => {
        clearInterval(keepAlive);
        sessions.delete(sessionId);
    });
}

async function handleSseMessage(req, res, requestUrl) {
    if (!safeIsAuthorized(req)) {
        sendText(res, 401, "Unauthorized");
        return;
    }

    const sessionId = requestUrl.searchParams.get("sessionId")
        || requestUrl.searchParams.get("session_id")
        || req.headers["mcp-session-id"];
    const session = sessions.get(String(sessionId || ""));
    if (!session) {
        sendText(res, 404, "Unknown SSE session");
        return;
    }

    try {
        const raw = await readRequestBody(req);
        const payload = raw ? JSON.parse(raw) : null;
        const response = await handleRpcPayload(payload);
        if (response) {
            sendSseEvent(session.res, "message", response);
        }
        sendText(res, 202, "Accepted");
    } catch (error) {
        sendSseEvent(session.res, "message", rpcError(null, -32700, error?.message || "Parse error"));
        sendText(res, 400, "Bad Request");
    }
}

async function handleDirectRpc(req, res) {
    if (!safeIsAuthorized(req)) {
        sendText(res, 401, "Unauthorized");
        return;
    }

    try {
        const raw = await readRequestBody(req);
        const payload = raw ? JSON.parse(raw) : null;
        const response = await handleRpcPayload(payload);
        if (!response) {
            sendText(res, 202, "Accepted");
            return;
        }
        sendJson(res, 200, response, {
            "Mcp-Session-Id": crypto.randomUUID(),
        });
    } catch (error) {
        sendJson(res, 400, rpcError(null, -32700, error?.message || "Parse error"));
    }
}

function startHttpServer() {
    const server = http.createServer(async (req, res) => {
        const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
        const pathname = requestUrl.pathname.replace(/\/+$/, "") || "/";

        if (req.method === "OPTIONS") {
            sendText(res, 204, "");
            return;
        }

        if (req.method === "GET" && pathname === "/health") {
            sendJson(res, 200, {
                ok: true,
                server: SERVER_NAME,
                version: SERVER_VERSION,
                auth: BEARER_TOKEN ? "bearer" : "none",
            });
            return;
        }

        if (req.method === "GET" && pathname === "/") {
            sendJson(res, 200, {
                server: SERVER_NAME,
                version: SERVER_VERSION,
                transports: {
                    sse: "/sse",
                    streamableHttp: "/mcp",
                },
                scope: "production-only",
            });
            return;
        }

        if (req.method === "GET" && pathname === "/sse") {
            startSse(req, res);
            return;
        }

        if (req.method === "POST" && pathname === "/message") {
            await handleSseMessage(req, res, requestUrl);
            return;
        }

        if (req.method === "POST" && pathname === "/mcp") {
            await handleDirectRpc(req, res);
            return;
        }

        sendText(res, 404, "Not found");
    });

    server.listen(DEFAULT_PORT, DEFAULT_HOST, () => {
        console.error(`${SERVER_NAME} listening on http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
        console.error(`SSE endpoint: http://${DEFAULT_HOST}:${DEFAULT_PORT}/sse`);
        console.error(`HTTP endpoint: http://${DEFAULT_HOST}:${DEFAULT_PORT}/mcp`);
    });
}

function writeStdoutJson(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}

function startStdioServer() {
    let buffer = "";

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", async (chunk) => {
        buffer += chunk;
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            newlineIndex = buffer.indexOf("\n");

            if (!line) {
                continue;
            }

            try {
                const payload = JSON.parse(line);
                const response = await handleRpcPayload(payload);
                if (response) {
                    writeStdoutJson(response);
                }
            } catch (error) {
                writeStdoutJson(rpcError(null, -32700, error?.message || "Parse error"));
            }
        }
    });

    process.stdin.on("end", () => {
        if (!buffer.trim()) {
            return;
        }
        try {
            const payload = JSON.parse(buffer.trim());
            handleRpcPayload(payload).then((response) => {
                if (response) {
                    writeStdoutJson(response);
                }
            });
        } catch (error) {
            writeStdoutJson(rpcError(null, -32700, error?.message || "Parse error"));
        }
    });

    console.error(`${SERVER_NAME} stdio transport ready`);
}

if (process.argv.includes("--stdio")) {
    startStdioServer();
} else {
    startHttpServer();
}
