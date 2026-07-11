/**
 * Pure hledit-mcp helpers.
 *
 * Ported from pi-hledit's tool-contract logic (arg-building, batch
 * translation, result formatting). Deliberately harness-agnostic: no
 * dependency on pi's ExtensionContext or MCP's request context, so the same
 * functions could back a pi extension, an MCP server, or a plain CLI wrapper.
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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

export interface BatchEditParam {
	op: BatchOp;
	anchor: string;
	end_anchor?: string;
	lines?: string[];
	after?: boolean;
}

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
	edits?: string | BatchEditParam[];
}

export interface HleditRun {
	stdout: string;
	stderr: string;
	exitCode: number | null;
}
interface DiffConfig {
	enabled: boolean;
	contextLines: number;
	maxLines: number;
	maxCells: number;
}

interface DiffLine {
	kind: "context" | "added" | "removed" | "omitted";
	text: string;
	lineNumber?: number;
}

interface ChangeMetadata {
	firstChangedLine: number;
	lastChangedLine: number;
	linesAdded: number;
	linesDeleted: number;
}

const DEFAULT_DIFF_CONTEXT_LINES = 2;
const DEFAULT_MAX_DIFF_LINES = 80;
const DEFAULT_MAX_DIFF_CELL_COUNT = 40_000;

function readEnvInt(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number): number {
	const value = env[name];
	if (value === undefined) return fallback;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= min ? parsed : fallback;
}

function readEnvFlag(env: NodeJS.ProcessEnv, name: string): boolean {
	const value = env[name];
	return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

export function diffConfig(env: NodeJS.ProcessEnv = process.env): DiffConfig {
	return {
		enabled: readEnvFlag(env, "HLEDIT_MCP_DIFF"),
		contextLines: readEnvInt(env, "HLEDIT_MCP_DIFF_CONTEXT", DEFAULT_DIFF_CONTEXT_LINES, 0),
		maxLines: readEnvInt(env, "HLEDIT_MCP_DIFF_MAX_LINES", DEFAULT_MAX_DIFF_LINES, 3),
		maxCells: readEnvInt(env, "HLEDIT_MCP_DIFF_MAX_CELLS", DEFAULT_MAX_DIFF_CELL_COUNT, 1),
	};
}

export function formatDiffConfigStatus(env: NodeJS.ProcessEnv = process.env): string {
	const config = diffConfig(env);
	return [
		`Diff output: ${config.enabled ? "enabled" : "disabled"}`,
		"Diff config:",
		`  HLEDIT_MCP_DIFF=${config.enabled ? "1" : "0"}`,
		`  HLEDIT_MCP_DIFF_MAX_LINES=${config.maxLines}`,
		`  HLEDIT_MCP_DIFF_CONTEXT=${config.contextLines}`,
		`  HLEDIT_MCP_DIFF_MAX_CELLS=${config.maxCells}`,
	].join("\n");
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

function formatLineDelta(result: Record<string, unknown>): string | undefined {
	const linesAdded = result.linesAdded;
	const linesDeleted = result.linesDeleted;
	if (typeof linesAdded === "number" && typeof linesDeleted === "number") {
		return `Lines: +${linesAdded} -${linesDeleted}`;
	}
	return undefined;
}

function hasEditMetadata(result: Record<string, unknown>): boolean {
	return (
		"editsApplied" in result ||
		"failed" in result ||
		"message" in result ||
		"firstChangedLine" in result ||
		"lastChangedLine" in result ||
		"linesAdded" in result ||
		"linesDeleted" in result
	);
}

function formatBatchResult(result: Record<string, unknown>, kind: HleditParams["op"] | undefined): string {
	const lines: string[] = [];
	const ok = result.ok !== false;
	const noun = kind === "edit" ? "Edit" : "Batch";

	if (ok) {
		lines.push(result.checked === true ? "Batch check ok." : `${noun} ok.`);

		if (typeof result.editsApplied === "number") {
			lines.push(`Edits applied: ${result.editsApplied}`);
		}

		const firstChangedLine = result.firstChangedLine;
		const lastChangedLine = result.lastChangedLine;
		if (typeof firstChangedLine === "number" && typeof lastChangedLine === "number") {
			if (firstChangedLine === lastChangedLine) {
				lines.push(`Changed line: ${firstChangedLine}`);
			} else {
				lines.push(`Changed lines: ${firstChangedLine}-${lastChangedLine}`);
			}
		} else if (typeof firstChangedLine === "number") {
			lines.push(`First changed line: ${firstChangedLine}`);
		} else if (typeof lastChangedLine === "number") {
			lines.push(`Last changed line: ${lastChangedLine}`);
		}

		const delta = formatLineDelta(result);
		if (delta) lines.push(delta);

		return lines.join("\n");
	}

	lines.push(`${noun} failed.`);
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

export function formatRunText(run: HleditRun, kind: HleditParams["op"] | undefined, diffText?: string): string {
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

	if (hasEditMetadata(parsed)) {
		return appendDiffText(formatBatchResult(parsed, kind), diffText);
	}

	return text;
}

function appendDiffText(summary: string, diffText: string | undefined): string {
	if (!diffText) return summary;
	return `${summary}\n\n\`\`\`diff\n${diffText}\n\`\`\``;
}

function parseChangeMetadata(run: HleditRun): ChangeMetadata | undefined {
	if (run.exitCode !== 0) return undefined;
	const text = run.stdout.trimEnd() || run.stderr.trimEnd();
	const parsed = parseJsonObject(text);
	if (!parsed) return undefined;
	const { firstChangedLine, lastChangedLine, linesAdded, linesDeleted } = parsed;
	if (
		typeof firstChangedLine !== "number" ||
		typeof lastChangedLine !== "number" ||
		typeof linesAdded !== "number" ||
		typeof linesDeleted !== "number"
	) {
		return undefined;
	}
	return { firstChangedLine, lastChangedLine, linesAdded, linesDeleted };
}

function splitSnapshotLines(text: string): string[] {
	return text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
}

async function readTextSnapshot(filePath: string, cwd: string): Promise<string | undefined> {
	try {
		return await readFile(resolve(cwd, filePath), "utf8");
	} catch {
		return undefined;
	}
}

function lcsDiff(
	oldLines: string[],
	newLines: string[],
	oldStartLine: number,
	newStartLine: number,
	config: DiffConfig,
): DiffLine[] {
	if (oldLines.length * newLines.length > config.maxCells) {
		return [
			{
				kind: "omitted",
				text: `... diff omitted: changed window too large (${oldLines.length} old lines, ${newLines.length} new lines) ...`,
			},
		];
	}
	const dp = Array.from({ length: oldLines.length + 1 }, () => Array<number>(newLines.length + 1).fill(0));
	for (let i = oldLines.length - 1; i >= 0; i--) {
		for (let j = newLines.length - 1; j >= 0; j--) {
			dp[i]![j] = oldLines[i] === newLines[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
		}
	}
	const diff: DiffLine[] = [];
	let i = 0;
	let j = 0;
	let oldLine = oldStartLine;
	let newLine = newStartLine;
	while (i < oldLines.length && j < newLines.length) {
		if (oldLines[i] === newLines[j]) {
			diff.push({ kind: "context", text: oldLines[i]!, lineNumber: oldLine });
			i++;
			j++;
			oldLine++;
			newLine++;
		} else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
			diff.push({ kind: "removed", text: oldLines[i]!, lineNumber: oldLine });
			i++;
			oldLine++;
		} else {
			diff.push({ kind: "added", text: newLines[j]!, lineNumber: newLine });
			j++;
			newLine++;
		}
	}
	while (i < oldLines.length) {
		diff.push({ kind: "removed", text: oldLines[i]!, lineNumber: oldLine });
		i++;
		oldLine++;
	}
	while (j < newLines.length) {
		diff.push({ kind: "added", text: newLines[j]!, lineNumber: newLine });
		j++;
		newLine++;
	}
	return diff;
}

function capDiffLines(lines: DiffLine[], config: DiffConfig): DiffLine[] {
	if (lines.length <= config.maxLines) return lines;
	const retainedLineCount = config.maxLines - 1;
	const headCount = Math.floor(retainedLineCount / 2);
	const tailCount = retainedLineCount - headCount;
	return [
		...lines.slice(0, headCount),
		{ kind: "omitted", text: `... (${lines.length - retainedLineCount} diff lines omitted) ...` },
		...lines.slice(lines.length - tailCount),
	];
}

function formatDisplayDiff(lines: DiffLine[], lineNumWidth: number): string {
	return lines
		.map((line) => {
			if (line.kind === "omitted") return line.text;
			const lineNumber = String(line.lineNumber ?? "").padStart(lineNumWidth, " ");
			const prefix = line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";
			return `${prefix}${lineNumber} ${line.text}`;
		})
		.join("\n");
}

export function buildDiff(beforeText: string, afterText: string, metadata: ChangeMetadata, config: DiffConfig = diffConfig()): string | undefined {
	if (!config.enabled) return undefined;
	const beforeLines = splitSnapshotLines(beforeText);
	const afterLines = splitSnapshotLines(afterText);
	const first = Math.max(1, metadata.firstChangedLine);
	const last = Math.max(first, metadata.lastChangedLine);
	const netLineDelta = metadata.linesAdded - metadata.linesDeleted;
	const oldStart = Math.max(1, first - config.contextLines);
	const oldEnd = Math.min(beforeLines.length, last + config.contextLines);
	const newStart = Math.max(1, first - config.contextLines);
	const newEnd = Math.min(afterLines.length, Math.max(first, last + netLineDelta) + config.contextLines);
	const oldSegment = beforeLines.slice(oldStart - 1, oldEnd);
	const newSegment = afterLines.slice(newStart - 1, newEnd);
	if (oldSegment.join("\n") === newSegment.join("\n")) return undefined;
	const lineNumWidth = String(Math.max(oldEnd, newEnd, 1)).length;
	return formatDisplayDiff(capDiffLines(lcsDiff(oldSegment, newSegment, oldStart, newStart, config), config), lineNumWidth);
}

async function diffForRun(
	beforeText: string | undefined,
	filePath: string,
	run: HleditRun,
	cwd: string,
	config: DiffConfig,
): Promise<string | undefined> {
	if (!config.enabled || beforeText === undefined) return undefined;
	const metadata = parseChangeMetadata(run);
	if (!metadata) return undefined;
	const afterText = await readTextSnapshot(filePath, cwd);
	return afterText === undefined ? undefined : buildDiff(beforeText, afterText, metadata, config);
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

export function translateBatchEdits(editsInput: string | unknown[]): BatchTranslationResult {
	let parsed: unknown;
	if (typeof editsInput === "string") {
		try {
			parsed = JSON.parse(editsInput) as unknown;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				ok: false,
				error: `invalid JSON in legacy edits string: ${message}. Prefer structured edits array. If using a JSON string, Escape control characters: use \\t for tabs, \\n for newlines. Each line in the 'lines' array must be a separate string element. Or use op:'edit' for single changes.`,
			};
		}
	} else {
		parsed = editsInput;
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

export function textResult(run: HleditRun, kind: HleditParams["op"] | undefined, diffText?: string): ToolTextResult {
	return { content: [{ type: "text", text: formatRunText(run, kind, diffText) }], isError: run.exitCode !== 0 };
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
		const config = diffConfig();
		const beforeText = config.enabled ? await readTextSnapshot(path, cwd) : undefined;
		const run = await runHledit(request.args, request.stdin, cwd, signal);
		return textResult(run, op, await diffForRun(beforeText, path, run, cwd, config));
	}

	if (op === "batch") {
		if (params.edits === undefined) return errorResult("missing 'edits' param for op:'batch'");
		const translation = translateBatchEdits(params.edits);
		if (!translation.ok) return errorResult(translation.error);
		const config = diffConfig();
		const beforeText = config.enabled ? await readTextSnapshot(path, cwd) : undefined;
		const run = await runHledit(["batch", path], translation.json, cwd, signal);
		return textResult(run, op, await diffForRun(beforeText, path, run, cwd, config));
	}

	return errorResult("unknown op. Must be: read, edit, or batch");
}
