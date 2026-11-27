#!/bin/sh
# Launcher for Megacubo inside the Flatpak sandbox.
# zypak replaces the --no-sandbox fallback and the SUID chrome-sandbox helper.
export TMPDIR="${XDG_RUNTIME_DIR}/app/${FLATPAK_ID}"
exec zypak-wrapper /app/megacubo/megacubo.real "$@"