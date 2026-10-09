#!/usr/bin/env node
import { startServer } from './src/server.js';

const args = process.argv.slice(2);
let port = Number(process.env.PORT || 3000);

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--port' && args[i + 1]) {
    port = Number(args[i + 1]);
    i += 1;
  } else if (arg.startsWith('--port=')) {
    port = Number(arg.slice('--port='.length));
  }
}

if (!Number.isInteger(port) || port <= 0) {
  console.error('Invalid port value.');
  process.exit(1);
}

startServer(port).catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
