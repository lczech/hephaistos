// The hephaistos command, which knows this Machine's Daemon: the Desktop asks it, never the files.

import { execFile } from "node:child_process";

/** What a command printed: its output if it succeeded, else why it failed. */
export type Outcome = { ok: true; output: string } | { ok: false; reason: string };

export type Run = (args: string[]) => Promise<Outcome>;

export const LINK = ["daemon", "token", "--url"]; // the GUI's address, with the token
export const START = ["daemon", "start"];

const TIMEOUT = 30_000; // ms; starting waits for the Daemon, up to 10 s

/** The reason in a failed command's stderr: its error, else its last line. */
export function reason(stderr: string, fallback: string): string {
  const lines = stderr.trim().split("\n");
  const error = lines.findLast((line) => line.startsWith("error: "));
  return (error?.slice("error: ".length) ?? lines.at(-1)?.trim()) || fallback;
}

/** Runs `executable` (the hephaistos that started the Desktop), with this process's settings. */
export function runner(executable: string): Run {
  return (args) =>
    new Promise((resolve) => {
      execFile(executable, args, { timeout: TIMEOUT }, (error, stdout, stderr) => {
        if (error === null) resolve({ ok: true, output: stdout.trim() });
        else resolve({ ok: false, reason: reason(stderr, error.message) });
      });
    });
}
