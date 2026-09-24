#!/bin/sh
# Install the pinned Trafilatura environment. Does not contact a worker host.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
TARGET=${1:?usage: install.sh /path/to/venv}
python3 -m venv "$TARGET"
"$TARGET/bin/pip" install --disable-pip-version-check -r "$ROOT/requirements.txt"
printf '%s\n' "Installed the pinned Trafilatura environment into $TARGET"
printf '%s\n' "Put $TARGET/bin on PATH before starting the Media Lens worker."
