const DEFAULT_URL = "http://127.0.0.1:3020/mcp";
const targetUrl = process.env.MCP_HTTP_URL || DEFAULT_URL;
const bearerToken = process.env.MCP_BEARER_TOKEN || "";

let buffer = "";
let queue = Promise.resolve();

function writeJson(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}

function makeProxyError(id, message) {
    return {
        jsonrpc: "2.0",
        id: id ?? null,
        error: {
            code: -32603,
            message,
        },
    };
}

async function postRpc(payload) {
    const headers = {
        "Content-Type": "application/json",
    };
    if (bearerToken) {
        headers.Authorization = `Bearer ${bearerToken}`;
    }

    const response = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    });

    if (response.status === 202 || response.status === 204) {
        return null;
    }

    const text = await response.text();
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
    }

    return text ? JSON.parse(text) : null;
}

async function handleLine(line) {
    let payload;
    try {
        payload = JSON.parse(line);
    } catch (error) {
        writeJson(makeProxyError(null, error?.message || "Parse error"));
        return;
    }

    try {
        const response = await postRpc(payload);
        if (response) {
            writeJson(response);
        }
    } catch (error) {
        writeJson(makeProxyError(payload?.id, error?.message || "Proxy error"));
    }
}

function enqueueLine(line) {
    queue = queue.then(() => handleLine(line), () => handleLine(line));
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");

        if (line) {
            enqueueLine(line);
        }
    }
});

process.stdin.on("end", () => {
    const line = buffer.trim();
    if (line) {
        enqueueLine(line);
    }
});

console.error(`MCP stdio HTTP proxy forwarding to ${targetUrl}`);
