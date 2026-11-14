"""The operations of each instrument class. The slots an operation sends - and so its effect - are fixed here:

- identify, read, status: queries only;
- capture: the waveform transfer settings (source, mode, format), the preamble and the data block, plus queries;
- configure: the class's setting slots, then a readback of each;
- close: every output off, then a readback (power supplies); nothing to switch for meters and scopes;
- output: readback off, set-points, output on, hold with measurements, output off, readback off.
"""

from __future__ import annotations

import json
import math
import time
from typing import Any

from .errors import Blocked, Failed, Incomplete, Problem, Refused
from .lifecycle import Lifecycle
from .profiles import Profile
from .registry import Entry
from .report import Result
from .session import Session
from .waveform import BlockError, SampleFormat, clipped, csv_text, parse_preamble, samples, series

TOLERANCE = 1e-4


def close_enough(requested: float, actual: float) -> bool:
    return math.isclose(requested, actual, rel_tol=TOLERANCE, abs_tol=1e-9)


class Operation:
    def __init__(self, session: Session, profile: Profile, entry: Entry, lifecycle: Lifecycle, result: Result, checked: dict[str, Any]) -> None:
        self.session = session
        self.profile = profile
        self.entry = entry
        self.lifecycle = lifecycle
        self.result = result
        self.checked = checked

    def checkpoint(self) -> None:
        if self.lifecycle.stop_requested():
            raise Incomplete("stopped", "A stop request ended the operation before it finished.")

    def act(self) -> None:
        """Marks the first command that can change the instrument's state."""
        if self.lifecycle.physical == "unchanged":
            self.lifecycle.report("acting", "pending")


# --- power supply ------------------------------------------------------------------------------------------------


class Psu(Operation):
    def index(self, channel: str) -> int:
        return int(self.profile.channels[channel]["index"])

    def output_on(self, channel: str) -> bool | None:
        reply = self.session.query(self.profile.command("outputState", index=self.index(channel))).upper()
        states = self.profile.data["outputStates"]
        if reply in states["on"]:
            return True
        if reply in states["off"]:
            return False
        return None

    def measure_raw(self, channel: str) -> dict[str, tuple[float, str]]:
        index = self.index(channel)
        return {
            "voltage": self.session.query_value(self.profile.command("measureVoltage", index=index)),
            "current": self.session.query_value(self.profile.command("measureCurrent", index=index)),
        }

    def measure(self, channel: str) -> dict[str, float]:
        return {key: value for key, (value, _) in self.measure_raw(channel).items()}

    def read(self) -> None:
        values = []
        for channel in [self.checked["channel"]] if "channel" in self.checked else list(self.profile.channels):
            self.checkpoint()
            measured = self.measure_raw(channel)
            for quantity, unit in (("voltage", "V"), ("current", "A")):
                value, raw = measured[quantity]
                values.append({"quantity": quantity, "channel": channel, "value": value, "unit": unit, "raw": raw})
        self.result["values"] = values

    def status(self) -> None:
        outputs = []
        for channel in self.profile.channels:
            index = self.index(channel)
            state = self.output_on(channel)
            outputs.append(
                {
                    "channel": channel,
                    "output": None if state is None else ("on" if state else "off"),
                    "voltageSetpoint": self.session.query_float(self.profile.command("voltageSetpoint", index=index)),
                    "currentSetpoint": self.session.query_float(self.profile.command("currentSetpoint", index=index)),
                    **{f"measured{key.title()}": value for key, value in self.measure(channel).items()},
                }
            )
        self.result["outputs"] = outputs

    def require_off(self, channels: list[str]) -> None:
        for channel in channels:
            state = self.output_on(channel)
            if state is not False:
                raise Blocked(
                    "output-on",
                    f"{channel} output is {'on' if state else 'in an unknown state'}; a set-point would change the live "
                    "output. Run close first or use output.",
                )

    def apply(self, settings: list[dict[str, Any]]) -> None:
        readback = []
        for setting in settings:
            self.checkpoint()
            self.act()
            slot = "setVoltage" if setting["quantity"] == "voltage" else "setCurrent"
            self.session.write(self.profile.command(slot, index=self.index(setting["channel"]), value=float(setting["value"])))
        for setting in settings:
            slot = "voltageSetpoint" if setting["quantity"] == "voltage" else "currentSetpoint"
            actual = self.session.query_float(self.profile.command(slot, index=self.index(setting["channel"])))
            readback.append({"name": setting["name"], "requested": setting["value"], "actual": actual})
        self.result["settings"] = readback
        # The outputs stayed off: the state is known from the readback.
        self.lifecycle.physical = "confirmed"
        wrong = [item["name"] for item in readback if not close_enough(item["requested"], item["actual"])]
        if wrong:
            raise Failed("readback-mismatch", f"The instrument reports other values for {', '.join(wrong)}.")

    def configure(self) -> None:
        settings = self.checked["settings"]
        self.require_off(sorted({setting["channel"] for setting in settings}))
        self.apply(settings)

    def all_off(self) -> None:
        """Every output off, then a readback; physical confirmed only when all read back off."""
        self.lifecycle.report("cleaning", "pending")
        problems: list[str] = []
        for channel in self.profile.channels:
            try:
                self.session.write(self.profile.command("outputOff", index=self.index(channel)))
            except Problem as error:
                problems.append(error.message)
        states = {}
        for channel in self.profile.channels:
            try:
                states[channel] = self.output_on(channel)
            except Problem as error:
                states[channel] = None
                problems.append(error.message)
        self.result["outputs"] = [
            {"channel": channel, "output": None if state is None else ("on" if state else "off")}
            for channel, state in states.items()
        ]
        if all(state is False for state in states.values()):
            self.lifecycle.physical = "confirmed"
            return
        self.lifecycle.physical = "unknown"
        raise Failed("readback-mismatch", "Not every output reads back off. " + " ".join(problems)[:300])

    def close(self) -> None:
        self.all_off()

    def output(self) -> None:
        channel = self.checked["channel"]
        index = self.index(channel)
        self.require_off([channel])
        self.apply(
            [
                {"name": f"{channel}.voltage", "channel": channel, "quantity": "voltage", "value": self.checked["voltage"]},
                {"name": f"{channel}.current", "channel": channel, "quantity": "current", "value": self.checked["current"]},
            ]
        )
        self.lifecycle.physical = "pending"
        hold: list[tuple[float, float, float]] = []
        stopped = False
        held = 0.0
        try:
            self.session.write(self.profile.command("outputOn", index=index))
            if self.output_on(channel) is not True:
                raise Failed("readback-mismatch", f"{channel} output does not read back on.")
            # The output stays on for --hold seconds by the clock, measured about once a second.
            start = time.monotonic()
            deadline = start + self.checked["hold"]
            while True:
                measured = self.measure_or_reconnect(channel)
                held = time.monotonic() - start
                hold.append((round(held, 3), measured["voltage"], measured["current"]))
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                if self.lifecycle.wait(min(1.0, remaining)):
                    stopped = True
                    break
        finally:
            self.switch_off(channel)
            self.result["hold"] = {
                "seconds": self.checked["hold"],
                "samples": len(hold),
                "stopped": stopped,
                **(
                    {
                        "voltage": {"min": min(v for _, v, _ in hold), "max": max(v for _, v, _ in hold), "unit": "V"},
                        "current": {"min": min(i for _, _, i in hold), "max": max(i for _, _, i in hold), "unit": "A"},
                    }
                    if hold
                    else {}
                ),
            }
            if hold and self.result.folder is not None:
                text = "time_s,volts,amps\n" + "".join(f"{t:g},{v:.9g},{i:.9g}\n" for t, v, i in hold)
                self.result["series"] = [
                    {"channel": channel, "points": len(hold), "columns": ["time_s", "volts", "amps"], "file": self.result.write(f"hold-{channel}.csv", text.encode())}
                ]
        if stopped:
            raise Incomplete("stopped", f"A stop request ended the hold after {held:.1f} s; the output is off.")

    def measure_or_reconnect(self, channel: str) -> dict[str, float]:
        try:
            return self.measure(channel)
        except Incomplete as error:
            if error.code != "connection-lost":
                raise
            self.result.problem("connection-lost", error.message)
            self.reconnect()
            self.result.problem("reconnected", "The connection was opened again and the identity checked; the output is being switched off.")
            raise Incomplete("connection-lost", "The connection was lost during the hold; the output was switched off after reconnecting.") from error

    def reconnect(self) -> None:
        self.session.close()
        self.session.open()
        expected = self.session.identity
        identity = self.session.identify(self.entry.serial)
        if expected is not None and identity.serial != expected.serial:
            raise Blocked("identity-mismatch", "After reconnecting, another instrument answered.")

    def switch_off(self, channel: str) -> None:
        self.lifecycle.report("cleaning")
        index = self.index(channel)
        try:
            self.session.write(self.profile.command("outputOff", index=index))
            state = self.output_on(channel)
        except Problem as error:
            if error.code == "connection-lost":
                try:
                    self.reconnect()
                    self.result.problem("reconnected", "Reconnected to switch the output off.")
                    self.session.write(self.profile.command("outputOff", index=index))
                    state = self.output_on(channel)
                except Problem as again:
                    self.lifecycle.physical = "unknown"
                    self.result.fail(Incomplete("connection-lost", f"The output could not be switched off: {again.message}"))
                    return
            else:
                self.lifecycle.physical = "unknown"
                self.result.fail(error)
                return
        if state is False:
            self.lifecycle.physical = "confirmed"
        else:
            self.lifecycle.physical = "unknown"
            self.result.fail(Failed("readback-mismatch", f"{channel} output does not read back off after the hold."))


# --- multimeter --------------------------------------------------------------------------------------------------


class Dmm(Operation):
    def function(self) -> str:
        return self.session.query(self.profile.command("function")).strip().strip('"').upper()

    def spec(self, function: str) -> dict[str, Any] | None:
        return self.profile.data["functions"].get(function)

    def read(self) -> None:
        function = self.function()
        spec = self.spec(function)
        value, raw = self.session.query_value(self.profile.command("read"))
        overload = abs(value) >= float(self.profile.data.get("overload", math.inf))
        self.result["values"] = [
            {
                "quantity": spec["name"] if spec else None,
                "function": function,
                "channel": "main",
                "value": None if overload else value,
                "unit": spec["unit"] if spec else None,
                "raw": raw,
                **({"overload": True} if overload else {}),
            }
        ]
        if spec is None:
            self.result.problem("profile-unknown", f"Function {function!r} is not described by profile {self.profile.id}; no unit is given.")

    def status(self) -> None:
        function = self.function()
        spec = self.spec(function)
        state: dict[str, Any] = {"function": function, "quantity": spec["name"] if spec else None}
        if spec and spec.get("ranges"):
            state["range"] = self.session.query_float(self.profile.command("range", function=function))
            state["autoRange"] = self.session.query(self.profile.command("autoRange", function=function)) in ("1", "ON")
        self.result["settings"] = [state]

    def configure(self) -> None:
        settings = {setting["name"]: setting for setting in self.checked["settings"]}
        target = settings["function"]["scpi"] if "function" in settings else self.function()
        spec = self.spec(target)
        if "range" in settings and settings["range"]["value"] != "auto":
            # Checked against every range before opening; here against the function now selected.
            ranges = (spec or {}).get("ranges") or []
            if settings["range"]["value"] not in ranges:
                raise Refused("limit", f"Range {settings['range']['value']:g} is not one of {ranges} for {target}.")
        if "function" in settings:
            self.act()
            self.session.write(self.profile.command("setFunction", value=target))
        if "range" in settings:
            self.checkpoint()
            self.act()
            slot = "setAutoRange" if settings["range"]["value"] == "auto" else "setRange"
            self.session.write(self.profile.command(slot, function=target, value=settings["range"]["value"]))
        readback = []
        actual_function = self.function()
        if "function" in settings:
            readback.append({"name": "function", "requested": target, "actual": actual_function})
        if "range" in settings:
            if settings["range"]["value"] == "auto":
                actual = self.session.query(self.profile.command("autoRange", function=target)) in ("1", "ON")
                readback.append({"name": "range", "requested": "auto", "actual": "auto" if actual else "fixed"})
            else:
                readback.append({"name": "range", "requested": settings["range"]["value"], "actual": self.session.query_float(self.profile.command("range", function=target))})
        self.result["settings"] = readback
        self.lifecycle.physical = "confirmed"
        wrong = [
            item["name"]
            for item in readback
            if (item["requested"] != item["actual"] if isinstance(item["requested"], str) else not close_enough(item["requested"], item["actual"]))
        ]
        if wrong:
            raise Failed("readback-mismatch", f"The instrument reports other values for {', '.join(wrong)}.")

    def close(self) -> None:
        # A multimeter has no output to switch off; the identity was just read back.
        self.lifecycle.report("cleaning")
        self.lifecycle.physical = "confirmed"


# --- oscilloscope ------------------------------------------------------------------------------------------------


class Scope(Operation):
    def channel_state(self, channel: str) -> dict[str, Any]:
        command = self.profile.command
        return {
            "channel": channel,
            "displayed": self.session.query(command("display", channel=channel)) in ("1", "ON"),
            "scale": self.session.query_float(command("scale", channel=channel)),
            "offset": self.session.query_float(command("offset", channel=channel)),
            "probe": self.session.query_float(command("probe", channel=channel)),
            "bandwidthLimit": self.session.query(command("bandwidthLimit", channel=channel)),
        }

    def capture(self) -> None:
        channel = self.checked["channel"]
        command = self.profile.command
        state = self.channel_state(channel)
        if not state["displayed"]:
            raise Blocked("request", f"{channel} is not displayed; the oscilloscope has no waveform for it.")
        conditions = {
            **state,
            "timebase": self.session.query_float(command("timebase")),
            "trigger": self.session.query(command("triggerStatus")),
        }
        self.checkpoint()
        # Transfer settings only: they select what the data query returns, not what the scope acquires.
        self.session.write(command("waveformSource", channel=channel))
        self.session.write(command("waveformMode"))
        self.session.write(command("waveformFormat"))
        preamble_text = self.session.query(command("preamble"))
        form = SampleFormat.of(self.profile.data["samples"])
        try:
            preamble = parse_preamble(preamble_text, self.profile.data["preamble"])
        except BlockError as error:
            raise Incomplete("truncated-transfer", f"The preamble cannot be read: {error}.") from error
        self.checkpoint()
        data = self.session.block(command("data"), form.width * int(self.profile.data["samples"]["maxPoints"]))
        try:
            raw = samples(data, form)
        except BlockError as error:
            raise Incomplete("truncated-transfer", str(error)) from error
        if int(preamble.get("points", len(raw))) != len(raw):
            self.result.problem("truncated-transfer", f"The preamble announces {int(preamble['points'])} points, the block holds {len(raw)}.")
            self.result["status"] = "incomplete"
        points = series(raw, preamble)
        clip = clipped(raw, form)
        self.result["conditions"] = conditions
        record = {
            "format": 1,
            "channel": channel,
            "profile": self.profile.id,
            "preambleText": preamble_text,
            "preamble": preamble,
            "fields": self.profile.data["preamble"],
            "samples": form.describe(),
            "units": {"x": "s", "y": "V"},
            "conditions": conditions,
        }
        raw_name = self.result.write(f"raw-{channel}.bin", data)
        record["raw"] = {"file": raw_name.rsplit("/", 1)[-1], "sha256": self.result["artifacts"][-1]["sha256"], "bytes": len(data)}
        self.result.write(f"preamble-{channel}.json", (json.dumps(record, indent=2) + "\n").encode())
        csv = self.result.write(f"waveform-{channel}.csv", csv_text(points).encode())
        self.result["series"] = [
            {
                "channel": channel,
                "points": len(points),
                "xIncrement": preamble["xincrement"],
                "xOrigin": preamble["xorigin"],
                "unit": "V",
                "timeUnit": "s",
                "clipped": clip,
                "min": min((v for _, v in points), default=None),
                "max": max((v for _, v in points), default=None),
                "file": csv,
            }
        ]
        if clip:
            self.result.problem("clipped", f"{clip} samples sit at the converter limits; the signal may be clipped.")

    def status(self) -> None:
        self.result["settings"] = [
            {"timebase": self.session.query_float(self.profile.command("timebase")), "trigger": self.session.query(self.profile.command("triggerStatus"))},
            *[self.channel_state(channel) for channel in self.profile.channels],
        ]

    def configure(self) -> None:
        command = self.profile.command
        for setting in self.checked["settings"]:
            self.checkpoint()
            self.act()
            value = float(setting["value"])
            if setting["name"] == "timebase":
                self.session.write(command("setTimebase", value=value))
            else:
                slot = "setScale" if setting["quantity"] == "scale" else "setOffset"
                self.session.write(command(slot, channel=setting["channel"], value=value))
        readback = []
        for setting in self.checked["settings"]:
            if setting["name"] == "timebase":
                actual = self.session.query_float(command("timebase"))
            else:
                slot = "scale" if setting["quantity"] == "scale" else "offset"
                actual = self.session.query_float(command(slot, channel=setting["channel"]))
            readback.append({"name": setting["name"], "requested": setting["value"], "actual": actual})
        self.result["settings"] = readback
        self.lifecycle.physical = "confirmed"
        wrong = [item["name"] for item in readback if not close_enough(item["requested"], item["actual"])]
        if wrong:
            raise Failed("readback-mismatch", f"The instrument reports other values for {', '.join(wrong)}.")

    def close(self) -> None:
        # An oscilloscope has no output to switch off; the identity was just read back.
        self.lifecycle.report("cleaning")
        self.lifecycle.physical = "confirmed"


CLASSES = {"psu": Psu, "dmm": Dmm, "scope": Scope}
