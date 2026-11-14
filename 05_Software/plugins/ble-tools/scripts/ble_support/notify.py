"""Notification capture of ble-tool (spec REQ-DATA-e8502710 section 7): the Bleak callback only stamps and queues;
the writer drains a bounded queue into notifications.jsonl and series.csv, checks the rate and ends at the first bound
(REQ-FUNC-fe487751, REQ-REL-d832225a, REQ-REL-92d16a4c). The subscription is stopped by Link.close on every path.
"""

from __future__ import annotations

import asyncio
import csv
import json
import time
from pathlib import Path
from typing import Any

from . import payload as payloads
from . import workspace
from .device import Link
from .profile import Characteristic
from .report import Ended, stamp

QUEUE = 1024
POLL = 0.1


async def capture(link: Link, char: Characteristic, args: Any, folder: Path, cwd: Path) -> None:
    profile = link.profile
    assert profile is not None
    limit = min(args.max_notifications or profile.limits["maxNotifications"], profile.limits["maxNotifications"])
    max_bytes = profile.limits["maxBytes"]
    per_second = profile.limits["maxNotificationsPerSecond"]
    queue: asyncio.Queue[tuple[str, float, bytes]] = asyncio.Queue(QUEUE)
    overflow = {"dropped": 0, "full": False}

    def received(_sender: Any, data: bytearray) -> None:
        try:
            queue.put_nowait((stamp(), time.monotonic(), bytes(data)))
        except asyncio.QueueFull:
            overflow["dropped"] += 1
            overflow["full"] = True

    jsonl = folder / "notifications.jsonl"
    series = folder / "series.csv"
    summary: dict[str, Any] = {"count": 0, "bytes": 0, "dropped": 0, "invalid": 0, "file": workspace.relative(cwd, jsonl), "csv": workspace.relative(cwd, series), "limit": limit, "endedBy": None}
    link.document["notifications"] = summary
    link.check_link()
    # Listed before the call: a CCCD written before a failure is still turned off by Link.close.
    link.subscribed.append(link.chars[char.name])
    try:
        await asyncio.wait_for(link.client.start_notify(link.chars[char.name], received), timeout=link.timeout)
    except asyncio.TimeoutError as error:
        raise Ended("incomplete", "timeout", f"Enabling notifications on {char.name} took longer than {link.timeout:g} s.") from error
    except link.backend.exc.BleakError as error:
        link.check_link()
        raise link.backend.ended(error, f"enabling notifications on {char.name}") from error
    link.subscription = "active"
    link.lifecycle.report("acting")
    deadline = time.monotonic() + args.duration
    window: list[float] = []
    ended = None
    with jsonl.open("w", encoding="utf-8", newline="\n") as lines, series.open("w", encoding="utf-8", newline="") as table:
        writer = csv.writer(table, lineterminator="\n")
        writer.writerow(["index", "receivedAt", "raw", "value", "unit", "valid", "decodeError"])
        while ended is None:
            try:
                received_at, moment, data = await asyncio.wait_for(queue.get(), timeout=POLL)
            except asyncio.TimeoutError:
                received_at = None
            if received_at is not None:
                window = [value for value in window if moment - value < 1.0] + [moment]
                decoded = payloads.decode(char.payload, data)
                summary["count"] += 1
                summary["bytes"] += len(data)
                if not decoded["valid"]:
                    summary["invalid"] += 1
                line = {"index": summary["count"], "receivedAt": received_at, **decoded}
                lines.write(json.dumps(line, ensure_ascii=False) + "\n")
                writer.writerow([line["index"], received_at, decoded["raw"], "" if decoded["value"] is None else decoded["value"], decoded["unit"], decoded["valid"], decoded["decodeError"] or ""])
                if len(window) > per_second or overflow["full"]:
                    ended = "overflow"
                elif summary["count"] >= limit:
                    ended = "max-notifications"
                elif summary["bytes"] >= max_bytes:
                    ended = "max-bytes"
            if ended is None:
                if link.lost:
                    ended = "disconnected"
                elif link.lifecycle.stop_requested():
                    ended = "stopped"
                elif time.monotonic() >= deadline:
                    ended = "duration"
    summary["dropped"] = overflow["dropped"] + queue.qsize()
    summary["endedBy"] = ended
    if ended == "overflow":
        raise Ended("incomplete", "overflow", f"More than {per_second} notifications per second (or a full queue) arrived; the subscription was stopped after {summary['count']}, {summary['dropped']} dropped.")
    if ended == "disconnected":
        link.check_link()
    if ended == "stopped":
        raise Ended("incomplete", "stopped", "VERA asked the run to stop; the subscription was turned off.")
