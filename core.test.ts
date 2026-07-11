import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	buildEditRequest,
	buildReadArgs,
	formatDiffConfigStatus,
	executeHledit,
	resolveHleditBin,
	translateBatchEdits,
} from "./core.ts";

test("resolves hledit from PATH by default", () => {
	assert.equal(resolveHleditBin({}), "hledit");
	assert.equal(resolveHleditBin({ HLEDIT_BIN: "/tmp/hledit" }), "/tmp/hledit");
});

test("builds read args with default range limit", () => {
	assert.deepEqual(buildReadArgs({ op: "read", path: "a.ts" }), [
		"read-range",
		"a.ts",
		"--offset",
		"1",
		"--limit",
		"2000",
	]);
	assert.deepEqual(buildReadArgs({ op: "read", path: "a.ts", grep: "func" }), [
		"read-range",
		"a.ts",
		"--offset",
		"1",
		"--limit",
		"2000",
		"--grep",
		"func",
	]);
});

test("builds explicit edit actions", () => {
	assert.deepEqual(
		buildEditRequest({ op: "edit", path: "a.ts", action: "replace", anchor: "1#AB", content: "x" }),
		{ ok: true, args: ["replace", "a.ts", "1#AB", "-"], stdin: "x" },
	);
	assert.deepEqual(
		buildEditRequest({ op: "edit", path: "a.ts", action: "insert", anchor: "1#AB", content: "x" }),
		{ ok: true, args: ["insert", "a.ts", "1#AB", "-"], stdin: "x" },
	);
	assert.deepEqual(
		buildEditRequest({
			op: "edit",
			path: "a.ts",
			action: "insert",
			anchor: "1#AB",
			after: true,
			content: "x",
		}),
		{ ok: true, args: ["insert", "--after", "a.ts", "1#AB", "-"], stdin: "x" },
	);
	assert.deepEqual(buildEditRequest({ op: "edit", path: "a.ts", action: "delete", anchor: "1#AB" }), {
		ok: true,
		args: ["replace", "a.ts", "1#AB", "-"],
		stdin: "",
	});
	assert.deepEqual(
		buildEditRequest({
			op: "edit",
			path: "a.ts",
			action: "replace-range",
			anchor: "1#AB",
			end_anchor: "3#CD",
			content: "x",
		}),
		{ ok: true, args: ["replace-range", "a.ts", "1#AB", "3#CD", "-"], stdin: "x" },
	);
});

test("translates wrapper batch edits to CLI request", () => {
	const translation = translateBatchEdits(
		JSON.stringify([
			{ op: "replace", anchor: "1#AB", lines: ["one"] },
			{ op: "delete", anchor: "2#CD", end_anchor: "3#EF", lines: [] },
			{ op: "insert", anchor: "4#GH", lines: ["new"] },
		]),
	);

	assert.equal(translation.ok, true);
	if (translation.ok) {
		assert.deepEqual(translation.request, {
			edits: [
				{ op: "replace", pos: "1#AB", lines: ["one"] },
				{ op: "delete", pos: "2#CD", end_pos: "3#EF", lines: [] },
				{ op: "insert", pos: "4#GH", lines: ["new"] },
			],
		});
		assert.equal(translation.json, JSON.stringify(translation.request));
	}
});

test("translates structured batch edits array to CLI request", () => {
	const translation = translateBatchEdits([
		{ op: "replace", anchor: "1#AB", lines: ["one"] },
		{ op: "insert", anchor: "4#GH", lines: ["new"] },
	]);

	assert.equal(translation.ok, true);
	if (translation.ok) {
		assert.deepEqual(translation.request, {
			edits: [
				{ op: "replace", pos: "1#AB", lines: ["one"] },
				{ op: "insert", pos: "4#GH", lines: ["new"] },
			],
		});
		assert.equal(translation.json, JSON.stringify(translation.request));
	}
});

test("rejects unsupported batch insert-after", () => {
	const translation = translateBatchEdits(
		JSON.stringify([{ op: "insert", anchor: "1#AB", after: true, lines: ["x"] }]),
	);

	assert.deepEqual(translation, {
		ok: false,
		error: "edit 0 uses after, but batch insert-after is not supported by hledit CLI",
	});
});

test("batch edits with literal control chars give actionable error", () => {
	const malformed = `{"edits":[{"op":"replace","anchor":"4#VJ","lines":["\treturn"]}]}`;
	const translation = translateBatchEdits(malformed);

	assert.equal(translation.ok, false);
	if (!translation.ok) {
		assert.ok(translation.error.includes("Escape control characters"));
		assert.ok(translation.error.includes("op:'edit'"));
	}
});

test("executeHledit read calls read-range and returns annotated lines", async () => {
	const dir = await mkdtemp(join(tmpdir(), "hledit-mcp-test-"));
	const fakeBin = join(dir, "hledit-fake.mjs");
	const argsLog = join(dir, "args.json");
	await writeFile(
		fakeBin,
		`#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(argsLog)}, JSON.stringify(process.argv.slice(2)));
console.log("1#AB:const ok = true;\\n2#CD:console.log(ok);");
`,
		{ mode: 0o755 },
	);

	const oldBin = process.env.HLEDIT_BIN;
	process.env.HLEDIT_BIN = fakeBin;
	try {
		const result = await executeHledit({ op: "read", path: "file.ts" }, dir);
		assert.equal(result.isError, false);
		assert.equal(result.content[0]?.text, "1#AB:const ok = true;\n2#CD:console.log(ok);");

		const calledArgs = JSON.parse(await readFile(argsLog, "utf8"));
		assert.deepEqual(calledArgs, ["read-range", "file.ts", "--offset", "1", "--limit", "2000"]);
	} finally {
		if (oldBin === undefined) delete process.env.HLEDIT_BIN;
		else process.env.HLEDIT_BIN = oldBin;
	}
});

test("executeHledit edit returns human-readable summary", async () => {
	const dir = await mkdtemp(join(tmpdir(), "hledit-mcp-test-"));
	const fakeBin = join(dir, "hledit-fake.mjs");
	await writeFile(
		fakeBin,
		`#!/usr/bin/env node\nconsole.log(JSON.stringify({ ok: true, firstChangedLine: 1, lastChangedLine: 1, linesAdded: 1, linesDeleted: 1 }))\n`,
		{ mode: 0o755 },
	);

	const oldBin = process.env.HLEDIT_BIN;
	process.env.HLEDIT_BIN = fakeBin;
	try {
		const result = await executeHledit(
			{ op: "edit", path: "file.ts", action: "replace", anchor: "1#AB", content: "x" },
			dir,
		);
		assert.equal(result.isError, false);
		assert.equal(result.content[0]?.text, "Edit ok.\nChanged line: 1\nLines: +1 -1");
	} finally {
		if (oldBin === undefined) delete process.env.HLEDIT_BIN;
		else process.env.HLEDIT_BIN = oldBin;
	}
});

test("executeHledit edit can append opt-in capped diff", async () => {
	const dir = await mkdtemp(join(tmpdir(), "hledit-mcp-test-"));
	const target = join(dir, "file.ts");
	const fakeBin = join(dir, "hledit-fake.mjs");
	await writeFile(target, "alpha\nbeta\ngamma\n");
	await writeFile(
		fakeBin,
		`#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync("file.ts", "alpha\\nBETA\\ngamma\\n");
console.log(JSON.stringify({ ok: true, firstChangedLine: 2, lastChangedLine: 2, linesAdded: 1, linesDeleted: 1 }));
`,
		{ mode: 0o755 },
	);

	const oldBin = process.env.HLEDIT_BIN;
	const oldDiff = process.env.HLEDIT_MCP_DIFF;
	const oldContext = process.env.HLEDIT_MCP_DIFF_CONTEXT;
	process.env.HLEDIT_BIN = fakeBin;
	process.env.HLEDIT_MCP_DIFF = "1";
	process.env.HLEDIT_MCP_DIFF_CONTEXT = "1";
	try {
		assert.match(formatDiffConfigStatus(process.env), /Diff output: enabled/);
		const result = await executeHledit(
			{ op: "edit", path: "file.ts", action: "replace", anchor: "2#ABC", content: "BETA" },
			dir,
		);
		assert.equal(result.isError, false);
		assert.match(result.content[0]?.text ?? "", /```diff/);
		assert.match(result.content[0]?.text ?? "", /-2 beta/);
		assert.match(result.content[0]?.text ?? "", /\+2 BETA/);
	} finally {
		if (oldBin === undefined) delete process.env.HLEDIT_BIN;
		else process.env.HLEDIT_BIN = oldBin;
		if (oldDiff === undefined) delete process.env.HLEDIT_MCP_DIFF;
		else process.env.HLEDIT_MCP_DIFF = oldDiff;
		if (oldContext === undefined) delete process.env.HLEDIT_MCP_DIFF_CONTEXT;
		else process.env.HLEDIT_MCP_DIFF_CONTEXT = oldContext;
	}
});

test("executeHledit batch returns human-readable summary", async () => {
	const dir = await mkdtemp(join(tmpdir(), "hledit-mcp-test-"));
	const fakeBin = join(dir, "hledit-fake.mjs");
	await writeFile(
		fakeBin,
		`#!/usr/bin/env node\nconsole.log(JSON.stringify({ ok: true, firstChangedLine: 12, lastChangedLine: 18, editsApplied: 1, linesAdded: 3, linesDeleted: 1 }))\n`,
		{ mode: 0o755 },
	);

	const oldBin = process.env.HLEDIT_BIN;
	process.env.HLEDIT_BIN = fakeBin;
	try {
		const result = await executeHledit(
			{
				op: "batch",
				path: "file.ts",
				edits: JSON.stringify([{ op: "replace", anchor: "1#AB", lines: ["x"] }]),
			},
			dir,
		);
		assert.equal(result.isError, false);
		assert.match(result.content[0]?.text ?? "", /Batch ok\./);
		assert.match(result.content[0]?.text ?? "", /Edits applied: 1/);
		assert.match(result.content[0]?.text ?? "", /Changed lines: 12-18/);
		assert.match(result.content[0]?.text ?? "", /Lines: \+3 -1/);
	} finally {
		if (oldBin === undefined) delete process.env.HLEDIT_BIN;
		else process.env.HLEDIT_BIN = oldBin;
	}
});

test("executeHledit rejects unknown op", async () => {
	const result = await executeHledit(
		{ op: "bogus" as unknown as "read", path: "file.ts" },
		process.cwd(),
	);
	assert.equal(result.isError, true);
	assert.match(result.content[0]?.text ?? "", /unknown op/);
});
