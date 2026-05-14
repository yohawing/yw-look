#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
helper="$repo_root/src-tauri/alembic-tools/arm64-osx/abc_to_obj"

if [[ "${RUNNER_OS:-}" != "macOS" && "$(uname -s)" != "Darwin" ]]; then
  echo "Skipping macOS helper signing on non-macOS host."
  exit 0
fi

if [[ ! -f "$helper" ]]; then
  echo "::error::missing Alembic helper at $helper"
  exit 1
fi

if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  echo "APPLE_SIGNING_IDENTITY is not set; leaving Alembic helper unsigned for local build."
  exit 0
fi

codesign \
  --force \
  --options runtime \
  --timestamp \
  --sign "$APPLE_SIGNING_IDENTITY" \
  "$helper"

codesign --verify --strict --verbose=2 "$helper"
