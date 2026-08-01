#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const server = createServer();
const transport = new StdioServerTransport();

// stdout carries the protocol, so anything diagnostic has to go to stderr.
await server.connect(transport);
console.error("legendsviewer-mcp ready on stdio");
