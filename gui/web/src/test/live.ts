// A stand-in for the browser's WebSocket: connections the tests open, feed and drop by hand.

/** One connection: it stays connecting until a test opens it. */
export class FakeSocket {
  static opened: FakeSocket[] = [];
  readonly url: string;
  readonly sent: string[] = [];
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeSocket.opened.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  /** The Server accepts it. */
  open(): void {
    this.onopen?.(new Event("open"));
  }

  /** The Server sends a message. */
  receive(message: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) }));
  }

  /** The Server closes it, or it breaks (1006). */
  drop(code = 1006, reason = ""): void {
    this.closed = true;
    this.onclose?.({ code, reason } as CloseEvent);
  }
}

/** The latest connection opened. */
export function lastSocket(): FakeSocket {
  const socket = FakeSocket.opened.at(-1);
  if (socket === undefined) throw new Error("no live connection was opened");
  return socket;
}
