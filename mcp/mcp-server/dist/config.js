import { existsSync, readFileSync } from "node:fs";
const DEFAULT_API_URL = "https://api.savetrix.com/api";
const DEFAULT_WEB_URL = "https://scantrix.ai";
const DEFAULT_PORT = 8000;
const DEFAULT_CONFIG_PATH = ".savetrix-mcp/config.json";
// The website's Google client (NEXT_PUBLIC_GOOGLE_CLIENT_ID; also the
// webClientId in the mobile app). A client ID is public, not a secret.
const DEFAULT_GOOGLE_CLIENT_ID = "244169573027-ttt4i12jqi1coi0hhk90saslrra76t4a.apps.googleusercontent.com";
export const parseArgs = (argv) => {
    let http = false;
    let remote = false;
    let port;
    let configFilePath = DEFAULT_CONFIG_PATH;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--http") {
            http = true;
        }
        else if (arg === "--remote") {
            remote = true;
            http = true;
        }
        else if (arg === "--port") {
            const raw = argv[++i];
            const parsed = Number(raw);
            if (!raw || !Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
                throw new Error(`Invalid --port value: ${raw}`);
            }
            port = parsed;
        }
        else if (arg === "--config") {
            configFilePath = argv[++i] || DEFAULT_CONFIG_PATH;
        }
    }
    return { http, remote, port, configFilePath };
};
const readConfigFile = (path) => {
    if (!existsSync(path))
        return {};
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return {};
    }
};
const envStr = (key) => {
    const v = process.env[key];
    return v && v.trim() !== "" ? v.trim() : undefined;
};
export const loadConfig = (argv) => {
    const args = parseArgs(argv);
    const file = readConfigFile(args.configFilePath);
    const email = envStr("SAVETRIX_EMAIL") ?? file.email;
    const password = envStr("SAVETRIX_PASSWORD") ?? file.password;
    const qbConnectionId = envStr("SAVETRIX_QB_CONNECTION_ID") ?? file.qbConnectionId;
    return {
        apiUrl: envStr("SAVETRIX_API_URL") ?? DEFAULT_API_URL,
        webUrl: (envStr("SAVETRIX_WEB_URL") ?? DEFAULT_WEB_URL).replace(/\/$/, ""),
        port: args.port ??
            (envStr("SAVETRIX_PORT") ? Number(envStr("SAVETRIX_PORT")) : DEFAULT_PORT),
        http: args.http,
        remote: args.remote,
        email,
        password,
        qbConnectionId,
        mcpApiKey: envStr("SAVETRIX_MCP_API_KEY"),
        configFilePath: args.configFilePath,
        publicUrl: envStr("SAVETRIX_PUBLIC_URL")?.replace(/\/$/, ""),
        allowedHosts: (envStr("SAVETRIX_ALLOWED_HOSTS") ?? "")
            .split(",")
            .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
            .filter((h) => h !== ""),
        tokenSecret: envStr("SAVETRIX_TOKEN_SECRET"),
        googleClientId: envStr("SAVETRIX_GOOGLE_CLIENT_ID") ?? DEFAULT_GOOGLE_CLIENT_ID,
    };
};
