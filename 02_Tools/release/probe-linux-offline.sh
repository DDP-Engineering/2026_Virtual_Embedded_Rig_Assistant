#!/usr/bin/env bash
# Run as root inside the test VM; restore every previously-up adapter on exit.
set -euo pipefail
artifact=$(realpath "$1")
evidence=$(realpath "$2")
test_user=$3
[[ $(id -u) == 0 ]] || { echo 'VM adapter isolation requires root'; exit 1; }
[[ "$artifact" == *.AppImage ]] || { echo 'Expected instrumented AppImage'; exit 1; }
mkdir -p "$evidence"
chown "$test_user" "$evidence"
sha256sum "$artifact" > "$evidence/artifact.sha256"
uname -a > "$evidence/os.txt"
ip -j link > "$evidence/links-before.json"
ip -j route > "$evidence/routes-before.json"
ip -6 -j route > "$evidence/routes6-before.json"
ip -j address > "$evidence/addresses-before.json"
# Reject unsupported route attributes before touching an adapter. Replay preserves each
# supported route's metric/protocol/source/table; multiple default metrics remain distinct.
routes() {
  python3 - "$evidence" "$1" <<'PY'
import json, subprocess, sys
from pathlib import Path
folder, mode = Path(sys.argv[1]), sys.argv[2]
attributes = {'dst', 'gateway', 'dev', 'protocol', 'scope', 'prefsrc', 'metric', 'table', 'type', 'pref', 'flags'}
for family, filename in [('-4', 'routes-before.json'), ('-6', 'routes6-before.json')]:
    expected = json.loads((folder / filename).read_text())
    for route in expected:
        if set(route) - attributes or set(route.get('flags', [])) - {'linkdown'}:
            raise RuntimeError('Unsupported route topology; no isolation is performed: ' + str(route))
    if mode == 'restore':
        current = json.loads(subprocess.check_output(['ip', family, '-j', 'route']))
        for route in expected:
            if route in current:
                continue
            command = ['ip', family, 'route', 'replace']
            if 'type' in route:
                command.append(str(route['type']))
            command.append(route['dst'])
            for key, argument in [('gateway', 'via'), ('dev', 'dev'), ('protocol', 'proto'),
                                  ('scope', 'scope'), ('prefsrc', 'src'), ('metric', 'metric'),
                                  ('table', 'table'), ('pref', 'pref')]:
                if key in route:
                    command.extend([argument, str(route[key])])
            subprocess.run(command, check=True)
        restored = json.loads(subprocess.check_output(['ip', family, '-j', 'route']))
        normalize = lambda values: sorted(json.dumps(value, sort_keys=True) for value in values)
        if normalize(restored) != normalize(expected):
            raise RuntimeError('Route restoration differs from the complete pre-isolation snapshot')
PY
}
routes validate
mapfile -t active < <(ip -j link | python3 -c 'import json,sys; print("\n".join(x["ifname"] for x in json.load(sys.stdin) if x["ifname"] != "lo" and "UP" in x["flags"]))')
restore() {
  local restore_failed=0
  for adapter in "${active[@]}"; do ip link set dev "$adapter" up || restore_failed=1; done
  routes restore || restore_failed=1
  ip -j link > "$evidence/links-restored.json"
  ip -j route > "$evidence/routes-restored.json"
  ip -6 -j route > "$evidence/routes6-restored.json"
  return "$restore_failed"
}
trap restore EXIT
for adapter in "${active[@]}"; do ip link set dev "$adapter" down; done
ip -j link > "$evidence/links-offline.json"
ip -j route > "$evidence/routes-offline.json"
ip -6 -j route > "$evidence/routes6-offline.json"
python3 -c 'import json,sys; links=json.load(open(sys.argv[1])); assert all(x["ifname"]=="lo" or "UP" not in x["flags"] for x in links)' "$evidence/links-offline.json"
set +e
runuser -u "$test_user" -- env -u ELECTRON_RUN_AS_NODE xvfb-run -a "$artifact" --appimage-extract-and-run \
  "--packaging-probe=$evidence/probe.json" "--user-data-dir=$evidence/user-data" > "$evidence/process.log" 2>&1
result=$?
set -e
printf '%s\n' "$result" > "$evidence/exit-code.txt"
sha256sum "$artifact" > "$evidence/artifact-after.sha256"
cmp "$evidence/artifact.sha256" "$evidence/artifact-after.sha256"
restore
trap - EXIT
exit "$result"
