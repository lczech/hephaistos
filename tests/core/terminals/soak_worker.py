"""One process of `test_soak.py`: random creates, renames and kills of the Terminals of this
Machine.

Usage: soak_worker.py <seed> <operations> <directory>. Prints each Terminal it created, as JSON
with its ID and command, one per line. Refusals a racing process meets (a name taken, a Terminal
gone meanwhile) are expected; anything else ends it with a traceback.
"""

import json
import random
import sys
from pathlib import Path

from hephaistos.core.db.sessions import read_session
from hephaistos.core.state import terminals
from hephaistos.core.terminals import actions
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths

NAMES = 12  # few, so that processes often want the same one


def main(seed: int, operations: int, directory: Path) -> None:
    rng = random.Random(seed)  # noqa: S311 - test data, repeatable from its seed
    paths = Paths.from_environment()
    for _ in range(operations):
        with read_session(paths) as session:
            names = [state.name for state in terminals.on_this_machine(session)]
        action = rng.choice(["create", "create", "rename", "kill"] if names else ["create"])
        try:
            if action == "create":
                name = rng.choice([None, f"t{rng.randrange(NAMES)}"])
                command = rng.choice([None, ["sleep", "600"]])
                created = actions.create(paths, directory, name=name, command=command)
                sys.stdout.write(json.dumps({"id": str(created.id), "command": command}) + "\n")
                sys.stdout.flush()
            elif action == "rename":
                actions.rename(paths, rng.choice(names), f"t{rng.randrange(NAMES)}")
            else:
                actions.kill(paths, rng.choice(names))
        except HephaistosError:
            pass


if __name__ == "__main__":
    main(int(sys.argv[1]), int(sys.argv[2]), Path(sys.argv[3]))
