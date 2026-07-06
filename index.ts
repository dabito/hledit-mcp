#!/usr/bin/env node
/**
 * hledit-mcp: MCP server exposing hash-anchored file edits (hledit) to any
 * MCP-compatible client.
 *
 * Same tool contract as pi-hledit (op: read | edit | batch), ported from its
 * pure logic in core.ts. No rendering layer — MCP has no equivalent of pi's
 * renderCall/renderResult, so this adapter is just schema + execute.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { executeHledit, resolveHleditCwd, type HleditParams } from "./core.ts";

const server = new McpServer({
	name: "hledit-mcp",
	version: "0.1.0",
});

const EDIT_ACTIONS = ["replace", "insert", "delete", "replace-range"] as const;

server.registerTool(
	"hledit",
	{
		title: "Hashline Edit",
		description:
			"Read, edit, or batch-edit files using hash-anchored line references (LN#HASH). " +
			"Use op:'read' to get anchors, op:'edit' for single changes, op:'batch' for multiple edits in one call. " +
			"Anchors come from the most recent read and detect stale context before any write.",
		inputSchema: {
			op: z.enum(["read", "edit", "batch"]).describe("Operation: 'read', 'edit', or 'batch'"),
			path: z.string().describe("File path"),
			offset: z.number().optional().describe("1-indexed starting line (read)"),
			limit: z.number().optional().describe("Max lines to return (read)"),
			grep: z.string().optional().describe("Filter lines by substring (read)"),
			action: z
				.enum(EDIT_ACTIONS)
				.optional()
				.describe(
					"Edit action: replace, insert, delete, or replace-range. Defaults to replace unless end_anchor or after imply otherwise.",
				),
			anchor: z.string().optional().describe("LN#HASH anchor, e.g. 12#NK"),
			end_anchor: z.string().optional().describe("End anchor for replace-range/delete range"),
			content: z.string().optional().describe("Replacement or inserted content; empty = delete"),
			after: z.boolean().optional().describe("For action:'insert', insert after anchor"),
			edits: z.string().optional().describe("JSON array of batch edit ops (op: read/edit/batch)"),
		},
	},
	async (params, extra) => {
		const cwd = resolveHleditCwd();
		const signal = extra?.signal;
		return executeHledit(params as HleditParams, cwd, signal);
	},
);

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((err: unknown) => {
	console.error("hledit-mcp failed to start:", err);
	process.exit(1);
});
