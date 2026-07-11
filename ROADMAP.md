# Roadmap

## Demo assets

- [ ] Record `docs/demo/hledit-mcp.cast` with asciinema from `docs/demo/hledit-mcp-demo.mjs`.
- [ ] Render `docs/demo/hledit-mcp.gif` for README above-fold proof.
- [ ] Keep `docs/demo/transcript.md` as deterministic text proof for reviewers and package pages.

## MCP contract parity

- [x] Accept structured `edits` arrays for `op:'batch'` while keeping the legacy JSON string form.
- [x] Add edit/batch line delta summaries (`Lines: +N -M`) when `hledit >= 1.2.4` provides `linesAdded` / `linesDeleted`; older `hledit` versions should continue working without that summary.
- [x] Format successful `edit` results as concise human-readable summaries instead of raw JSON where possible.
- [x] Align MCP server runtime version metadata with `package.json` during build/release.
- [x] Clean up batch `edits` schema/docs to describe `replace` / `delete` / `insert` batch ops accurately.
- [ ] Consider optional structured result metadata for raw JSON/diff/patch data if MCP clients benefit, while keeping text output compact.

## Marketplace/listing

- [ ] Identify one MCP server directory or Claude/MCP listing surface.
- [ ] Submit after README demo proof and install docs are current.
