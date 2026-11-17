#!/usr/bin/env bash
set -euo pipefail

gateway=/etc/nginx/ziwei-gateway.conf
service=ziwei-gateway.service
include=/etc/nginx/yuyu-location.conf
release_root=/opt/yuyu/releases
release="$release_root/$(date -u +%Y%m%dT%H%M%S)-$$"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

test -s /etc/yuyu/model.env
install -d -m 0755 "$release" /opt/yuyu/runtime
if [[ ! -x /opt/yuyu/runtime/node ]]; then
    install -m 0755 /opt/ziwei-node/bin/node /opt/yuyu/runtime/node
fi
/opt/yuyu/runtime/node --check "$here/server.mjs"
/opt/yuyu/runtime/node --check "$here/accounts.mjs"
/opt/yuyu/runtime/node --check "$here/tutor.mjs"
/opt/yuyu/runtime/node --check "$here/guides.mjs"
/opt/yuyu/runtime/node --check "$here/guides-first.mjs"
/opt/yuyu/runtime/node --check "$here/guides-second.mjs"
/opt/yuyu/runtime/node --check "$here/challenge.mjs"
install -m 0644 "$here/server.mjs" "$here/accounts.mjs" "$here/tutor.mjs" "$here/guides.mjs" \
    "$here/guides-first.mjs" "$here/guides-second.mjs" "$here/challenge.mjs" "$release/"
install -d -m 0755 "$release/public"
install -m 0644 "$here/public/"* "$release/public/"

backup="$(mktemp -d /root/yuyu-rollback.XXXXXX)"
cp -a "$gateway" "$backup/gateway"
[[ ! -e "$include" ]] || cp -a "$include" "$backup/include"
[[ ! -e /etc/systemd/system/yuyu.service ]] || cp -a /etc/systemd/system/yuyu.service "$backup/unit"
old_release="$(readlink /opt/yuyu/current || true)"
rollback() {
    local code=$?
    if (( code != 0 )); then
        cp -a "$backup/gateway" "$gateway"
        if [[ -f "$backup/include" ]]; then cp -a "$backup/include" "$include"; else rm -f "$include"; fi
        if [[ -n "$old_release" && -f "$backup/unit" ]]; then
            ln -sfn "$old_release" /opt/yuyu/current
            cp -a "$backup/unit" /etc/systemd/system/yuyu.service
            systemctl daemon-reload
            systemctl restart yuyu.service
        else
            systemctl disable --now yuyu.service || true
            rm -f /etc/systemd/system/yuyu.service /opt/yuyu/current
            systemctl daemon-reload
        fi
        /usr/sbin/nginx -t -c "$gateway" && systemctl reload "$service"
    fi
}
trap rollback EXIT

ln -sfn "$release" /opt/yuyu/current
install -m 0644 "$here/ops/yuyu.service" /etc/systemd/system/yuyu.service
systemctl daemon-reload
systemctl enable yuyu.service
systemctl restart yuyu.service
healthy=0
for i in {1..15}; do
    if curl -fsS --max-time 2 http://127.0.0.1:3731/api/health; then
        healthy=1
        break
    fi
    sleep 1
done
if (( healthy != 1 )); then
    journalctl -u yuyu.service -n 20 --no-pager
    exit 1
fi

install -m 0644 "$here/ops/nginx-location.conf" "$include"
if ! awk '/^[[:space:]]*include \/etc\/nginx\/yuyu-location\.conf;/ {found=1} END {exit !found}' "$gateway"; then
    python3 - "$gateway" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
original = path.read_text()
anchor = "        listen 443 ssl;\n"
if original.count(anchor) != 1:
    raise SystemExit("Expected a single HTTPS gateway server block")
temp = path.with_name(path.name + ".yuyu-new")
temp.write_text(original.replace(anchor, anchor + "        include /etc/nginx/yuyu-location.conf;\n"))
temp.chmod(path.stat().st_mode)
temp.replace(path)
PY
fi
/usr/sbin/nginx -t -c "$gateway"
systemctl reload "$service"
curl --resolve 8.136.249.142:443:127.0.0.1 -fsS --retry 2 https://8.136.249.142/yuyu/api/health
trap - EXIT
