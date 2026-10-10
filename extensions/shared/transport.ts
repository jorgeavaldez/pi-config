import { spawn } from "node:child_process";
import { Type, type Static } from "typebox";

// Never option-shaped: the host follows `--` on the ssh command line.
export const hostSchema = Type.String({ pattern: "^[A-Za-z0-9_][A-Za-z0-9_.@:\\[\\]-]*$", maxLength: 255 });
export const transportSchema = Type.Object({
  stdout: Type.String(), stderr: Type.String(), exit_code: Type.Union([Type.Integer(), Type.Null()]),
  signal: Type.Union([Type.String(), Type.Null()]), timed_out: Type.Boolean(), cancelled: Type.Boolean(),
  output_limited: Type.Boolean(), spawn_error: Type.Union([Type.String(), Type.Null()]),
}, { additionalProperties: false });
export type Transport = Static<typeof transportSchema>;

export function quote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// The remote login shell is zsh; -lic gives the script the host's interactive PATH.
export function ssh(host: string, script: string): { executable: string; argv: string[] } {
  let executable = "ssh";
  // On Windows only the system OpenSSH client reaches the Windows ssh-agent; an MSYS ssh earlier on PATH does not.
  if (process.platform === "win32") {
    if (!process.env.windir) throw new Error("windir is not set, so the Windows OpenSSH client cannot be located.");
    executable = `${process.env.windir}\\System32\\OpenSSH\\ssh.exe`;
  }
  return {
    executable,
    argv: ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", host, `zsh -lic ${quote(script)}`],
  };
}

// pi.exec has no stdin transport. Timeout and cancellation kill only this client process.
export function execute(executable: string, argv: string[], input: string, timeout: number, signal: AbortSignal | undefined): Promise<Transport> {
  const result: Transport = {
    stdout: "", stderr: "", exit_code: null, signal: null,
    timed_out: false, cancelled: false, output_limited: false, spawn_error: null,
  };
  if (signal?.aborted) return Promise.resolve({ ...result, cancelled: true });
  return new Promise((resolve) => {
    const child = spawn(executable, argv, { stdio: ["pipe", "pipe", "pipe"] });
    const abort = () => { result.cancelled = true; child.kill("SIGKILL"); };
    const timer = setTimeout(() => { result.timed_out = true; child.kill("SIGKILL"); }, timeout);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const capture = (key: "stdout" | "stderr", chunk: string) => {
      // Bound both diagnostics and reads, including a single unusually long terminal line.
      const room = 262144 - result[key].length;
      result[key] += chunk.slice(0, Math.max(0, room));
      if (chunk.length > room) { result.output_limited = true; child.kill("SIGKILL"); }
    };
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => capture("stdout", chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => capture("stderr", chunk));
    child.on("error", (error) => { result.spawn_error = error.message; });
    // An early exit can close stdin before the input is written (EPIPE).
    child.stdin.on("error", (error) => { result.spawn_error ??= error.message; });
    child.on("close", (code, exitSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      result.exit_code = code;
      result.signal = exitSignal;
      resolve(result);
    });
    child.stdin.end(input);
  });
}
