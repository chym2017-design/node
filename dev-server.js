// Kimi Work / local development entry point.
// Forward the familiar Vite-style --host and --port flags to the existing UDD server.
const args = process.argv.slice(2);
let port = '';
let host = '';

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--port' && args[i + 1]) port = args[++i];
  else if (arg.startsWith('--port=')) port = arg.slice('--port='.length);
  else if (arg === '--host' && args[i + 1]) host = args[++i];
  else if (arg.startsWith('--host=')) host = arg.slice('--host='.length);
}

if (port) process.env.UDD_PORT = port;
if (host) process.env.UDD_HOST = host;
// Do not let server.js reinterpret wrapper flags as its legacy [port] [root] arguments.
process.argv = [process.argv[0], require.resolve('./server.js')];
require('./server.js');
