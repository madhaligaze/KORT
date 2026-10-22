/**
 * Локальный фронт: тот же Next, что отдаёт kort.cards, собранный из того же
 * коммита (`scripts/prepare-web.mjs`), - отдельным процессом на свободном
 * порту. Окно открывает его через шлюз (`gateway.ts`), поэтому интерфейс
 * открывается и тогда, когда до kort.cards не достучаться.
 */
import http from "node:http";
import net from "node:net";
import path from "node:path";

import { type UtilityProcess, utilityProcess } from "electron";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/", timeout: 1000 }, (response) => {
      response.resume();
      resolve((response.statusCode ?? 500) < 500);
    });
    request.on("error", () => resolve(false));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
  });
}

export async function startWeb(dir: string, log: (line: string) => void): Promise<{ port: number; child: UtilityProcess }> {
  const port = await freePort();
  const child = utilityProcess.fork(path.join(dir, "start.js"), [], {
    cwd: dir,
    serviceName: "KORT",
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  child.stdout?.on("data", (chunk: Buffer) => log(`web: ${chunk.toString().trim()}`));
  child.stderr?.on("data", (chunk: Buffer) => log(`web: ${chunk.toString().trim()}`));
  let exited: number | null = null;
  child.once("exit", (code) => {
    exited = code;
    log(`web: процесс вышел с кодом ${code}`);
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`фронт завершился с кодом ${exited}`);
    if (await answers(port)) return { port, child };
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  child.kill();
  throw new Error("фронт не ответил за 30 секунд");
}
