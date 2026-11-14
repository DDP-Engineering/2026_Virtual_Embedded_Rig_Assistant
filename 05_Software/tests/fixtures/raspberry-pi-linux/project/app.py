"""Fixture project code for the raspberry-pi-linux tests: finite behaviours selected by its arguments."""

import json
import sys
import time

args = sys.argv[1:]
print("fixture app 1.0.0", flush=True)
if "--selftest" in args:
    print("selftest ok", flush=True)
elif "--echo" in args:
    print(json.dumps(args[args.index("--echo") + 1 :]), flush=True)
elif "--sleep" in args:
    seconds = float(args[args.index("--sleep") + 1])
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        print("tick", flush=True)
        time.sleep(0.5)
elif "--family" in args:
    # A child in the task's own process group that outlives this process.
    import subprocess

    subprocess.Popen([sys.executable, __file__, "--hold", "120"])
    time.sleep(120)
elif "--hold" in args:
    # Silent: a task that writes nothing does not notice a lost supervisor.
    time.sleep(float(args[args.index("--hold") + 1]))
elif "--exit" in args:
    print("failing on purpose", file=sys.stderr, flush=True)
    sys.exit(int(args[args.index("--exit") + 1]))
elif "--spam" in args:
    while True:
        print("x" * 200, flush=True)
elif "--serve" in args:
    while True:
        print("heartbeat", flush=True)
        time.sleep(1)
