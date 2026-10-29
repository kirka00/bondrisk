#!/bin/sh
set -eu
while true; do
	f="/backups/bondrisk_$(date +%Y-%m-%d_%H%M).dump"
	if pg_dump -Fc -f "$f.part" 2>/tmp/err; then
		mv "$f.part" "$f"
		echo "backup ok: $f ($(du -h "$f" | cut -f1))"
	else
		rm -f "$f.part"
		echo "backup FAILED:" >&2; cat /tmp/err >&2
	fi
	find /backups -name 'bondrisk_*.dump' -mtime +"${KEEP_DAYS:-14}" -delete
	sleep 86400
done
