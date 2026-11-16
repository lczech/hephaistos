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
export const RETRY = 5_000; // ms between tries while the Daemon does not run

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Tries until the GUI loads; starting the Daemon only when told to, not on every retry. */
export class Connector {
  private attempt = 0; // a newer attempt ends older ones
  private timer: ReturnType<typeof setTimeout> | undefined;
  private loadedAt = Number.NEGATIVE_INFINITY; // when it last gave the GUI to load

  constructor(private readonly steps: Steps) {}

  /** Tries at once, starting the Daemon if it does not run; then every RETRY, without. */
  now(): Promise<void> {
    return this.connect(true);
  }

  /**
   * After a load of the Server failed: tries as `now` does, but not sooner than RETRY after the
   * GUI was last given to load, so that a Server whose page keeps failing is not asked again
   * and again, each time by a hephaistos process.
   */
  afterFailedLoad(): Promise<void> {
    const wait = this.loadedAt + RETRY - Date.now();
    if (wait <= 0) return this.now();
    this.stop();
    this.timer = setTimeout(() => void this.connect(true), wait);
    return Promise.resolve();
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
    if (link.ok) return this.load(link.output);
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
      if (again.ok) return this.load(again.output);
      reason = again.reason;
    }
    this.retry(reason);
  }

  private load(link: string): void {
    this.loadedAt = Date.now();
    this.steps.load(link);
  }

  private retry(reason: string): void {
    this.steps.show({ state: "down", reason });
    this.timer = setTimeout(() => void this.connect(false), RETRY);
  }
}
