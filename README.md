# hledit-mcp

`hledit-mcp` is an MCP server exposing [`hledit`](https://github.com/dabito/hledit)'s hash-anchored file edits to any MCP-compatible AI coding agent — Claude Code, Claude Desktop, Cursor, and others.

Same idea as [`pi-hledit`](https://github.com/dabito/pi-hledit) (the Pi-native integration), but over MCP instead of Pi's extension API, so it reaches every MCP host, not just Pi.

Instead of asking an agent to reproduce old text exactly, `hledit read` annotates each line with a stable anchor:

```text
5#HY:func main() {
6#MX:    fmt.Println("hello")
7#NP:}
```

Write commands reference anchors such as `6#MX`. Before changing the file, `hledit` recomputes the hash at that line. If the file changed since it was read, the anchor is rejected and no write happens — the agent gets a `stale` error and a remap hint instead of silently corrupting the wrong line.

## Why MCP, separately from pi-hledit

`pi-hledit` and `hledit-mcp` share the same tool contract (`core.ts` in this repo — arg-building, batch translation, result formatting) and the same underlying `hledit` CLI. Only the registration/execution glue differs: `pi-hledit` wires that contract into Pi's `registerTool`, this wires it into `@modelcontextprotocol/sdk`'s `McpServer`. MCP has no equivalent of Pi's `renderCall`/`renderResult` terminal rendering, so this package doesn't have one either — that layer is genuinely Pi-specific chrome, not part of the portable tool contract.

## Requirements

- [Go 1.21+](https://go.dev/) to install the `hledit` CLI (or a prebuilt binary on `PATH`)
- Node.js 18+
- An MCP-compatible client

## Install

Install the `hledit` CLI first:

```bash
go install github.com/dabito/hledit@latest
```

Then configure your MCP client to run `hledit-mcp`. For Claude Code:

```bash
claude mcp add hledit npx hledit-mcp
```

Or add it manually to your client's MCP server config:

```json
{
  "mcpServers": {
    "hledit": {
      "command": "npx",
      "args": ["hledit-mcp"]
    }
  }
}
```

### Configuration

| Variable     | Default              | Description                                                        |
| ------------ | --------------------- | ------------------------------------------------------------------- |
| `HLEDIT_BIN` | `hledit` (on `PATH`) | Path to the `hledit` binary, if not on `PATH`.                     |
| `HLEDIT_CWD` | server's `process.cwd()` | Working directory `hledit` resolves relative paths against.     |

## Tool

### `hledit`

One tool, three operations, matching `pi-hledit`'s contract exactly:

| `op`    | Purpose                                            |
| ------- | --------------------------------------------------- |
| `read`  | Annotate lines with `LN#HASH` anchors               |
| `edit`  | Apply a single replace/insert/delete/replace-range  |
| `batch` | Apply multiple anchor-referenced edits in one call  |

| Name         | Type    | Required           | Description                                                          |
| ------------ | ------- | ------------------ | ---------------------------------------------------------------------- |
| `op`         | string  | ✓                  | `"read"`, `"edit"`, or `"batch"`                                      |
| `path`       | string  | ✓                  | File path                                                             |
| `offset`     | number  |                    | 1-indexed starting line (`read`)                                      |
| `limit`      | number  |                    | Max lines to return (`read`)                                          |
| `grep`       | string  |                    | Filter lines by substring (`read`)                                    |
| `action`     | string  |                    | `replace`, `insert`, `delete`, or `replace-range` (`edit`)             |
| `anchor`     | string  | for `edit`/`batch` | `LN#HASH` anchor, e.g. `12#NK`                                        |
| `end_anchor` | string  |                    | End anchor for `replace-range`/range delete                           |
| `content`    | string  |                    | Replacement/inserted content; empty = delete                          |
| `after`      | boolean |                    | For `action:"insert"`, insert after the anchor                       |
| `edits`      | string  | for `batch`        | JSON array of batch edit ops                                          |

Workflow: `read` to get anchors → `edit` (single change) or `batch` (multiple). If an edit returns `stale`, re-read to get fresh anchors before retrying — the anchor's line moved or changed since it was read.

## Development

```bash
npm install
npm test          # typecheck + build + unit/e2e tests + lint
npm run build      # compile index.ts+core.ts to dist/index.js
npm start         # run the server directly from source via tsx (stdio transport)
```

Unit tests in `core.test.ts` cover the same contract as `pi-hledit`'s test suite, minus the Pi-specific rendering assertions (there's no render layer here). `e2e.test.ts` drives the built `dist/index.js` over a real MCP stdio handshake with `@modelcontextprotocol/sdk`'s own `Client`/`StdioClientTransport` — the same artifact `npx hledit-mcp` runs, not just the TypeScript source.

The published `bin`/`main` point at `dist/index.js`, built with esbuild (`build.mjs`) and run via plain `node` — this keeps the `>=18` Node requirement honest. Running `index.ts` directly with `node` (no tsx) only works on Node ≥22.6, which has built-in TypeScript type-stripping; older LTS versions have no such support at all.

## Related packages

- [`hledit`](https://github.com/dabito/hledit) — the standalone CLI both integrations wrap.
- [`pi-hledit`](https://github.com/dabito/pi-hledit) — the Pi-native integration, same tool contract.
