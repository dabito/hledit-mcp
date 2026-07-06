#!/usr/bin/env node
/**
 * Compiles index.ts (bundling core.ts inline) to dist/index.js so the
 * published `bin` entry runs on plain `node`, not just runtimes with native
 * TypeScript type-stripping (Node <22.6 has none at all). @modelcontextprotocol/sdk
 * and zod stay external — they're real npm dependencies, resolved normally
 * from node_modules at runtime, not something to bundle.
 */
import { build } from "esbuild";
import { chmod, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });

await build({
	entryPoints: ["index.ts"],
	bundle: true,
	platform: "node",
	target: "node18",
	format: "esm",
	outfile: "dist/index.js",
	external: [
		"@modelcontextprotocol/sdk/server/mcp.js",
		"@modelcontextprotocol/sdk/server/stdio.js",
		"zod",
	],
});

await chmod("dist/index.js", 0o755);
