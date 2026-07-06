/**
 * Pure hledit-mcp helpers.
 *
 * Ported from pi-hledit's tool-contract logic (arg-building, batch
 * translation, result formatting). Deliberately harness-agnostic: no
 * dependency on pi's ExtensionContext or MCP's request context, so the same
 * functions could back a pi extension, an MCP server, or a plain CLI wrapper.
 */

import { spawn } from "node:child_process";

const DEFAULT_HLEDIT_BIN = "hledit";

export const HLEDIT_INSTALL_HINT = `Install the hledit CLI first:
  go install github.com/dabito/hledit@latest

Then make sure the binary is on PATH for this MCP server, or set:
  export HLEDIT_BIN="$HOME/go/bin/hledit"

CLI repo: https://github.com/dabito/hledit`;

const EDIT_ACTIONS = ["replace", "insert", "delete", "replace-range"] as const;
const BATCH_OPS = ["replace", "delete", "insert"] as const;

export type EditAction = (typeof EDIT_ACTIONS)[number];
export type BatchOp = (typeof BATCH_OPS)[number];

export interface HleditParams {
	op: "read" | "edit" | "batch";
	path: string;
	offset?: number;
	limit?: number;
	grep?: string;
	action?: EditAction;
	anchor?: string;
	end_anchor?: string;
	content?: string;
	after?: boolean;
	edits?: string;
}

export interface HleditRun {
	stdout: string;
	stderr: string;
	exitCode: number | null;
}

interface CliBatchEdit {
	op: BatchOp;
	pos: string;
	end_pos?: string;
	lines: string[];
}

interface CliBatchRequest {
	edits: CliBatchEdit[];
}

export type BatchTranslationResult =
	| { ok: true; request: CliBatchRequest; json: string }
	| { ok: false; error: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBatchOp(value: unknown): value is BatchOp {
	return typeof value === "string" && (BATCH_OPS as readonly string[]).includes(value);
}

function isEditAction(value: unknown): value is EditAction {
	return typeof value === "string" && (EDIT_ACTIONS as readonly string[]).includes(value);
}

export function resolveHleditBin(env: NodeJS.ProcessEnv = process.env): string {
	return env.HLEDIT_BIN || DEFAULT_HLEDIT_BIN;
}

export function resolveHleditCwd(env: NodeJS.ProcessEnv = process.env): string {
	return env.HLEDIT_CWD || process.cwd();
}

export async function runHledit(
	args: string[],
	stdin: string | undefined,
	cwd: string,
	signal?: AbortSignal,
): Promise<HleditRun> {
	const bin = resolveHleditBin();
	return new Promise((resolve) => {
		const child = spawn(bin, args, { cwd, signal, stdio: ["pipe", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.on("error", (err) =>
			resolve({
				stdout: `failed to run ${bin}: ${err.message}\n\n${HLEDIT_INSTALL_HINT}`,
				stderr,
				exitCode: 1,
			}),
		);
		child.on("close", (exitCode) => resolve({ stdout, stderr, exitCode }));
		child.stdin.end(stdin ?? "");
	});
}

function parseJsonObject(text: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(text) as unknown;
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function formatBatchResult(result: Record<string, unknown>): string {
	const lines: string[] = [];
	const ok = result.ok !== false;

	if (ok) {
		lines.push(result.checked === true ? "Batch check ok." : "Batch ok.");

		if (typeof result.editsApplied === "number") {
			lines.push(`Edits applied: ${result.editsApplied}`);
		}

		const firstChangedLine = result.firstChangedLine;
		const lastChangedLine = result.lastChangedLine;
		if (typeof firstChangedLine === "number" && typeof lastChangedLine === "number") {
			lines.push(`Changed lines: ${firstChangedLine}-${lastChangedLine}`);
		} else if (typeof firstChangedLine === "number") {
			lines.push(`First changed line: ${firstChangedLine}`);
		} else if (typeof lastChangedLine === "number") {
			lines.push(`Last changed line: ${lastChangedLine}`);
		}

		return lines.join("\n");
	}

	lines.push("Batch failed.");
	if (typeof result.error === "string") {
		lines.push(`Error: ${result.error}`);
	}
	if (typeof result.message === "string" && result.message !== result.error) {
		lines.push(`Message: ${result.message}`);
	}
	if (typeof result.failed === "number") {
		lines.push(`Failed edit: ${result.failed}`);
	}

	if (Array.isArray(result.remaps) && result.remaps.length > 0) {
		lines.push("Remaps:");
		for (const remap of result.remaps) {
			if (!isRecord(remap)) continue;
			const requested =
				typeof remap.Requested === "string"
					? remap.Requested
					: typeof remap.requested === "string"
						? remap.requested
						: undefined;
			const current =
				typeof remap.Current === "string"
					? remap.Current
					: typeof remap.current === "string"
						? remap.current
						: undefined;
			if (requested && current) {
				lines.push(`- ${requested} -> ${current}`);
			} else if (requested) {
				lines.push(`- ${requested}`);
			}
		}
	}

	return lines.join("\n");
}

export function formatRunText(run: HleditRun, kind: HleditParams["op"] | undefined): string {
	const text = run.stdout.trimEnd() || run.stderr.trimEnd();

	if (run.exitCode !== 0) {
		return text || HLEDIT_INSTALL_HINT;
	}

	if (!text) {
		if (kind === "batch") return "Batch ok.";
		if (kind === "edit") return "Edit ok.";
		if (kind === "read") return "Read ok.";
		return "Done.";
	}

	const parsed = parseJsonObject(text);
	if (!parsed) return text;

	if ("editsApplied" in parsed || "failed" in parsed || "message" in parsed) {
		return formatBatchResult(parsed);
	}

	return text;
}

function toNum(v: number | undefined): number | undefined {
	return v !== undefined && v >= 0 ? v : undefined;
}

function hasAnchorShape(anchor: string): boolean {
	return /^\d+#[A-Za-z0-9]+$/.test(anchor);
}

export function buildReadArgs(params: HleditParams): string[] {
	const offset = toNum(params.offset);
	const limit = toNum(params.limit);
	const grep = params.grep || undefined;

	const args = [
		"read-range",
		params.path,
		"--offset",
		String(offset ?? 1),
		"--limit",
		String(limit ?? 2000),
	];

	if (grep) args.push("--grep", grep);

	return args;
}

export function getEditAction(params: HleditParams): EditAction {
	if (params.action !== undefined) {
		if (!isEditAction(params.action)) {
			throw new Error("invalid action. Must be: replace, insert, delete, or replace-range.");
		}
		return params.action;
	}

	if (params.end_anchor) return "replace-range";
	if (params.after) return "insert";
	return "replace";
}

export function buildEditRequest(
	params: HleditParams,
): { ok: true; args: string[]; stdin: string } | { ok: false; error: string } {
	const anchor = params.anchor;
	if (!anchor) {
		return { ok: false, error: "missing 'anchor' param for op:'edit'" };
	}

	let action: EditAction;
	try {
		action = getEditAction(params);
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}

	const content = action === "delete" ? "" : (params.content ?? "");
	const endAnchor = params.end_anchor || undefined;

	if ((action === "replace-range" || action === "delete") && endAnchor) {
		return {
			ok: true,
			args: ["replace-range", params.path, anchor, endAnchor, "-"],
			stdin: content,
		};
	}

	if (action === "replace-range") {
		return { ok: false, error: "action:'replace-range' requires end_anchor" };
	}

	if (action === "insert") {
		const args = params.after
			? ["insert", "--after", params.path, anchor, "-"]
			: ["insert", params.path, anchor, "-"];
		return { ok: true, args, stdin: content };
	}

	return { ok: true, args: ["replace", params.path, anchor, "-"], stdin: content };
}

export function translateBatchEdits(editsJson: string): BatchTranslationResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(editsJson) as unknown;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			error: `invalid JSON in edits param: ${message}. Escape control characters: use \\t for tabs, \\n for newlines. Each line in the 'lines' array must be a separate string element. Or use op:'edit' for single changes.`,
		};
	}

	if (!Array.isArray(parsed)) {
		return { ok: false, error: "edits must be a JSON array" };
	}

	const edits: CliBatchEdit[] = [];

	for (let i = 0; i < parsed.length; i++) {
		const edit = parsed[i];
		if (!isRecord(edit)) {
			return { ok: false, error: `edit ${i} must be an object` };
		}

		const { op, anchor, end_anchor: endAnchor, lines, after } = edit;

		if (!isBatchOp(op)) {
			return { ok: false, error: `edit ${i} has invalid op. Must be: replace, delete, or insert` };
		}

		if (typeof anchor !== "string" || !hasAnchorShape(anchor)) {
			return { ok: false, error: `edit ${i} requires anchor in LN#HASH format` };
		}

		if (endAnchor !== undefined && typeof endAnchor !== "string") {
			return { ok: false, error: `edit ${i} end_anchor must be a string` };
		}

		if (endAnchor !== undefined && !hasAnchorShape(endAnchor)) {
			return { ok: false, error: `edit ${i} end_anchor must use LN#HASH format` };
		}

		if (after !== undefined) {
			return {
				ok: false,
				error: `edit ${i} uses after, but batch insert-after is not supported by hledit CLI`,
			};
		}

		if (lines !== undefined && !Array.isArray(lines)) {
			return { ok: false, error: `edit ${i} lines must be an array of strings` };
		}

		if (Array.isArray(lines) && !lines.every((line) => typeof line === "string")) {
			return { ok: false, error: `edit ${i} lines must contain only strings` };
		}

		edits.push({
			op,
			pos: anchor,
			...(endAnchor ? { end_pos: endAnchor } : {}),
			lines: Array.isArray(lines) ? lines : [],
		});
	}

	const request = { edits };
	return { ok: true, request, json: JSON.stringify(request) };
}

export interface ToolTextResult {
	[key: string]: unknown;
	content: Array<{ type: "text"; text: string }>;
	isError: boolean;
}

export function errorResult(text: string): ToolTextResult {
	return { content: [{ type: "text", text }], isError: true };
}

export function textResult(run: HleditRun, kind: HleditParams["op"] | undefined): ToolTextResult {
	return { content: [{ type: "text", text: formatRunText(run, kind) }], isError: run.exitCode !== 0 };
}

/** Execute one hledit op end-to-end: build CLI args, run the binary, format the result. */
export async function executeHledit(
	params: HleditParams,
	cwd: string,
	signal?: AbortSignal,
): Promise<ToolTextResult> {
	const { op, path } = params;

	if (op === "read") {
		return textResult(await runHledit(buildReadArgs(params), undefined, cwd, signal), op);
	}

	if (op === "edit") {
		const request = buildEditRequest(params);
		if (!request.ok) return errorResult(request.error);
		return textResult(await runHledit(request.args, request.stdin, cwd, signal), op);
	}

	if (op === "batch") {
		if (!params.edits) return errorResult("missing 'edits' param for op:'batch'");
		const translation = translateBatchEdits(params.edits);
		if (!translation.ok) return errorResult(translation.error);
		return textResult(await runHledit(["batch", path], translation.json, cwd, signal), op);
	}

	return errorResult("unknown op. Must be: read, edit, or batch");
}
