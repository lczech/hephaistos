"""Prints what a Server's live connection sends, as it comes: hints and heartbeats.

Connects as a GUI does, with the token of the Machine that HEPHAISTOS_HOME names (as the CLI
finds it), to the Server its Daemon runs, or to the one at `--port`.

    uv run scripts/watch_live.py [--port 8299] [--seconds 60]
"""

import argparse
import asyncio
import json
import sys
import time

import websockets
from websockets.typing import Origin

from hephaistos.core.utils.paths import Paths
from hephaistos.daemon import status
from hephaistos.daemon.server import token


def running_port(paths: Paths) -> int | None:
    """The port of the Server that this Machine's Daemon runs, if any."""
    found = status.read(paths.state_dir)
    if found is None or found.stopped_at is not None or found.server is None:
        return None
    return found.server.port if found.server.listening else None


async def watch(port: int, secret: str, seconds: float | None) -> None:
    """Prints each message until the Server closes, or for `seconds`."""
    url = f"ws://127.0.0.1:{port}/api/live"
    started = time.monotonic()
    async with websockets.connect(url, origin=Origin(f"http://127.0.0.1:{port}")) as socket:
        await socket.send(json.dumps({"token": secret}))
        print(f"connected to {url}", flush=True)
        try:
            async with asyncio.timeout(seconds):
                async for message in socket:
                    print(f"{time.monotonic() - started:7.1f} s  {message}", flush=True)
        except TimeoutError:
            return
        except websockets.ConnectionClosed as closed:
            print(f"closed: {closed.rcvd}", flush=True)


def main() -> None:
    """Watches the Server that the arguments name."""
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    parser.add_argument("--port", type=int, help="default: that of this Machine's Daemon")
    parser.add_argument("--seconds", type=float, help="stop after this long; default: never")
    args = parser.parse_args()
    paths = Paths.from_environment()
    port = args.port or running_port(paths)
    if port is None:
        sys.exit("no Server runs here; see `hephaistos daemon status`, or give --port")
    try:
        asyncio.run(watch(port, token.token(paths), args.seconds))
    except KeyboardInterrupt:
        pass
    except (OSError, websockets.InvalidHandshake) as error:
        sys.exit(f"can't connect: {error}")


if __name__ == "__main__":
    main()
