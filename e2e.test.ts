/**
 * Real MCP stdio handshake test: spawns the built dist/index.js — the actual
 * artifact `bin`/npx installs run — as a subprocess under plain `node` (no
 * tsx, no type-stripping), and drives it with a real
 * @modelcontextprotocol/sdk Client over stdio. This is the automated version
 * of the manual verification the CHANGELOG describes ("Verified end-to-end
 * over a real MCP stdio handshake"), and it's also what catches the Node
 * 18-21 compatibility gap a raw `.ts` bin entry would silently reintroduce:
 * if dist/index.js doesn't exist or doesn't run under plain node, this test
 * fails instead of only tsx-based tests passing.
 */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const distEntry = join(packageRoot, "dist", "index.js");

async function makeFakeHledit(dir: string, script: string): Promise<string> {
	const fakeBin = join(dir, "hledit-fake.mjs");
	await writeFile(fakeBin, script, { mode: 0o755 });
	return fakeBin;
}

async function connectClient(env: Record<string, string>): Promise<Client> {
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [distEntry],
		cwd: packageRoot,
		env,
	});
	const client = new Client({ name: "hledit-mcp-e2e-test", version: "0.0.0" });
	await client.connect(transport);
	return client;
}

test("real MCP handshake: tools/list exposes exactly the hledit tool with its schema", async () => {
	const dir = await mkdtemp(join(tmpdir(), "hledit-mcp-e2e-"));
	const fakeBin = await makeFakeHledit(dir, `#!/usr/bin/env node\nconsole.log("ok");\n`);
	const client = await connectClient({ HLEDIT_BIN: fakeBin });

	try {
		const { tools } = await client.listTools();
		assert.equal(tools.length, 1);
		const [tool] = tools;
		assert.equal(tool.name, "hledit");
		assert.equal(tool.title, "Hashline Edit");

		const props = tool.inputSchema.properties as Record<string, unknown>;
		assert.ok(props.op, "schema exposes op");
		assert.ok(props.path, "schema exposes path");
		assert.ok(props.anchor, "schema exposes anchor");
		assert.deepEqual(tool.inputSchema.required, ["op", "path"]);
	} finally {
		await client.close();
	}
});

test("real MCP handshake: tools/call op:'read' runs the configured hledit binary and returns annotated lines", async () => {
	const dir = await mkdtemp(join(tmpdir(), "hledit-mcp-e2e-"));
	const fakeBin = await makeFakeHledit(
		dir,
		`#!/usr/bin/env node\nconsole.log("1#AB:const ok = true;\\n2#CD:console.log(ok);");\n`,
	);
	const client = await connectClient({ HLEDIT_BIN: fakeBin });

	try {
		const result = await client.callTool({ name: "hledit", arguments: { op: "read", path: "file.ts" } });
		assert.equal(result.isError, false);
		const content = result.content as Array<{ type: string; text?: string }>;
		assert.equal(content[0]?.text, "1#AB:const ok = true;\n2#CD:console.log(ok);");
	} finally {
		await client.close();
	}
});

test("real MCP handshake: stale-anchor rejection carries through unchanged", async () => {
	const dir = await mkdtemp(join(tmpdir(), "hledit-mcp-e2e-"));
	const fakeBin = await makeFakeHledit(
		dir,
		`#!/usr/bin/env node
console.error(JSON.stringify({ ok: false, error: "stale", message: "anchor 1#AB no longer matches file content" }));
process.exit(1);
`,
	);
	const client = await connectClient({ HLEDIT_BIN: fakeBin });

	try {
		const result = await client.callTool({
			name: "hledit",
			arguments: { op: "edit", path: "file.ts", action: "replace", anchor: "1#AB", content: "x" },
		});
		assert.equal(result.isError, true);
		const content = result.content as Array<{ type: string; text?: string }>;
		assert.match(content[0]?.text ?? "", /stale/);
	} finally {
		await client.close();
	}
});
