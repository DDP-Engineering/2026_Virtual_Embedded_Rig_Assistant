"""The JS220 through pyjoulescope_driver (spec REQ-DATA-dd3e4fe1 section 5, REQ-SEC-f040d125).

Every setting goes through `MeterSession.set`, which knows only the allowed topics: the sample rate, the current
range mode (auto or manual, never off) and selection, the voltage range mode (manual) and selection, and the signal
controls. The meter is opened with `restore`: its defaults are never applied. Nothing here can write a
general-purpose output, start a firmware or FPGA update, calibrate or reset the device.
"""

from __future__ import annotations

import json
import time
from typing import Any, Callable

from .errors import Problem
from .profiles import normal

SETTINGS = ("h/fs", "s/i/range/mode", "s/i/range/select", "s/v/range/mode", "s/v/range/select")
SIGNALS = ("s/i/ctrl", "s/v/ctrl", "s/p/ctrl", "s/i/range/ctrl", "s/gpi/0/ctrl", "s/gpi/1/ctrl", "s/gpi/2/ctrl",
           "s/gpi/3/ctrl")
VERSIONS = {"hardware": "c/hw/version", "firmware": "c/fw/version", "fpga": "s/fpga/version"}
TIMEOUT = 2.0


def driver_module() -> Any:
    """pyjoulescope_driver, imported only by the live operations."""
    try:
        import pyjoulescope_driver  # type: ignore[import-not-found]
    except ImportError as error:
        raise Problem("driver", f"pyjoulescope_driver cannot be imported: {error}. Provision the power-profile program "
                      "through VERA (it pins pyjoulescope_driver 2.5.5).", "blocked") from error
    return pyjoulescope_driver


def driver_version(module: Any) -> str:
    return str(getattr(module, "__version__", "unknown"))


def version_text(value: Any) -> str:
    """A u32 version major.minor.patch as the vendor's tools print it; text as it is."""
    if isinstance(value, int) and not isinstance(value, bool):
        return f"{(value >> 24) & 0xFF}.{(value >> 16) & 0xFF}.{value & 0xFFFF}"
    return str(value)


class MeterSession:
    """One opened meter. `publishes` records every topic written (the test oracle of the allow-list)."""

    def __init__(self, module: Any, path: str) -> None:
        self.module = module
        self.path = path
        self.driver: Any = None
        self.opened = False
        self.removed = False
        self.publishes: list[tuple[str, Any]] = []
        self._names: dict[str, list[tuple[Any, list[str]]]] = {}
        self._remove_fn: Callable[[str, Any], None] | None = None

    # ---- open / close ----

    def present(self) -> bool:
        if self.driver is None:
            try:
                self.driver = self.module.Driver()
            except Exception as error:  # the driver's own errors are not a stable type
                raise Problem("driver", f"pyjoulescope_driver could not start: {error}", "blocked") from error
        try:
            paths = [str(path) for path in self.driver.device_paths()]
        except Exception as error:
            raise Problem("driver", f"The driver could not list devices: {error}", "blocked") from error
        return self.path.casefold() in (path.casefold() for path in paths)

    def open(self) -> None:
        try:
            self.driver.open(self.path, "restore")
        except Exception as error:
            raise Problem("driver", f"{self.path} could not be opened: {error}", "blocked") from error
        self.opened = True

        def on_remove(_topic: str, value: Any) -> None:
            if str(value).casefold() == self.path.casefold():
                self.removed = True

        self._remove_fn = on_remove
        try:
            self.driver.subscribe("@/!remove", "pub", on_remove)
        except Exception:
            self._remove_fn = None

    def close(self) -> None:
        if self.driver is None:
            return
        if self._remove_fn is not None:
            try:
                self.driver.unsubscribe("@/!remove", self._remove_fn)
            except Exception:
                pass
        if self.opened and not self.removed:
            try:
                self.driver.close(self.path)
            except Exception:
                pass
        self.opened = False
        try:
            self.driver.finalize()
        except Exception:
            pass
        self.driver = None

    # ---- values ----

    def query(self, topic: str) -> Any:
        try:
            return self.driver.query(f"{self.path}/{topic}", timeout=TIMEOUT)
        except Exception as error:
            raise Problem("driver", f"Reading {topic} failed: {error}") from error

    def versions(self) -> dict[str, str | None]:
        found: dict[str, str | None] = {}
        for name, topic in VERSIONS.items():
            try:
                found[name] = version_text(self.query(topic))
            except Problem:
                found[name] = None
        return found

    def _options(self, topic: str) -> list[tuple[Any, list[str]]]:
        """(value, names) of each option in the topic's metadata (`<topic>$`); empty when the device lists none."""
        if topic in self._names:
            return self._names[topic]
        options: list[tuple[Any, list[str]]] = []
        try:
            meta = self.driver.query(f"{self.path}/{topic}$", timeout=TIMEOUT)
            if isinstance(meta, str):
                meta = json.loads(meta)
            for option in meta.get("options", []) if isinstance(meta, dict) else []:
                if isinstance(option, (list, tuple)) and len(option) >= 2:
                    options.append((option[0], [str(alias) for alias in option[1:]]))
        except Exception:
            options = []
        self._names[topic] = options
        return options

    def name(self, topic: str, value: Any) -> Any:
        """A value as its option name when the metadata lists it; other values as they are."""
        if isinstance(value, str):
            return value
        return next((names[0] for option, names in self._options(topic) if option == value), value)

    def value(self, topic: str, name: Any) -> Any:
        """An option name as the device's value when the metadata lists it; anything else as it is."""
        if not isinstance(name, str):
            return name
        wanted = normal(name)
        return next((option for option, names in self._options(topic) if any(normal(n) == wanted for n in names)), name)

    def read(self) -> dict[str, Any]:
        """The current settings, named by the metadata when it lists them."""
        found: dict[str, Any] = {}
        for topic in SETTINGS:
            try:
                found[topic] = self.name(topic, self.query(topic))
            except Problem:
                found[topic] = None
        return found

    def set(self, topic: str, value: Any) -> None:
        """Writes one allowed setting; option names are sent as the device's value when the metadata lists them."""
        if topic not in SETTINGS and topic not in SIGNALS:
            raise Problem("internal", f"{topic} is not a topic power-profile may write.")
        if topic == "s/i/range/mode" and not (isinstance(value, str) and normal(value) in ("auto", "manual")):
            raise Problem("internal", "The current range mode may only be set to auto or manual, by name.")
        if topic == "s/v/range/mode" and not (isinstance(value, str) and normal(value) == "manual"):
            raise Problem("internal", "The voltage range mode may only be set to manual.")
        sent = self.value(topic, value)
        self.publishes.append((topic, value))
        try:
            self.driver.publish(f"{self.path}/{topic}", sent, timeout=TIMEOUT)
        except Exception as error:
            raise Problem("driver", f"Writing {topic} failed: {error}") from error

    def restore(self, topic: str, value: Any) -> None:
        """Writes back a setting's value from before the capture; the current range mode is never set off."""
        if topic not in SETTINGS:
            raise Problem("internal", f"{topic} is not a setting power-profile restores.")
        if topic == "s/i/range/mode" and not (isinstance(value, str) and normal(value) in ("auto", "manual")):
            raise Problem("internal", "The current range mode is restored only to auto or manual, by name; never off.")
        self.publishes.append((topic, value))
        try:
            self.driver.publish(f"{self.path}/{topic}", self.value(topic, value), timeout=TIMEOUT)
        except Exception as error:
            raise Problem("driver", f"Restoring {topic} failed: {error}") from error

    @staticmethod
    def current_path(settings: dict[str, Any]) -> str:
        """`on` (range mode auto or manual by name), `off`, or `unknown`: a raw value the metadata does not name, or
        no value, is never taken for a closed current path."""
        mode = settings.get("s/i/range/mode")
        if not isinstance(mode, str):
            return "unknown"
        name = normal(mode)
        return "on" if name in ("auto", "manual") else "off" if name == "off" else "unknown"

    # ---- streaming ----

    def subscribe(self, topic: str, fn: Callable[[str, Any], None]) -> None:
        try:
            self.driver.subscribe(f"{self.path}/{topic}", "pub", fn)
        except Exception as error:
            raise Problem("driver", f"Subscribing to {topic} failed: {error}") from error

    def unsubscribe(self, topic: str, fn: Callable[[str, Any], None]) -> None:
        try:
            self.driver.unsubscribe(f"{self.path}/{topic}", fn)
        except Exception:
            pass


def equal(left: Any, right: Any) -> bool:
    if isinstance(left, str) or isinstance(right, str):
        return normal(str(left)) == normal(str(right))
    return left == right


def wait(seconds: float) -> None:
    time.sleep(seconds)
