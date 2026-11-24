#!/bin/sh
# Wrapper do Megacubo dentro do sandbox do Flatpak.
# O zypak permite correr o Electron sem --no-sandbox no bubblewrap.
export TMPDIR="${XDG_RUNTIME_DIR}/app/${FLATPAK_ID}"
exec zypak-wrapper /app/megacubo/megacubo "$@"
