import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Key } from "../vault/crypto.js";

/*
 * A session keeps the vault's key in the memory of a small background process
 * (an agent, as in ssh-agent), so the master password is not asked for again
 * for a while. The key never touches the disk: commands fetch it over a Unix
 * socket that only this user can reach, and the agent exits when time is up.
 */

export const COMMAND = "__agent";
export const MINUTES = 15;

const GET = "G";
const QUIT = "Q";
const KEY_SIZE = 32 + 32 + 3; // key, salt, scrypt parameters

export interface Session {
  /** The key held for this vault, if a session is running. */
  key: (vault: string) => Promise<Key | undefined>;
  /** Returns false where sessions are not available. */
  start: (vault: string, key: Key) => boolean;
  end: (vault: string) => Promise<void>;
}

// One socket per vault, in a directory nobody else can enter. Undefined where
// that cannot be guaranteed, which simply means no sessions (as on Windows).
function address(vault: string): string | undefined {
  const uid = process.getuid?.();
  if (uid === undefined) return undefined;

  const runtime = process.env.XDG_RUNTIME_DIR;
  const dir = runtime ? path.join(runtime, "kairos") : path.join(tmpdir(), `kairos-${uid}`);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const info = lstatSync(dir);
    if (!info.isDirectory() || info.uid !== uid || info.mode & 0o077) return undefined;
  } catch {
    return undefined;
  }
  const id = createHash("sha256").update(vault).digest("hex").slice(0, 16);
  return path.join(dir, `${id}.sock`);
}

// Sends one request and resolves with whatever the agent answers; empty if there is none.
function request(socket: string, command: string): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const connection = net.connect(socket, () => connection.write(command));
    connection.setTimeout(1000, () => connection.destroy());
    connection.on("data", (chunk: Buffer) => chunks.push(chunk));
    connection.on("error", () => resolve(Buffer.alloc(0)));
    connection.on("close", () => resolve(Buffer.concat(chunks)));
  });
}

export const session: Session = {
  async key(vault) {
    const socket = address(vault);
    const answer = socket ? await request(socket, GET) : Buffer.alloc(0);
    if (answer.length !== KEY_SIZE) return undefined;

    const key: Key = {
      bytes: Buffer.from(answer.subarray(0, 32)),
      salt: Buffer.from(answer.subarray(32, 64)),
      params: { logN: answer[64]!, r: answer[65]!, p: answer[66]! },
    };
    answer.fill(0);
    return key;
  },

  start(vault, key) {
    const socket = address(vault);
    const script = process.argv[1];
    if (!socket || !script) return false;

    const agent = spawn(process.execPath, [script, COMMAND, socket], {
      detached: true,
      stdio: ["pipe", "ignore", "ignore"],
    });
    agent.on("error", () => {
      // No agent only means the password is asked for again next time.
    });
    // Over a pipe: never in the arguments or the environment, where others could read it.
    const { logN, r, p } = key.params;
    agent.stdin?.end(Buffer.concat([key.bytes, key.salt, Buffer.from([logN, r, p])]));
    agent.unref();
    return true;
  },

  async end(vault) {
    const socket = address(vault);
    if (socket) await request(socket, QUIT);
  },
};

/** The body of the agent process: hold the key it is given on stdin, serve it, then exit. */
export async function serve(socket: string): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const secret = Buffer.concat(chunks);
  // Checked on every request as well as by the timer, which stands still while the machine sleeps.
  const deadline = Date.now() + MINUTES * 60_000;

  const stop = () => {
    secret.fill(0);
    rmSync(socket, { force: true });
    process.exit(0);
  };

  const server = net.createServer((connection) => {
    connection.on("error", () => connection.destroy());
    connection.once("data", (command: Buffer) => {
      if (Date.now() > deadline || command.toString() === QUIT) stop();
      else connection.end(secret);
    });
  });

  rmSync(socket, { force: true });
  server.on("error", stop);
  server.listen(socket, () => chmodSync(socket, 0o600));
  setTimeout(stop, MINUTES * 60_000);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, stop);
}
