# Changelog

## Unreleased

### Fixed

- `bin`/`main` pointed directly at raw `index.ts`, which only runs under plain `node` on Node ≥22.6 (native TypeScript type-stripping) — Node 18-21, the versions `engines.node` claimed to support, would hard-crash on `npx hledit-mcp`. Added an esbuild build step (`build.mjs`) that bundles `index.ts`+`core.ts` into `dist/index.js`; `bin`/`main` now point there, restoring genuine Node 18+ compatibility. `npm start` still runs from source via `tsx` for fast local iteration.
- `package.json`'s `files` array listed a `test` directory that never existed (tests live at the package root as `core.test.ts`), so a real npm publish would have silently omitted them; replaced with the actual filenames.

### Added

- `e2e.test.ts`: automated real MCP stdio handshake tests (`tools/list` schema shape, `tools/call` read/stale-rejection) that spawn the built `dist/index.js` under plain `node` — the actual artifact `npx hledit-mcp` runs. Previously the "verified end-to-end" claim below was manual and unrepeatable; a change to `index.ts`'s server wiring could have broken the real protocol surface while `core.test.ts` (which only exercises `core.ts`) stayed green.

## [0.1.0] - 2026-07-03

### Added

- Initial MCP server exposing `hledit`'s hash-anchored read/edit/batch as a single `hledit` tool, matching `pi-hledit`'s tool contract.
- `core.ts`: ported pure logic from `pi-hledit` (arg-building, batch translation, result formatting) — no dependency on Pi's `ExtensionContext`, so it's shared-shape across both integrations.
- `HLEDIT_BIN`/`HLEDIT_CWD` environment configuration, same pattern as `pi-hledit`.
- Verified end-to-end over a real MCP stdio handshake (`initialize` → `tools/list` → `tools/call`), including stale-anchor rejection carrying through the new surface unchanged.
