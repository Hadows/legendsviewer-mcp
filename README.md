# legendsviewer-mcp

An [MCP](https://modelcontextprotocol.io) server that lets a language model read and query the
history of a **Dwarf Fortress** world: search the deeds recorded in the legends, read the biography
of a figure or the history of a civilization, and check whether what looks remarkable actually is.

It is a thin client over the analysis API added by
[LegendsViewer-AIPowered](https://github.com/Hadows/LegendsViewer-AIPowered), a fork of
[Kromtec/LegendsViewer-Next](https://github.com/Kromtec/LegendsViewer-Next).

## Requirements

**LegendsViewer-AIPowered must be running.** This server owns no world state: parsing a large export
takes about 30 seconds and 800 MB, which is fine once per application run and unacceptable per MCP
session. It therefore queries a long-lived backend rather than loading anything itself.

```bash
# in the LegendsViewer-AIPowered checkout
dotnet run --project LegendsViewer.Backend
```

A stock LegendsViewer-Next will not work: it has no `/api/Analysis` routes. `world_status` says so
explicitly if you point this at one.

## Install

```bash
npm install
npm run build
```

Then register it with your MCP client. For Claude Code:

```json
{
  "mcpServers": {
    "legendsviewer": {
      "command": "node",
      "args": ["/absolute/path/to/legendsviewer-mcp/dist/index.js"]
    }
  }
}
```

Set `LEGENDSVIEWER_URL` if the backend does not listen on `http://localhost:15421`.

## Tools

| Tool | Purpose |
|---|---|
| `world_status` | is the backend reachable, is a world loaded, which object types exist |
| `list_worlds` | worlds opened before, with the XML path each loads from |
| `load_world` | parse an export into memory (~30 s) |
| `world_summary` | overview: civilizations, eras, wars, most eventful figures |
| `read_object` | one object's history, `full` or `digest` |
| `search_objects` | find by name |
| `search_properties` | find by goal, race, position, affiliation |
| `search_events` | full text search over the prose of every event |
| `base_rates` | how common a property value is |
| `rankings` | who holds the maximum of a numeric measure |

Two of these deserve emphasis, because they cover what the others cannot. **Only `search_events`
finds deeds**, which appear in no property; **only `search_properties` finds goals and
affiliations**, which appear in no event.

And `base_rates` is the one to reach for before concluding anything. A trait shared by three
notable figures looks like a pattern until you learn that half the world shares it — most properties
are recorded for only part of the objects, so the tool reports both denominators rather than letting
you assume one.

## Two habits worth having

**Ask for the digest first.** `read_object` defaults to it. The full dossier of a large civilization
can exceed 600 KB, most of it recurring festivals; the digest is around 17 KB and keeps the events
that are rare for that object.

**Filter event searches when you can.** There is no index — the text only exists once the prose has
been rendered — so an unfiltered search on a large world renders every event and takes a few
seconds. Passing `eventTypes` brings it to milliseconds.

## Development

```bash
npm test          # unit tests, plus an in-memory MCP client exercising every tool
npm run watch     # recompile on change
```

The tests use no network: the HTTP client is stubbed, and the MCP surface is driven through the
SDK's in-memory transport.

## License

MIT.
