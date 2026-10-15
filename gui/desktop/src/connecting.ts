// Reaching this Machine's Server: the GUI once hephaistos gives its link, else a page saying
// why, while the Daemon starts or until it runs.

import { LINK, type Run, START } from "./hephaistos.js";

export type Waiting = { state: "starting" } | { state: "down"; reason: string };

export interface Steps {
  run: Run;
  load(link: string): void;
  show(waiting: Waiting): void;
}

export const LISTEN_WAIT = 10_000; // ms a started Daemon gets for its Server to listen
export const POLL = 500; // ms between asking for the link meanwhile
export const RETRY = 5_000; // ms between tries while the Daemon doesn't run

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Tries until the GUI loads; starting the Daemon only when told to, not on every retry. */
export class Connector {
  private attempt = 0; // a newer attempt ends older ones
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly steps: Steps) {}

  /** Tries at once, starting the Daemon if it doesn't run; then every RETRY, without. */
  now(): Promise<void> {
    return this.connect(true);
  }

  stop(): void {
    this.attempt += 1;
    clearTimeout(this.timer);
  }

  private async connect(start: boolean): Promise<void> {
    this.stop();
    const attempt = this.attempt;
    const ended = () => attempt !== this.attempt;
    const link = await this.steps.run(LINK);
    if (ended()) return;
    if (link.ok) return this.steps.load(link.output);
    if (!start) return this.retry(link.reason);
    this.steps.show({ state: "starting" });
    const started = await this.steps.run(START);
    if (ended()) return;
    if (!started.ok) return this.retry(started.reason);
    let reason = link.reason;
    for (const deadline = Date.now() + LISTEN_WAIT; Date.now() < deadline; ) {
      await sleep(POLL);
      if (ended()) return;
      const again = await this.steps.run(LINK);
      if (ended()) return;
      if (again.ok) return this.steps.load(again.output);
      reason = again.reason;
    }
    this.retry(reason);
  }

  private retry(reason: string): void {
    this.steps.show({ state: "down", reason });
    this.timer = setTimeout(() => void this.connect(false), RETRY);
  }
}
