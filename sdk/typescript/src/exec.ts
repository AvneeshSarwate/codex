import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { SandboxMode } from "./threadOptions";

export type CodexExecArgs = {
  input: string;

  baseUrl?: string;
  apiKey?: string;
  threadId?: string | null;
  // --model
  model?: string;
  // --sandbox
  sandboxMode?: SandboxMode;
  // --cd
  workingDirectory?: string;
  // --skip-git-repo-check
  skipGitRepoCheck?: boolean;
  // --output-schema
  outputSchemaFile?: string;
};

const INTERNAL_ORIGINATOR_ENV = "CODEX_INTERNAL_ORIGINATOR_OVERRIDE";
const TYPESCRIPT_SDK_ORIGINATOR = "codex_sdk_ts";

export class CodexExec {
  private executablePath: string;
  constructor(executablePath: string | null = null) {
    this.executablePath = executablePath || findCodexPath();
  }

  async *run(args: CodexExecArgs): AsyncGenerator<string> {
    // Agent instrumentation hook: capture the raw invocation surface that
    // ultimately determines model/agent configuration for the turn. Emit a
    // "command prepared" event containing `commandArgs`, the original `args`
    // payload, and any defaults that were injected so the visualization can
    // show model/sandbox selections before the process launches.
    const commandArgs: string[] = ["exec", "--experimental-json"];

    if (args.model) {
      commandArgs.push("--model", args.model);
    }

    if (args.sandboxMode) {
      commandArgs.push("--sandbox", args.sandboxMode);
    }

    if (args.workingDirectory) {
      commandArgs.push("--cd", args.workingDirectory);
    }

    if (args.skipGitRepoCheck) {
      commandArgs.push("--skip-git-repo-check");
    }

    if (args.outputSchemaFile) {
      commandArgs.push("--output-schema", args.outputSchemaFile);
    }

    if (args.threadId) {
      commandArgs.push("resume", args.threadId);
    }

    const env = {
      ...process.env,
    };
    if (!env[INTERNAL_ORIGINATOR_ENV]) {
      env[INTERNAL_ORIGINATOR_ENV] = TYPESCRIPT_SDK_ORIGINATOR;
    }
    if (args.baseUrl) {
      env.OPENAI_BASE_URL = args.baseUrl;
    }
    if (args.apiKey) {
      env.CODEX_API_KEY = args.apiKey;
    }

    // Agent instrumentation hook: this spawn() boundary represents the start
    // of a Codex sub-agent lifecycle. Emit `this.executablePath`,
    // `commandArgs`, and the resolved `env` so the timeline can line up CLI
    // launches with downstream tool call / model streaming events.
    const child = spawn(this.executablePath, commandArgs, {
      env,
    });

    let spawnError: unknown | null = null;
    child.once("error", (err) => (spawnError = err));

    if (!child.stdin) {
      child.kill();
      throw new Error("Child process has no stdin");
    }
    // Agent instrumentation hook: log the exact JSON payload string (`args.input`)
    // and any derived sampling parameters before control transfers to the Rust
    // backend. Emit a "prompt dispatched" event that references the thread id
    // and model so the UI can correlate CLI calls with backend turns.
    child.stdin.write(args.input);
    child.stdin.end();

    if (!child.stdout) {
      child.kill();
      throw new Error("Child process has no stdout");
    }
    const stderrChunks: Buffer[] = [];

    if (child.stderr) {
      child.stderr.on("data", (data) => {
        stderrChunks.push(data);
      });
    }

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    try {
      for await (const line of rl) {
        // Agent instrumentation hook: every JSONL line is a discrete agent
        // state transition (`thread.*`, `turn.*`, `item.*`). Forward each `line`
        // to the visualization layer verbatim (and optionally parse it) so the
        // browser can render a live timeline without re-reading stdout later.
        // `line` is a string (Node sets default encoding to utf8 for readline)
        yield line as string;
      }

      const exitCode = new Promise((resolve, reject) => {
        child.once("exit", (code) => {
          if (code === 0) {
            resolve(code);
          } else {
            const stderrBuffer = Buffer.concat(stderrChunks);
            reject(
              new Error(`Codex Exec exited with code ${code}: ${stderrBuffer.toString("utf8")}`),
            );
          }
        });
      });

      if (spawnError) throw spawnError;
      await exitCode;
    } finally {
      rl.close();
      child.removeAllListeners();
      try {
        if (!child.killed) child.kill();
      } catch {
        // ignore
      }
    }
  }
}

const scriptFileName = fileURLToPath(import.meta.url);
const scriptDirName = path.dirname(scriptFileName);

function findCodexPath() {
  const { platform, arch } = process;

  let targetTriple = null;
  switch (platform) {
    case "linux":
    case "android":
      switch (arch) {
        case "x64":
          targetTriple = "x86_64-unknown-linux-musl";
          break;
        case "arm64":
          targetTriple = "aarch64-unknown-linux-musl";
          break;
        default:
          break;
      }
      break;
    case "darwin":
      switch (arch) {
        case "x64":
          targetTriple = "x86_64-apple-darwin";
          break;
        case "arm64":
          targetTriple = "aarch64-apple-darwin";
          break;
        default:
          break;
      }
      break;
    case "win32":
      switch (arch) {
        case "x64":
          targetTriple = "x86_64-pc-windows-msvc";
          break;
        case "arm64":
          targetTriple = "aarch64-pc-windows-msvc";
          break;
        default:
          break;
      }
      break;
    default:
      break;
  }

  if (!targetTriple) {
    throw new Error(`Unsupported platform: ${platform} (${arch})`);
  }

  const vendorRoot = path.join(scriptDirName, "..", "vendor");
  const archRoot = path.join(vendorRoot, targetTriple);
  const codexBinaryName = process.platform === "win32" ? "codex.exe" : "codex";
  const binaryPath = path.join(archRoot, "codex", codexBinaryName);

  return binaryPath;
}
