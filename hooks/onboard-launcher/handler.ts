import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";

const PANEL_DIR = "/home/root/.openclaw/workspace/onboard-panel";
const SUPERVISOR_PID = `${PANEL_DIR}/.supervisor.pid`;

const isAlive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

const handler = async (event: any) => {
  if (event.type !== "gateway" || event.action !== "startup") {
    return;
  }

  const supervisorPath = `${PANEL_DIR}/supervisor.js`;
  if (!existsSync(supervisorPath)) {
    console.warn("[onboard-launcher] supervisor.js not found, skipping");
    return;
  }

  // Check if supervisor already running
  try {
    const pid = parseInt(readFileSync(SUPERVISOR_PID, "utf8").trim(), 10);
    if (!isNaN(pid) && isAlive(pid)) {
      console.log("[onboard-launcher] supervisor already running, skipping");
      return;
    }
  } catch {
    // not running, continue
  }

  const proc = spawn("node", ["supervisor.js"], {
    cwd: PANEL_DIR,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  proc.stdout?.on("data", (data) => {
    console.log(`[onboard-supervisor] ${data.toString().trim()}`);
  });
  proc.stderr?.on("data", (data) => {
    console.error(`[onboard-supervisor] ${data.toString().trim()}`);
  });

  proc.unref();

  event.messages?.push("⚡ Onboard Supervisor auto-started");
};

export default handler;
