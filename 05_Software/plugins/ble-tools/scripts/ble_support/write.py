"""Writes of ble-tool (spec REQ-DATA-e8502710 section 6): only a named write operation of the profile, its payload
settled before the radio is used, checked against one ATT write, sent once and never retried (REQ-SEC-74530dd0,
REQ-SEC-a637b83d, REQ-SEC-3b098df7, REQ-REL-4706f92a, REQ-REL-efdfb040).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from . import payload as payloads
from .device import Link
from .profile import Characteristic, Profile, Write
from .report import Ended, refused

ATT_WRITE_MAX = 512


@dataclass(frozen=True)
class Plan:
    char: Characteristic
    write: Write
    data: bytes


def plan(args: Any, profile: Profile) -> Plan:
    """Checks the request against the profile; nothing is on the radio yet."""
    char = profile.characteristics.get(args.characteristic)
    if char is None:
        raise refused("operation-not-allowed", f"The profile declares no characteristic {args.characteristic}.")
    if "write" not in char.operations:
        raise refused("operation-not-allowed", f"The profile does not allow writes to {char.name}.")
    write = char.writes.get(args.write)
    if write is None:
        raise refused("write-unknown", f"{char.name} declares no write operation {args.write}; it has {', '.join(char.writes)}. ble-tool sends no raw bytes.")
    if write.klass == "persistent" and not args.persistent:
        raise refused("write-class", f"{char.name}.{write.name} is persistent: it is stored on the device and survives a reset. Name --persistent to write it on purpose.")
    if write.klass != "persistent" and args.persistent:
        raise refused("write-class", f"{char.name}.{write.name} is {write.klass}, not persistent; remove --persistent.")
    if write.value == "fixed":
        if args.value is not None:
            raise refused("arguments", f"{char.name}.{write.name} sends fixed data; --value does not apply.")
        data = write.data
    else:
        data = payloads.encode(char.payload, args.value)
    if len(data) > ATT_WRITE_MAX:
        raise refused("payload-too-large", f"{len(data)} bytes exceed one ATT write ({ATT_WRITE_MAX}).")
    return Plan(char, write, data)


async def send(link: Link, request: Plan, document: dict[str, Any]) -> None:
    device = link.chars[request.char.name]
    link.check_link()
    if request.write.response:
        allowed = min(ATT_WRITE_MAX, int(getattr(link.client, "mtu_size", 23)) - 3)
    else:
        allowed = int(getattr(device, "max_write_without_response_size", 20))
    result: dict[str, Any] = {
        "characteristic": request.char.name,
        "uuid": request.char.uuid,
        "name": request.write.name,
        "class": request.write.klass,
        "data": request.data.hex(),
        "length": len(request.data),
        "response": request.write.response,
        "delivery": "not-sent",
        "retried": False,
        "effect": "unknown",
        "readBack": None,
    }
    document["write"] = result
    if len(request.data) > allowed:
        raise Ended("blocked", "payload-too-large", f"{len(request.data)} bytes exceed one ATT write on this link ({allowed} bytes{' at MTU ' + str(link.client.mtu_size) if request.write.response else ' without response'}); nothing was sent and ble-tool does not fragment writes.")
    link.check_link()
    link.lifecycle.report("acting")
    # From here the write may be on the air: only an ATT error or a return makes the delivery known.
    result["delivery"] = "unknown"
    try:
        await asyncio.wait_for(link.client.write_gatt_char(device, request.data, response=request.write.response), timeout=link.timeout)
    except asyncio.TimeoutError as error:
        raise Ended("incomplete", "timeout", f"The write did not complete within {link.timeout:g} s; it may have reached the device and is not sent again.") from error
    except link.backend.exc.BleakError as error:
        if link.lost or "not connected" in str(error).lower():
            link.lost = True
            link.check_link()
        ended = link.backend.ended(error, f"writing {request.char.name}")
        if "attError" in ended.fields:
            result["delivery"] = "refused"
            result["attError"] = ended.fields["attError"]
        raise ended from error
    result["delivery"] = "acknowledged" if request.write.response else "sent"
    if request.write.read_back:
        value = await link.read(request.char)
        result["readBack"] = {**value, "matches": value["raw"] == request.data.hex()}
        if result["readBack"]["matches"]:
            result["effect"] = "read-back"
        else:
            raise Ended("fail", "read-back", f"{request.char.name} reads {value['raw']} after writing {request.data.hex()}; the device did not keep the value.")
