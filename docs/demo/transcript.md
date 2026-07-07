# hledit-mcp deterministic MCP transcript

This transcript uses a real MCP stdio client against `dist/index.js`.
`hledit-mcp` calls the configured `hledit` CLI; this script does not call `hledit` directly.

Temp workspace: created with `mkdtemp` and removed after the run.

## tools/list
```text
hledit — Read, edit, or batch-edit files using hash-anchored line references (LN#HASH). Use op:'read' to get anchors, op:'edit' for single changes, op:'batch' for multiple edits in one call. Anchors come from the most recent read and detect stale context before any write.
```

## Initial file
```text
count = 1
```

## MCP tools/call: read
```text
1#YN:count = 1
```
Captured stale-prone anchor: `1#YN`

## External actor changes file after read
```text
count = 2
```

## MCP tools/call: edit with old anchor
```text
Edit failed.
Error: stale
Message: anchor 1#YN: stale
Remaps:
- 1#YN -> 1#TP
```

## Re-read for fresh anchor
```text
1#TP:count = 2
```
Fresh anchor: `1#TP`

## MCP tools/call: edit with fresh anchor
```text
{"ok":true,"firstChangedLine":1,"lastChangedLine":1}
```

## Final file
```text
count = 3
```
