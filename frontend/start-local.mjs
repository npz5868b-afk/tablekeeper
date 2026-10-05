import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const frontend = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], {
  stdio: "inherit",
  env: process.env
});
const concierge = spawn(process.execPath, [fileURLToPath(new URL("../concierge/src/server.mjs", import.meta.url))], {
  stdio: "inherit",
  env: process.env
});
const children = [frontend, concierge];
let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill();
  process.exitCode = exitCode;
}

for (const child of children) {
  child.once("error", error => {
    console.error("[local-runtime] process_start_failed", { code:error.code ?? "UNKNOWN" });
    stop(1);
  });
  child.once("exit", code => {
    if (!stopping) {
      console.error("[local-runtime] required_process_exited", { code:code ?? 1 });
      stop(code || 1);
    }
  });
}
process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));
