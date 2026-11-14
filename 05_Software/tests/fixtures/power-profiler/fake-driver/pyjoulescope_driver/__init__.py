"""A scripted stand-in for pyjoulescope_driver 2.5.5 (tests only - offline evidence, never a real meter).

It implements the Driver calls power-profile uses (device_paths, open, close, query, publish, subscribe, unsubscribe,
finalize) for a simulated JS220 whose settings persist in $FAKE_JSDRV_STATE across processes. Every call is logged to
$FAKE_JSDRV_LOG (JSON lines). The scenario $FAKE_JSDRV (JSON) sets the devices, the waveform and the injections:

  {"devices": {"u/js220/000415": {"settings": {...}, "versions": {...}}},
   "waveform": {"kind": "constant", "current": 0.01, "voltage": 3.3}
             | {"kind": "sleepwake", "period": 0.1, "active": 0.02, "awake": 0.02, "sleep": 1e-5, "voltage": 3.0, "marker": 0},
   "chunk": 200, "speed": 1.0, "skip": [[k, n]], "nan": [[k, n]], "overflow": [k], "removeAt": k, "stallAt": k,
   "noMetadata": false, "failRead": ["topic"], "powerNan": [[k, n]], "noneDataAt": k}
"""

from __future__ import annotations

import json
import math
import os
import threading
import time

__version__ = "2.5.5+fake"
FULL_RATE = 1_000_000
OPTIONS = {
    "s/i/range/mode": [[0, "off"], [1, "auto"], [2, "manual"]],
    "s/i/range/select": [[0, "10 A"], [1, "180 mA"], [2, "18 mA"], [3, "1.8 mA"], [4, "180 uA", "180 µA"], [5, "18 uA", "18 µA"]],
    "s/v/range/mode": [[0, "auto"], [1, "manual"]],
    "s/v/range/select": [[0, "15 V"], [1, "2 V"]],
}
LIMITS = [10, 0.18, 0.018, 0.0018, 0.00018, 0.000018]
DEFAULTS = {"h/fs": 1_000_000, "s/i/range/mode": 1, "s/i/range/select": 0, "s/v/range/mode": 0, "s/v/range/select": 0}
VERSIONS = {"c/hw/version": (1 << 24) | 2, "c/fw/version": (1 << 24) | (4 << 16) | 10, "s/fpga/version": (1 << 24) | (3 << 16) | 2}


def _scenario() -> dict:
    path = os.environ.get("FAKE_JSDRV")
    if not path:
        return {"devices": {"u/js220/000415": {}}}
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _log(entry: dict) -> None:
    path = os.environ.get("FAKE_JSDRV_LOG")
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry) + "\n")


class DeviceFilterError(RuntimeError):
    pass


class Driver:
    def __init__(self, *args, **kwargs) -> None:
        self.scenario = _scenario()
        self.state = self._load_state()
        self.subscriptions: dict[str, list] = {}
        self.opened: set[str] = set()
        self.present = set(self.scenario.get("devices", {}))
        self.thread: threading.Thread | None = None
        self.running = threading.Event()
        self.lock = threading.Lock()
        _log({"op": "driver"})

    # ---- state ----

    def _load_state(self) -> dict:
        path = os.environ.get("FAKE_JSDRV_STATE")
        if path and os.path.exists(path):
            with open(path, encoding="utf-8") as handle:
                return json.load(handle)
        return {device: {**DEFAULTS, **(config.get("settings") or {})} for device, config in _scenario().get("devices", {}).items()}

    def _save_state(self) -> None:
        path = os.environ.get("FAKE_JSDRV_STATE")
        if path:
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(self.state, handle)

    def _split(self, topic: str) -> tuple[str, str]:
        for device in self.scenario.get("devices", {}):
            if topic.startswith(device + "/"):
                return device, topic[len(device) + 1:]
        raise RuntimeError(f"unknown device topic {topic}")

    # ---- driver API ----

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.finalize()

    def device_paths(self, *args, **kwargs):
        _log({"op": "device_paths"})
        return sorted(self.present)

    def find_devices(self, *args, **kwargs):
        return self.device_paths()

    def open(self, device, mode=None, timeout=None):
        _log({"op": "open", "device": device, "mode": mode})
        if device not in self.present:
            raise RuntimeError(f"{device} not found")
        if mode not in (None, "restore"):
            self.state[device] = dict(DEFAULTS)
        self.opened.add(device)

    def close(self, device, timeout=None):
        _log({"op": "close", "device": device})
        self.opened.discard(device)
        self._stop()
        self._save_state()

    def finalize(self, timeout=None):
        _log({"op": "finalize"})
        self._stop()
        self._save_state()

    def query(self, topic, timeout=None):
        device, sub = self._split(topic)
        _log({"op": "query", "topic": sub})
        if device not in self.present or device not in self.opened:
            raise RuntimeError(f"{device} is not open")
        if sub in self.scenario.get("failRead", []):
            raise TimeoutError(f"{sub} timed out")
        if sub.endswith("$"):
            name = sub[:-1]
            if self.scenario.get("noMetadata") or name not in OPTIONS:
                return {"dtype": "u32", "brief": name}
            return {"dtype": "u32", "brief": name, "options": OPTIONS[name]}
        if sub in VERSIONS:
            return (self.scenario["devices"][device].get("versions") or {}).get(sub, VERSIONS[sub])
        return self.state[device].get(sub)

    def publish(self, topic, value, timeout=None):
        if topic.startswith("@"):
            return
        device, sub = self._split(topic)
        _log({"op": "publish", "topic": sub, "value": value})
        if device not in self.present:
            raise RuntimeError(f"{device} was removed")
        if isinstance(value, str) and sub in OPTIONS:
            wanted = "".join(value.split()).replace("µ", "u").casefold()
            found = [o[0] for o in OPTIONS[sub] if any("".join(n.split()).replace("µ", "u").casefold() == wanted for n in o[1:])]
            if not found:
                raise ValueError(f"{value} is not an option of {sub}")
            value = found[0]
        if sub.endswith("/ctrl"):
            self.state[device][sub] = int(value)
            if int(value) and self.thread is None and sub in ("s/i/ctrl", "s/v/ctrl", "s/p/ctrl"):
                self._start(device)
        else:
            self.state[device][sub] = value
        self._save_state()

    def subscribe(self, topic, flags, fn, timeout=None):
        _log({"op": "subscribe", "topic": topic})
        with self.lock:
            self.subscriptions.setdefault(topic, []).append(fn)

    def unsubscribe(self, topic, fn, timeout=None):
        with self.lock:
            if fn in self.subscriptions.get(topic, []):
                self.subscriptions[topic].remove(fn)

    # ---- streaming ----

    def _emit(self, topic, value):
        with self.lock:
            targets = list(self.subscriptions.get(topic, []))
        for fn in targets:
            fn(topic, value)

    def _stop(self):
        self.running.clear()
        if self.thread is not None and self.thread is not threading.current_thread():
            self.thread.join(timeout=5)
        self.thread = None

    def _start(self, device):
        self.running.set()
        self.thread = threading.Thread(target=self._run, args=(device,), daemon=True)
        self.thread.start()

    def _current(self, k, rate):
        wave = self.scenario.get("waveform") or {"kind": "constant", "current": 0.01, "voltage": 3.3}
        if wave["kind"] == "sleepwake":
            # Integer sample arithmetic: every edge lies exactly on a sample.
            on = k % round(wave["period"] * rate) < round(wave["active"] * rate)
            return (wave["awake"] if on else wave["sleep"]), wave["voltage"], int(on)
        return wave["current"], wave["voltage"], 0

    def _run(self, device):
        settings = self.state[device]
        rate = int(settings.get("h/fs") or FULL_RATE)
        decimate = FULL_RATE // rate
        chunk = int(self.scenario.get("chunk", 200))
        speed = float(self.scenario.get("speed", 1.0))
        skips = {int(k): int(n) for k, n in self.scenario.get("skip", [])}
        nans = [(int(k), int(n)) for k, n in self.scenario.get("nan", [])]
        overflow = set(int(k) for k in self.scenario.get("overflow", []))
        power_nan = [(int(k), int(n)) for k, n in self.scenario.get("powerNan", [])]
        none_at = self.scenario.get("noneDataAt")
        remove_at = self.scenario.get("removeAt")
        stall_at = self.scenario.get("stallAt")
        marker = (self.scenario.get("waveform") or {}).get("marker", 0)
        utc0 = 8 * 365 * 86400 * (1 << 30)
        k = 0
        started = time.monotonic()
        while self.running.is_set():
            if remove_at is not None and k >= remove_at:
                self.present.discard(device)
                self._emit("@/!remove", device)
                return
            if stall_at is not None and k >= stall_at:
                time.sleep(0.05)
                continue
            if k in skips:
                k += skips.pop(k)  # these sample ids are never delivered
                continue
            n = min([chunk, *(at - k for at in skips if at > k)])
            cur, volt, gpi, codes = [], [], [], []
            for j in range(k, k + n):
                i, v, level = self._current(j, rate)
                if j in overflow:
                    i = 12.0
                if any(a <= j < a + c for a, c in nans):
                    i = math.nan
                mode = settings.get("s/i/range/mode")
                code = int(settings.get("s/i/range/select", 0)) if mode == 2 else max(
                    (index for index, limit in enumerate(LIMITS) if limit >= abs(i if i == i else 0)), default=0)
                cur.append(i)
                volt.append(v)
                gpi.append(level)
                codes.append(code)
            sample_id = k * decimate
            base = {"sample_id": sample_id, "sample_rate": FULL_RATE, "decimate_factor": decimate,
                    "utc": utc0 + (sample_id << 30) // FULL_RATE, "field_id": 0, "index": 0}
            ctrl = lambda topic: int(settings.get(topic, 0))  # noqa: E731
            if ctrl("s/i/ctrl"):
                broken = none_at is not None and k <= none_at < k + n
                self._emit(f"{device}/s/i/!data", {**base, "data": None if broken else cur})
            if ctrl("s/v/ctrl"):
                self._emit(f"{device}/s/v/!data", {**base, "data": volt})
            if ctrl("s/p/ctrl"):
                power = [a * b for a, b in zip(cur, volt)]
                for j in range(k, k + n):
                    if any(a <= j < a + c for a, c in power_nan):
                        power[j - k] = math.nan
                self._emit(f"{device}/s/p/!data", {**base, "data": power})
            if ctrl("s/i/range/ctrl"):
                self._emit(f"{device}/s/i/range/!data", {**base, "data": codes})
            if ctrl(f"s/gpi/{marker}/ctrl"):
                packed = bytearray((n + 7) // 8)
                for j, level in enumerate(gpi):
                    if level:
                        packed[j // 8] |= 1 << (j % 8)
                self._emit(f"{device}/s/gpi/{marker}/!data", {**base, "data": bytes(packed)})
            k += n
            target = started + (k / rate) / speed
            delay = target - time.monotonic()
            if delay > 0:
                time.sleep(delay)
