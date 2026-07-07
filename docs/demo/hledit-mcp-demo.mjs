#!/usr/bin/env node
/* global console, process */
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const distEntry = join(repoRoot, "dist", "index.js");
const hleditBin = process.env.HLEDIT_BIN ?? "hledit";
const tmp = await mkdtemp(join(tmpdir(), "hledit-mcp-demo-"));
const file = "demo.txt";
const fullPath = join(tmp, file);

function text(result) {
	return (result.content ?? [])
		.map((part) => (part.type === "text" ? part.text ?? "" : JSON.stringify(part)))
		.join("\n");
}

function section(title) {
	console.log(`\n## ${title}`);
}

function block(value) {
	console.log("```text");
	console.log(value.trimEnd());
	console.log("```");
}

const transport = new StdioClientTransport({
	command: process.execPath,
	args: [distEntry],
	cwd: repoRoot,
	env: {
		...process.env,
		HLEDIT_BIN: hleditBin,
		HLEDIT_CWD: tmp,
	},
});

const client = new Client({ name: "hledit-mcp-demo", version: "0.0.0" });

try {
	await writeFile(fullPath, "count = 1\n");
	await client.connect(transport);

	console.log("# hledit-mcp deterministic MCP transcript");
	console.log();
	console.log("This transcript uses a real MCP stdio client against `dist/index.js`.");
	console.log("`hledit-mcp` calls the configured `hledit` CLI; this script does not call `hledit` directly.");
	console.log();
	console.log("Temp workspace: created with `mkdtemp` and removed after the run.");

	section("tools/list");
	const { tools } = await client.listTools();
	block(tools.map((tool) => `${tool.name} — ${tool.description ?? tool.title ?? ""}`).join("\n"));

	section("Initial file");
	block(await readFile(fullPath, "utf8"));

	section("MCP tools/call: read");
	const read1 = await client.callTool({ name: "hledit", arguments: { op: "read", path: file, limit: 20 } });
	const read1Text = text(read1);
	block(read1Text);
	const anchor = read1Text.match(/^(\d+#[A-Z]+):/m)?.[1];
	if (!anchor) throw new Error(`could not parse anchor from read output: ${read1Text}`);
	console.log(`Captured stale-prone anchor: \`${anchor}\``);

	section("External actor changes file after read");
	await writeFile(fullPath, "count = 2\n");
	block(await readFile(fullPath, "utf8"));

	section("MCP tools/call: edit with old anchor");
	const stale = await client.callTool({
		name: "hledit",
		arguments: { op: "edit", path: file, action: "replace", anchor, content: "count = 3" },
	});
	block(text(stale));

	section("Re-read for fresh anchor");
	const read2 = await client.callTool({ name: "hledit", arguments: { op: "read", path: file, limit: 20 } });
	const read2Text = text(read2);
	block(read2Text);
	const fresh = read2Text.match(/^(\d+#[A-Z]+):/m)?.[1];
	if (!fresh) throw new Error(`could not parse fresh anchor from read output: ${read2Text}`);
	console.log(`Fresh anchor: \`${fresh}\``);

	section("MCP tools/call: edit with fresh anchor");
	const ok = await client.callTool({
		name: "hledit",
		arguments: { op: "edit", path: file, action: "replace", anchor: fresh, content: "count = 3" },
	});
	block(text(ok));

	section("Final file");
	block(await readFile(fullPath, "utf8"));
} finally {
	await client.close().catch(() => undefined);
	await rm(tmp, { recursive: true, force: true });
}
