#!/usr/bin/env bash
# Nightly backup of the pi-tau repository to encrypted Google Drive.
#
# A git bundle carries the complete history in one file, so a restore needs
# nothing but the bundle: `git clone pi-tau-<stamp>.bundle pi-tau`.
# Only committed work is included - uncommitted changes in /srv/pi-tau are not.
set -uo pipefail

BARE=/srv/git/pi-tau.git
WORKTREE=/srv/pi-tau
REMOTE=gcrypt:_pi-tau
RCLONE_CONF=/root/.config/rclone/rclone.conf
KEEP=14
LOGTAG=pi-tau-backup
STAMP=$(date +%Y-%m-%d_%H-%M)
TMP=$(mktemp -d /var/tmp/pi-tau-backup.XXXXXX)

log()  { logger -t "$LOGTAG" -p daemon.info -- "$*"; echo "$(date '+%F %T') $*"; }
warn() { logger -t "$LOGTAG" -p daemon.warning -- "$*"; echo "$(date '+%F %T') WARN: $*" >&2; }
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

[ -d "$BARE" ]        || { warn "kein Bare-Repo unter $BARE"; exit 1; }
[ -f "$RCLONE_CONF" ] || { warn "keine rclone-Config"; exit 1; }

# Push the working tree's commits first, so the bundle is never behind.
if [ -d "$WORKTREE/.git" ]; then
	if ! git -C "$WORKTREE" push --quiet origin --all 2>/dev/null; then
		warn "push der Arbeitskopie fehlgeschlagen - sichere den Stand des Bare-Repos"
	fi
	DIRTY=$(git -C "$WORKTREE" status --porcelain | wc -l)
	[ "$DIRTY" -eq 0 ] || warn "$DIRTY nicht committete Aenderungen in $WORKTREE - die Sicherung enthaelt sie NICHT"
fi

BUNDLE="$TMP/pi-tau-$STAMP.bundle"
if ! nice -n 15 git -C "$BARE" bundle create "$BUNDLE" --all >/dev/null 2>&1; then
	warn "git bundle fehlgeschlagen"; exit 1
fi
# A bundle that does not verify is worse than none: check before uploading.
if ! git -C "$BARE" bundle verify "$BUNDLE" >/dev/null 2>&1; then
	warn "Bundle ist beschaedigt - nicht hochgeladen"; exit 1
fi
SIZE=$(stat -c %s "$BUNDLE")
HEAD=$(git -C "$BARE" log --oneline -1 2>/dev/null)
log "Bundle: $(numfmt --to=iec "$SIZE") - HEAD $HEAD"

if ! timeout 900 rclone copyto "$BUNDLE" "$REMOTE/pi-tau-$STAMP.bundle" \
     --config "$RCLONE_CONF" --low-level-retries 3 --retries 3 2>/dev/null; then
	warn "Upload fehlgeschlagen"; exit 1
fi
REMOTE_SIZE=$(timeout 180 rclone size "$REMOTE/pi-tau-$STAMP.bundle" --config "$RCLONE_CONF" --json 2>/dev/null \
	| sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')
if [ "${REMOTE_SIZE:-0}" != "$SIZE" ]; then
	warn "Groesse am Ziel weicht ab (lokal $SIZE, entfernt ${REMOTE_SIZE:-?})"; exit 1
fi

mapfile -t OLD < <(timeout 180 rclone lsf "$REMOTE" --config "$RCLONE_CONF" 2>/dev/null | grep '\.bundle$' | sort | head -n -"$KEEP")
for f in "${OLD[@]}"; do
	[ -n "$f" ] || continue
	timeout 120 rclone deletefile "$REMOTE/$f" --config "$RCLONE_CONF" 2>/dev/null && log "alt entfernt: $f"
done
log "Fertig. $(timeout 120 rclone lsf "$REMOTE" --config "$RCLONE_CONF" 2>/dev/null | grep -c '\.bundle$') Sicherungen (Aufbewahrung: $KEEP)."
