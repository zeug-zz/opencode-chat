import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type McpTransport = "stdio" | "http" | "sdk" | "unknown";

export type McpInventory = {
  servers: Record<string, { explicitlyDisabled: boolean; transport: McpTransport }>;
};

type JsonObject = Record<string, unknown>;

function stripJsonc(source: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (character === "\n" || character === "\r") {
        inLineComment = false;
        result += character;
      } else {
        result += " ";
      }
      continue;
    }

    if (inBlockComment) {
      if (character === "*" && next === "/") {
        inBlockComment = false;
        result += "  ";
        index += 1;
      } else {
        result += character === "\n" || character === "\r" ? character : " ";
      }
      continue;
    }

    if (inString) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
    } else if (character === "/" && next === "/") {
      inLineComment = true;
      result += "  ";
      index += 1;
    } else if (character === "/" && next === "*") {
      inBlockComment = true;
      result += "  ";
      index += 1;
    } else {
      result += character;
    }
  }
  if (inBlockComment) throw new Error("unterminated comment");

  let withoutTrailingCommas = "";
  inString = false;
  escaped = false;
  for (let index = 0; index < result.length; index += 1) {
    const character = result[index];
    if (inString) {
      withoutTrailingCommas += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      withoutTrailingCommas += character;
      continue;
    }
    if (character === ",") {
      let lookahead = index + 1;
      while (/\s/.test(result[lookahead] ?? "")) lookahead += 1;
      if (result[lookahead] === "}" || result[lookahead] === "]") continue;
    }
    withoutTrailingCommas += character;
  }
  return withoutTrailingCommas;
}

function parseConfig(filePath: string): JsonObject {
  let source: string;
  try {
    source = readFileSync(filePath, "utf8");
  } catch {
    throw new Error(`Unable to read MCP config file: ${filePath}`);
  }

  try {
    const parsed: unknown = JSON.parse(stripJsonc(source));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("root is not an object");
    return parsed as JsonObject;
  } catch {
    throw new Error(`Unable to parse MCP config file: ${filePath}`);
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function classifyTransport(definition: unknown): McpTransport {
  if (!isObject(definition)) return "unknown";
  if (Object.hasOwn(definition, "command")) return "stdio";
  if (typeof definition.url === "string" && /^https?:\/\//i.test(definition.url)) return "http";
  if (typeof definition.type === "string" && /^(?:sdk|in[-_ ]?process)$/i.test(definition.type)) return "sdk";
  return "unknown";
}

function addServers(
  inventory: Record<string, { explicitlyDisabled: boolean; transport: McpTransport }>,
  value: unknown,
): void {
  if (!isObject(value)) return;
  for (const name of Object.keys(value)) {
    const definition = value[name];
    const previous = inventory[name];
    const explicitlyDisabled =
      isObject(definition) && typeof definition.enabled === "boolean"
        ? definition.enabled === false
        : (previous?.explicitlyDisabled ?? false);
    const transport = classifyTransport(definition);
    Object.defineProperty(inventory, name, {
      value: { explicitlyDisabled, transport },
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
}

function readLayer(
  inventory: Record<string, { explicitlyDisabled: boolean; transport: McpTransport }>,
  filePath: string,
  mcpKey: string,
): void {
  if (!existsSync(filePath)) return;
  const config = parseConfig(filePath);
  if (mcpKey in config && !isObject(config[mcpKey])) {
    throw new Error(`Invalid MCP section in config file: ${filePath}`);
  }
  addServers(inventory, config[mcpKey]);
}

function projectConfigDirectories(workspaceRoot: string): string[] {
  const directories: string[] = [];
  let current = resolve(workspaceRoot);
  while (true) {
    directories.push(current);
    if (existsSync(join(current, ".git"))) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return directories.reverse();
}

export function resolveMcpInventory(globalConfigDir: string, workspaceRoot: string): McpInventory {
  const servers: Record<string, { explicitlyDisabled: boolean; transport: McpTransport }> = {};
  const readOpenCodeConfigs = (directory: string): void => {
    readLayer(servers, join(directory, "opencode.json"), "mcp");
    readLayer(servers, join(directory, "opencode.jsonc"), "mcp");
  };

  readOpenCodeConfigs(globalConfigDir);
  for (const directory of projectConfigDirectories(workspaceRoot)) readOpenCodeConfigs(directory);

  const mcpFile = join(resolve(workspaceRoot), ".mcp.json");
  if (existsSync(mcpFile)) {
    const config = parseConfig(mcpFile);
    addServers(servers, config.mcpServers ?? config.mcp);
  }

  return { servers };
}
