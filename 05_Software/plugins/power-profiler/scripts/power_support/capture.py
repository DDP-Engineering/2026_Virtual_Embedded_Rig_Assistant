"""Live operations of power-profile: identify, capture and the cleanup release (spec REQ-DATA-dd3e4fe1 section 5).

Streams arrive on the driver's thread; the callbacks only queue them and the main loop assembles them by sample id,
so a skipped sample id becomes a gap and a NaN a missing sample - never a zero (REQ-REL-a711fe43).
"""

from __future__ import annotations

import collections
import math
import os
import time
from array import array
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from . import acquisition, capfile, profiles, registry
from .errors import Problem
from .lifecycle import Lifecycle
from .meter import MeterSession, driver_module, driver_version, equal
from .profiles import Profile, normal
from .result import Result

TIME64_EPOCH = datetime(2018, 1, 1, tzinfo=timezone.utc)
TIME64_SECOND = 1 << 30
STALL_SECONDS = 2.0
POLL_SECONDS = 0.02
DATA_TOPICS = {"current": "s/i/!data", "voltage": "s/v/!data", "power": "s/p/!data", "range": "s/i/range/!data"}
CTRL_TOPICS = {"current": "s/i/ctrl", "voltage": "s/v/ctrl", "power": "s/p/ctrl", "range": "s/i/range/ctrl"}


# ---- stream assembly ----


class Stream:
    """One channel by output sample index; positions never written are missing (NaN, or -1 for codes)."""

    def __init__(self, floats: bool) -> None:
        self.floats = floats
        self.values: array = array("d") if floats else array("b")
        self.skipped = bytearray()  # 1 where a sample-id skip left the position missing

    @property
    def missing(self) -> float | int:
        return math.nan if self.floats else -1

    def put(self, position: int, items: list[Any]) -> None:
        if position < 0:
            items = items[-position:]
            position = 0
        have = len(self.values)
        if position > have:
            self.values.extend([self.missing] * (position - have))  # type: ignore[list-item]
            self.skipped.extend(b"\x01" * (position - have))
        elif position < have:
            # A later message wins: 1-bit data is padded to whole bytes, so the next message overwrites the padding.
            del self.values[position:]
            del self.skipped[position:]
        if items:
            self.values.extend(items)
            self.skipped.extend(bytes(len(items)))

    def fit(self, count: int) -> None:
        if len(self.values) > count:
            del self.values[count:]
            del self.skipped[count:]
        elif len(self.values) < count:
            pad = count - len(self.values)
            self.values.extend([self.missing] * pad)  # type: ignore[list-item]
            self.skipped.extend(b"\x01" * pad)


def _floats(data: Any) -> list[float]:
    values = data.tolist() if hasattr(data, "tolist") else list(data)
    return [float(value) for value in values]


def _codes(data: Any) -> list[int]:
    values = data.tolist() if hasattr(data, "tolist") else list(data)
    return [int(value) & 0x0F for value in values]


def _bits(data: Any) -> list[int]:
    """1-bit samples packed 8 per byte, least significant bit first (the driver's u1 format)."""
    raw = bytes(data.tolist() if hasattr(data, "tolist") else data)
    return [(byte >> bit) & 1 for byte in raw for bit in range(8)]


class Assembler:
    def __init__(self, markers: tuple[int, ...]) -> None:
        self.streams: dict[str, Stream] = {
            "current": Stream(True), "voltage": Stream(True), "power": Stream(True), "range": Stream(False),
            **{f"gpi{n}": Stream(False) for n in markers},
        }
        self.base: int | None = None
        self.rate: int | None = None
        self.decimate: int | None = None
        self.first_sample_id: int | None = None
        self.start_utc: str | None = None
        self.rate_changed = False
        self.pending: list[tuple[str, dict[str, Any]]] = []

    @property
    def count(self) -> int:
        return len(self.streams["current"].values)

    def complete(self, target: int) -> bool:
        """Every enabled signal holds `target` samples: channels packed differently may arrive after the current."""
        return all(len(stream.values) >= target for stream in self.streams.values())

    def add(self, key: str, value: dict[str, Any]) -> None:
        """Queues messages until every enabled signal delivered one; index 0 is the first sample all of them cover."""
        if self.base is None:
            self.pending.append((key, value))
            firsts: dict[str, tuple[int, dict[str, Any]]] = {}
            for name, item in self.pending:
                if name not in firsts:
                    firsts[name] = (int(item["sample_id"]) // int(item.get("decimate_factor") or 1), item)
            if set(firsts) != set(self.streams):
                return
            name = max(firsts, key=lambda channel: firsts[channel][0])
            self.base, first = firsts[name]
            self.decimate = int(first.get("decimate_factor") or 1)
            self.rate = int(first["sample_rate"]) // self.decimate
            self.first_sample_id = self.base * self.decimate
            utc = first.get("utc")
            if isinstance(utc, int):
                self.start_utc = (TIME64_EPOCH + timedelta(seconds=utc / TIME64_SECOND)).isoformat().replace("+00:00", "Z")
            pending, self.pending = self.pending, []
            for item in pending:
                self._put(*item)
            return
        self._put(key, value)

    def _put(self, key: str, value: dict[str, Any]) -> None:
        assert self.base is not None
        decimate = int(value.get("decimate_factor") or 1)
        index = int(value["sample_id"]) // decimate
        if int(value["sample_rate"]) // decimate != self.rate:
            self.rate_changed = True
            return
        data = value["data"]
        items: list[Any] = _floats(data) if key in ("current", "voltage", "power") else _bits(data) if key.startswith("gpi") else _codes(data)
        self.streams[key].put(index - self.base, items)


# ---- shared steps ----


def _meter(alias: str) -> tuple[registry.Meter, Profile]:
    entry, _digest = registry.read(alias)
    profile = profiles.load(entry.profile)
    if profile.model != entry.model:
        from .errors import Refused

        raise Refused("request", f"The meter {alias} is a {entry.model}; its profile {profile.id} is for a {profile.model}.")
    return entry, profile


def _meter_document(entry: registry.Meter, profile: Profile, versions: dict[str, Any] | None) -> dict[str, Any]:
    return {"alias": entry.alias, "resource": entry.resource, "model": entry.model, "serial": entry.serial,
            "profile": profile.id, "profileStatus": profile.status, "source": "measured", "versions": versions}


def _connect(module: Any, entry: registry.Meter, lifecycle: Lifecycle) -> MeterSession:
    session = MeterSession(module, entry.resource)
    if not session.present():
        raise Problem("device-missing", f"{entry.resource} is not connected (the driver lists no such device); "
                      "nothing was opened. Live evidence needs the meter attached.", "blocked")
    session.open()
    lifecycle.report("identified")
    return session


# ---- identify ----


def identify(args: Any, cwd: Path, spelled: Path) -> int:
    entry, profile = _meter(args.meter)
    result = Result("identify", args.run_id, "power-profile")
    result.create_folder(cwd, spelled, args.results_dir)
    result["meter"] = _meter_document(entry, profile, None)
    lifecycle = Lifecycle()
    lifecycle.report("start")
    session: MeterSession | None = None
    try:
        module = driver_module()
        result["tool"]["driver"] = driver_version(module)
        session = _connect(module, entry, lifecycle)
        result["meter"]["versions"] = session.versions()
        settings = session.read()
        result["settings"] = {"current": settings}
        result["currentPath"] = session.current_path(settings)
        if result["currentPath"] == "off":
            result.problem("current-path-off", "The meter's current range mode is off: the DUT's current path is open. "
                           "VERA does not switch it; captures are refused until the user switches it on.")
        elif result["currentPath"] == "unknown":
            result.problem("current-path-unknown", "The meter's current range mode is not a value its metadata names; "
                           "captures are refused.")
    except Problem as problem:
        result.fail(problem)
    except Exception as error:  # never a traceback without a result
        result.fail(Problem("internal", f"{type(error).__name__}: {str(error)[:300]}"))
    finally:
        if session is not None:
            session.close()
        lifecycle.report("released", "unchanged")
        result["lifecycle"] = {"phases": lifecycle.phases, "physical": "unchanged"}
    return result.finish()


# ---- capture ----


def _conditions(pairs: list[str] | None) -> dict[str, str]:
    import re

    from .errors import Refused

    found: dict[str, str] = {}
    for pair in pairs or []:
        name, sep, value = pair.partition("=")
        if not sep or not re.fullmatch(r"[a-z][a-z0-9_-]{0,31}", name) or not re.fullmatch(r"[\x20-\x7e]{1,120}", value):
            raise Refused("request", f"--condition {pair[:40]!r} is not <name>=<value> (name [a-z][a-z0-9_-], value 1-120 printable).")
        if name in found:
            raise Refused("request", f"--condition {name} is given twice.")
        found[name] = value
    if len(found) > 16:
        raise Refused("request", "At most 16 --condition values.")
    return found


def text_option(value: str | None, option: str) -> str | None:
    import re

    from .errors import Refused

    if value is not None and not re.fullmatch(r"[\x20-\x7e]{1,120}", value):
        raise Refused("request", f"{option} takes 1-120 printable characters.")
    return value


def _desired(plan: acquisition.Plan) -> list[tuple[str, Any]]:
    """The settings to apply, in order (a selection before the mode that uses it)."""
    steps: list[tuple[str, Any]] = [("h/fs", plan.rate)]
    if plan.current_range == "auto":
        steps.append(("s/i/range/mode", "auto"))
    else:
        steps += [("s/i/range/select", plan.current_range), ("s/i/range/mode", "manual")]
    if plan.voltage_range is not None:
        steps += [("s/v/range/select", plan.voltage_range), ("s/v/range/mode", "manual")]
    return steps


def capture(args: Any, cwd: Path, spelled: Path) -> int:
    from .firmware import identify as firmware_identity

    entry, profile = _meter(args.meter)
    plan = acquisition.check(profile, args.rate, args.duration, args.current_range, args.voltage_range, args.markers)
    conditions = _conditions(args.condition)
    board = text_option(args.board, "--board")
    label = text_option(args.label, "--label")
    firmware = firmware_identity(cwd, spelled, args.firmware) if args.firmware else None
    result = Result("capture", args.run_id, "power-profile")
    result.create_folder(cwd, spelled, args.results_dir)
    result["meter"] = _meter_document(entry, profile, None)
    result["acquisition"] = acquisition.describe(profile, plan)
    result["firmware"] = firmware
    result["board"] = board
    result["conditions"] = conditions
    result["label"] = label
    result["burden"] = profile.burden
    result["signConvention"] = profile.sign_convention
    lifecycle = Lifecycle()
    lifecycle.report("start")
    session: MeterSession | None = None
    changed: list[tuple[str, Any]] = []
    previous: dict[str, Any] = {}
    enabled: list[str] = []
    assembler = Assembler(plan.markers)
    physical = "unchanged"
    try:
        module = driver_module()
        result["tool"]["driver"] = driver_version(module)
        session = _connect(module, entry, lifecycle)
        result["meter"]["versions"] = session.versions()
        previous = session.read()
        path = session.current_path(previous)
        if path == "off":
            raise Problem("current-path-off", "The meter's current range mode is off: the DUT's current path is open. A capture "
                          "never switches it on; switch it yourself if the DUT may be powered.", "blocked")
        if path == "unknown":
            raise Problem("current-path-unknown", f"The meter's current range mode reads {previous.get('s/i/range/mode')!r}, "
                          "which its metadata does not name; VERA cannot tell whether the current path is closed, so it "
                          "changes nothing.", "blocked")
        for topic, value in _desired(plan):
            if previous.get(topic) is None or not equal(previous[topic], value):
                if not changed:
                    lifecycle.report("acting", "pending")
                    physical = "pending"
                changed.append((topic, previous.get(topic)))
                session.set(topic, value)
        applied = session.read()
        result["settings"] = {"previous": previous, "applied": applied}
        for topic, value in _desired(plan):
            if not equal(applied.get(topic), value):
                raise Problem("settings", f"{topic} reads back {applied.get(topic)!r}, not {value!r}; nothing was captured.")
        _stream(session, assembler, plan, lifecycle, enabled, result)
    except Problem as problem:
        result.fail(problem)
    except Exception as error:  # never a traceback without a result; the meter is still restored below
        result.fail(Problem("internal", f"{type(error).__name__}: {str(error)[:300]}"))
    finally:
        if session is not None:
            if changed or enabled:
                lifecycle.report("cleaning", physical)
            physical = _restore(session, changed, previous, enabled, result, physical)
            session.close()
        lifecycle.report("released", physical)
        result["lifecycle"] = {"phases": lifecycle.phases, "physical": physical}
    if assembler.count > 0 and result["status"] != "blocked":
        try:
            _write(result, assembler, plan, profile)
        except Exception as error:
            result.fail(Problem("internal", f"The samples could not be written: {type(error).__name__}: {str(error)[:300]}"))
    elif result["status"] == "pass":
        result.problem("no-data", "The meter delivered no samples.", "error")
    return result.finish()


def _stream(session: MeterSession, assembler: Assembler, plan: acquisition.Plan, lifecycle: Lifecycle,
            enabled: list[str], result: Result) -> None:
    queue: collections.deque[tuple[str, dict[str, Any]]] = collections.deque()
    callbacks: dict[str, Any] = {}
    topics = {**DATA_TOPICS, **{f"gpi{n}": f"s/gpi/{n}/!data" for n in plan.markers}}
    controls = {**CTRL_TOPICS, **{f"gpi{n}": f"s/gpi/{n}/ctrl" for n in plan.markers}}
    for key, topic in topics.items():
        callbacks[topic] = (lambda name: lambda _topic, value: queue.append((name, value)))(key)
        session.subscribe(topic, callbacks[topic])
    try:
        for key in topics:
            session.set(controls[key], 1)
            enabled.append(controls[key])
        target = plan.samples
        started = last = time.monotonic()
        reason = "complete"
        while True:
            while queue:
                assembler.add(*queue.popleft())
                last = time.monotonic()
            if assembler.rate_changed:
                raise Problem("rate-changed", "The meter changed its sample rate during the capture.")
            if assembler.complete(target):
                break
            moment = time.monotonic()
            if session.removed:
                reason = "removed"
                break
            if lifecycle.stop_requested():
                reason = "stopped"
                break
            if moment - last > max(STALL_SECONDS, 10 / plan.rate):
                reason = "stalled"
                break
            if moment - started > plan.duration + 10:
                reason = "deadline"
                break
            time.sleep(POLL_SECONDS)
        if reason == "removed":
            result.problem("device-removed", "The meter disappeared during the capture; the samples up to then are kept.", "error")
        elif reason == "stopped":
            result.problem("stopped", "VERA asked the capture to stop; the samples up to then are kept.", "incomplete")
        elif reason == "stalled":
            result.problem("stalled", f"No data arrived for {max(STALL_SECONDS, 10 / plan.rate):g} s.", "error")
        elif reason == "deadline":
            result.problem("deadline", "The capture did not finish within its duration + 10 s.", "error")
    finally:
        for topic, fn in callbacks.items():
            session.unsubscribe(topic, fn)


def _restore(session: MeterSession, changed: list[tuple[str, Any]], previous: dict[str, Any], enabled: list[str],
             result: Result, physical: str) -> str:
    """Signals off, changed settings back as they were, read back. Returns the physical state."""
    if session.removed:
        if changed:
            result.problem("restore", "The meter disappeared; its settings could not be restored or read back.")
            return "unknown"
        return "unknown" if enabled else physical
    failed: list[str] = []
    for topic in reversed(enabled):  # each on its own: one failure never skips restoring the settings
        try:
            session.set(topic, 0)
        except Problem as problem:
            failed.append(problem.message)
    for topic, value in reversed(changed):
        if value is None:
            continue
        try:
            session.restore(topic, value)
        except Problem as problem:
            failed.append(problem.message)
    if failed:
        result.problem("restore", "Switching the meter back failed: " + "; ".join(failed)[:300])
    try:
        if not changed:
            return physical if not failed else "unknown"
        restored = session.read()
        settings = result.document.setdefault("settings", {"previous": previous})
        settings["restored"] = restored
        if not failed and all(value is not None and equal(restored.get(topic), value) for topic, value in changed):
            return "confirmed"
        result.problem("restore", "The settings read back after the capture differ from those before it.")
        return "unknown"
    except Problem as problem:
        result.problem("restore", f"Restoring the meter's settings failed: {problem.message}")
        return "unknown"


def _write(result: Result, assembler: Assembler, plan: acquisition.Plan, profile: Profile) -> None:
    count = min(assembler.count, plan.samples)
    for stream in assembler.streams.values():
        stream.fit(count)
    rate = assembler.rate or plan.rate
    current, voltage = assembler.streams["current"], assembler.streams["voltage"]
    power, ranges = assembler.streams["power"], assembler.streams["range"]
    applied = (result.document.get("settings") or {}).get("applied") or {}
    voltage_label = applied.get("s/v/range/select")
    voltage_range = profile.voltage_range(str(voltage_label)) if voltage_label is not None else None
    voltage_mode = applied.get("s/v/range/mode")
    voltage_limit = (voltage_range.limit if voltage_range is not None and voltage_mode is not None
                     and normal(str(voltage_mode)) == "manual" else max(item.limit for item in profile.voltage_ranges))
    flags: list[str] = []
    gaps: list[dict[str, Any]] = []
    overflow = {"current": 0, "voltage": 0}
    codes: dict[str, int] = {}
    switches = 0
    last_code: int | None = None
    run_start: int | None = None
    run_skip = False
    for k in range(count):
        i, v, code = current.values[k], voltage.values[k], ranges.values[k]
        flag = ""
        if math.isnan(i) or math.isnan(v) or math.isnan(power.values[k]):
            flag += "m"
        if not math.isnan(i) and abs(i) > profile.current_limit(code if code >= 0 else None):
            flag += "i"
            overflow["current"] += 1
        if not math.isnan(v) and abs(v) > voltage_limit:
            flag += "v"
            overflow["voltage"] += 1
        flags.append(flag)
        if code >= 0:
            codes[str(code)] = codes.get(str(code), 0) + 1
            if last_code is not None and code != last_code:
                switches += 1
            last_code = code
        if math.isnan(i):
            if run_start is None:
                run_start, run_skip = k, bool(current.skipped[k])
        elif run_start is not None:
            gaps.append({"from": run_start, "samples": k - run_start, "seconds": (k - run_start) / rate,
                         "cause": "skip" if run_skip else "nan"})
            run_start = None
    if run_start is not None:
        gaps.append({"from": run_start, "samples": count - run_start, "seconds": (count - run_start) / rate,
                     "cause": "skip" if run_skip else "nan"})
    columns: list[tuple[str, Any]] = [("current_A", current.values), ("voltage_V", voltage.values), ("power_W", power.values),
                                      ("range", ranges.values)]
    for name, stream in assembler.streams.items():
        if name.startswith("gpi"):
            for k in range(count):
                if current.skipped[k]:
                    stream.values[k] = -1  # padding bits of a packed message never stand in for lost samples
    columns += [(name, stream.values) for name, stream in assembler.streams.items() if name.startswith("gpi")]
    folder = result.folder
    assert folder is not None
    path = folder / "samples.csv"
    capfile.write_samples(path, (k / rate for k in range(count)), columns, flags)
    result.files.append(path)
    result["timebase"] = {"clock": "meter", "rate": rate, "uniform": True, "samples": count,
                          "firstSampleId": assembler.first_sample_id, "decimate": assembler.decimate,
                          "startUtc": assembler.start_utc}
    result["channels"] = [{"name": "current", "unit": "A", "column": "current_A"},
                          {"name": "voltage", "unit": "V", "column": "voltage_V"},
                          {"name": "power", "unit": "W", "column": "power_W", "source": "meter"},
                          {"name": "range", "unit": "", "column": "range"},
                          *({"name": name, "unit": "", "column": name} for name in assembler.streams if name.startswith("gpi"))]
    result["gaps"] = gaps
    # Every channel's own missing samples: a channel can lag or lose data while the current is whole.
    missing = {name: sum(1 for value in stream.values if (math.isnan(value) if stream.floats else value < 0))
               for name, stream in assembler.streams.items()}
    result["missing"] = missing
    lagging = {name: n for name, n in missing.items() if name != "current" and n}
    if lagging:
        result.problem("channel-missing", "Samples are missing in " + ", ".join(f"{name} ({n})" for name, n in lagging.items())
                       + "; they stay empty, never zero.", "incomplete")
    result["overflow"] = overflow
    result["ranges"] = {"codes": codes, "switches": switches}
    if gaps:
        missing = sum(gap["samples"] for gap in gaps)
        result.problem("gaps", f"{missing} samples are missing in {len(gaps)} gap(s); they stay empty, never zero.", "incomplete")
    if overflow["current"] or overflow["voltage"]:
        result.problem("overflow", f"{overflow['current']} current and {overflow['voltage']} voltage samples lie beyond "
                       "their range limit.", "incomplete")
    if count < plan.samples and result["status"] == "pass":
        result.problem("short", f"The capture holds {count} of {plan.samples} samples.", "incomplete")


# ---- cleanup ----


def release(args: Any) -> int:
    """VERA's cleanup after an interrupted capture: signals off, current range back to auto, read back."""
    import json

    lifecycle = Lifecycle()
    lifecycle.report("cleaning", "unknown")
    out: dict[str, Any] = {"format": 1, "kind": "power-release", "meter": args.meter, "of": os.environ.get("VERA_CLEANUP_OF")}
    physical = "unknown"
    session: MeterSession | None = None
    try:
        entry, _profile = _meter(args.meter)
        module = driver_module()
        session = MeterSession(module, entry.resource)
        if not session.present():
            out["problem"] = "device-missing: the meter is not connected; its state cannot be confirmed."
        else:
            session.open()
            settings = session.read()
            path = session.current_path(settings)
            if path != "on":
                out["problem"] = (f"current-path-{path}: the current range mode reads {settings.get('s/i/range/mode')!r}; "
                                  "release does not switch the current path.")
            else:
                for topic in ("s/i/ctrl", "s/v/ctrl", "s/p/ctrl", "s/i/range/ctrl", "s/gpi/0/ctrl", "s/gpi/1/ctrl",
                              "s/gpi/2/ctrl", "s/gpi/3/ctrl"):
                    try:
                        session.set(topic, 0)
                    except Problem:
                        pass
                if not equal(settings.get("s/i/range/mode"), "auto"):
                    session.set("s/i/range/mode", "auto")
                readback = session.read()
                out["settings"] = readback
                if equal(readback.get("s/i/range/mode"), "auto"):
                    physical = "confirmed"
                else:
                    out["problem"] = "readback: the current range mode does not read back auto."
    except Exception as error:  # the cleanup reports, it never raises
        out["problem"] = f"{type(error).__name__}: {str(error)[:300]}"
    finally:
        if session is not None:
            session.close()
    lifecycle.report("released", physical)
    out["physical"] = physical
    print(json.dumps(out, ensure_ascii=False))
    return 0 if physical == "confirmed" else 4
