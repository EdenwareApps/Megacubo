#!/bin/sh
# Launcher do Megacubo dentro do sandbox do Flatpak.
# O zypak dispensa --no-sandbox e o helper SUID chrome-sandbox.
export TMPDIR="${XDG_RUNTIME_DIR}/app/${FLATPAK_ID}"
exec zypak-wrapper /app/megacubo/megacubo.real "$@"
