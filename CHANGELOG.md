# Changelog

## Unreleased

No changes yet.

## [0.1.0] - 2026-07-03

### Added

- Initial MCP server exposing `hledit`'s hash-anchored read/edit/batch as a single `hledit` tool, matching `pi-hledit`'s tool contract.
- `core.ts`: ported pure logic from `pi-hledit` (arg-building, batch translation, result formatting) — no dependency on Pi's `ExtensionContext`, so it's shared-shape across both integrations.
- `HLEDIT_BIN`/`HLEDIT_CWD` environment configuration, same pattern as `pi-hledit`.
- Verified end-to-end over a real MCP stdio handshake (`initialize` → `tools/list` → `tools/call`), including stale-anchor rejection carrying through the new surface unchanged.
- `e2e.test.ts`: automated real MCP stdio handshake tests (`tools/list` schema shape, `tools/call` read/stale-rejection) that spawn the built `dist/index.js` under plain `node` — the actual artifact `npx hledit-mcp` runs.

### Fixed

- `bin`/`main` point at `dist/index.js`, built with esbuild, instead of raw `index.ts`; this keeps `npx hledit-mcp` compatible with the declared Node 18+ engine range.
- `package.json`'s `files` array lists the actual package files instead of a missing `test` directory.
