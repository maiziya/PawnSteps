import { cp, access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
  if (args[index] === "--port" && /^\d+$/.test(args[index + 1] || "")) process.env.PORT = args[index + 1];
  else if (args[index] === "--hostname" && args[index + 1]) process.env.HOSTNAME = args[index + 1];
  else throw new Error("Usage: npm start -- [--port 3000] [--hostname 127.0.0.1]");
}
const standalone = resolve(".next/standalone");
try { await access(resolve(standalone, "server.js")); }
catch { throw new Error("Run npm run build before starting the production server."); }
await mkdir(resolve(standalone, ".next"), { recursive: true });
await cp(resolve(".next/static"), resolve(standalone, ".next/static"), { recursive: true });
await cp(resolve("public"), resolve(standalone, "public"), { recursive: true });
process.env.HOSTNAME ||= "127.0.0.1";
process.env.PORT ||= "3000";
await import(pathToFileURL(resolve(standalone, "server.js")).href);
