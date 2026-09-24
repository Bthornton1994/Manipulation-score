#!/bin/sh
# Install the pinned Trafilatura environment. Does not contact a worker host.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
TARGET=${1:?usage: install.sh /path/to/venv}
# numpy 2.5.3 in requirements.txt requires Python 3.12 or newer.
if ! python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)'; then
  printf '%s\n' "Python 3.12 or newer is required to install the pinned Trafilatura environment." >&2
  exit 1
fi
python3 -m venv "$TARGET"
"$TARGET/bin/pip" install --disable-pip-version-check -r "$ROOT/requirements.txt"
printf '%s\n' "Installed the pinned Trafilatura environment into $TARGET"
printf '%s\n' "Put $TARGET/bin on PATH before starting the Media Lens worker."
