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
| `breakdown` | one property grouped by another, with aggregates |

Two of these deserve emphasis, because they cover what the others cannot. **Only `search_events`
finds deeds**, which appear in no property; **only `search_properties` finds goals and
affiliations**, which appear in no event.

And `base_rates` is the one to reach for before concluding anything. A trait shared by three
notable figures looks like a pattern until you learn that half the world shares it — most properties
are recorded for only part of the objects, so the tool reports both denominators rather than letting
you assume one.

`breakdown` is the one to reach for when the question has two halves — *age at death by caste*,
*casualties by attacker race*. The other tools each read a single property, so such a question used
to be answered by pulling the objects and joining them by hand, which for the classic API means
recovering ids from HTML anchors. Do not do that: if a property needed for the join is missing, add
it as a facet in the backend instead.

Arguments are validated strictly: an unknown parameter is an error, not a silently dropped key. The
tool's cap is `maxEvents` for both detail levels, whereas the backend route behind the digest calls
it `maxNotableEvents` — passing the backend's name used to look like it worked while the server
default applied instead.

## Two habits worth having

**Ask for the digest first.** `read_object` defaults to it. The full dossier of a large civilization
can exceed 600 KB, most of it recurring festivals; the digest is around 17 KB and keeps the events
that are rare for that object.

**Filter event searches when you can.** There is no index — the text only exists once the prose has
been rendered — so an unfiltered search on a large world renders every event and takes a few
seconds. Passing `eventTypes` brings it to milliseconds.

**Drop `q` to read history rather than search it.** `search_events` with only `fromYear`/`toYear`
returns everything that happened then, which is the one question no keyword can express. It is also
the fastest call in the set: with no text to match, nothing is rendered at all — a full year of a
494,436 event world comes back in 9 ms.

## Development

```bash
npm test          # unit tests, plus an in-memory MCP client exercising every tool
npm run watch     # recompile on change
```

The tests use no network: the HTTP client is stubbed, and the MCP surface is driven through the
SDK's in-memory transport.

## License

MIT.
