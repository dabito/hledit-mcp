# Changelog

## [0.2.0] - 2026-07-09

### Added

- Accept structured `edits` arrays for `op:'batch'` while keeping the legacy JSON string form.
- Add concise edit/batch success summaries with `Lines: +N -M` when `hledit >= 1.2.4` provides line delta metadata.

### Changed

- Build the MCP server version from `package.json` metadata.
- Clarify batch edit schema/docs for `replace` / `delete` / `insert` batch operations.

No changes yet.

## [0.1.4] - 2026-07-09

### Changed

- README install examples now use `npx -y hledit-mcp` and show `HLEDIT_CWD` in MCP client config.
- README/tool descriptions and deterministic transcript now reflect current 3-character `hledit` anchors.
- README links the official MCP Registry listing and adds stale-write-safe file editing SEO copy.

## [0.1.3] - 2026-07-08

### Added

- `mcpName` package metadata and `server.json` for official MCP Registry publishing.

## [0.1.2] - 2026-07-05

### Fixed

- Changelog release metadata now matches the published npm tarball contents.

## [0.1.1] - 2026-07-05

### Added

- Deterministic MCP stdio demo transcript and generator under `docs/demo/`.
- `ROADMAP.md` with asciinema/GIF demo follow-up and listing tasks.

### Changed

- README links the MCP transcript demo near the top.
- Package metadata includes demo docs and uses standard-MCP-client wording.

### Fixed

- Stale `edit` failures now render as `Edit failed.` instead of `Batch failed.`
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
