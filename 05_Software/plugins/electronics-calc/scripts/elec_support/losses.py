"""Operation `losses` (spec REQ-DATA-3d15fdfc §5.4). Datasheet values are used as supplied: nothing is scaled to
other conditions, read from a graph or defaulted."""

from __future__ import annotations

from .contract import Reader, Result, shown
from .waveforms import SYMMETRIC, current, report_current

STEADY = "Steady-state average power over one period; no thermal feedback on the electrical parameters."
WHOLE_PERIOD = "The RMS and average currents cover the whole period, so no duty cycle is applied to them again."


def linear_regulator(reader: Reader, result: Result) -> None:
    vin = reader.value("vin", "voltage")
    vout = reader.value("vout", "voltage")
    iout = reader.value("iout", "current")
    iq = reader.value("iq", "current", required=False)
    neglect = reader.boolean("neglectIq")
    dropout = reader.value("dropout", "voltage", required=False)
    reader.close()
    if not reader.problems:
        if iq is None and neglect is not True:
            reader.fail(
                "insufficient",
                "iq",
                "Give the quiescent (ground-pin) current iq from the datasheet, or set neglectIq to true to neglect it explicitly.",
            )
        if iq is not None and neglect is True:
            reader.fail("contradiction", "neglectIq", "iq is given, so it cannot be neglected; remove one of the two.")
        if vin < vout:  # type: ignore[operator]
            reader.fail("contradiction", "vin", "A linear regulator cannot deliver an output above its input voltage.")
    reader.check()
    assert vin is not None and vout is not None and iout is not None
    quiescent = 0.0 if iq is None else iq
    dissipated = (vin - vout) * iout + vin * quiescent
    p_in = vin * (iout + quiescent)
    p_out = vout * iout
    result.add("pDissipated", dissipated, "power")
    result.add("pInput", p_in, "power")
    result.add("pOutput", p_out, "power")
    if p_in > 0:
        result.add("efficiency", p_out / p_in, "ratio")
    else:
        result.warn("The efficiency is undefined at zero input power.")
    result.formulas += [
        "P_diss = (V_in - V_out) * I_out + V_in * I_q",
        "P_in = V_in * (I_out + I_q)",
        "P_out = V_out * I_out",
        "efficiency = P_out / P_in",
    ]
    result.assumptions.append("The whole output current flows from V_in to V_out through the pass element.")
    if iq is None:
        result.assumptions.append("The quiescent current is neglected at the caller's request (neglectIq): I_q = 0.")
    else:
        result.assumptions.append("The ground-pin current I_q flows from V_in to ground: P_q = V_in * I_q.")
    if dropout is None:
        result.check("dropout", "not-evaluated", "No dropout voltage was given.")
    else:
        passed = vin - vout >= dropout * (1 - 1e-12)
        result.check(
            "dropout",
            "pass" if passed else "fail",
            f"The headroom V_in - V_out is {'at least' if passed else 'below'} the dropout voltage at its stated conditions.",
        )
    result.limits += [STEADY, "DC operating point: no line or load transients, no thermal shutdown or current limit."]


def resistor(reader: Reader, result: Result) -> None:
    resistance = reader.value("resistance", "resistance", sign="positive")
    flow = current(reader, "current", required=False)
    voltage = reader.value("voltageRms", "voltage", required=False)
    rated = reader.value("ratedPower", "power", required=False, sign="positive")
    derating = reader.obj("derating")
    full_until = zero_at = None
    if derating is not None:
        full_until = derating.value("fullPowerUpTo", "temperature", role="absolute")
        zero_at = derating.value("zeroPowerAt", "temperature", role="absolute")
    ambient = reader.value("tAmbient", "temperature", required=False, role="absolute")
    reader.close()
    if not reader.problems:
        if "current" in reader.data and voltage is not None:
            reader.fail("contradiction", "", "Give the current or voltageRms, not both.")
        elif "current" not in reader.data and voltage is None:
            reader.fail("insufficient", "current", "Give the current descriptor or voltageRms.")
        if derating is not None:
            if rated is None:
                reader.fail("insufficient", "ratedPower", "A derating line needs the rated power.")
            if ambient is None:
                reader.fail("insufficient", "tAmbient", "A derating line needs the ambient temperature.")
            if zero_at <= full_until:  # type: ignore[operator]
                reader.fail("contradiction", "derating", "zeroPowerAt must be above fullPowerUpTo.")
    reader.check()
    assert resistance is not None
    if flow is not None:
        power = flow.rms * flow.rms * resistance
        report_current(result, flow)
        result.formulas.append("P = I_rms^2 * R")
        result.assumptions.append(WHOLE_PERIOD)
    else:
        assert voltage is not None
        power = voltage * voltage / resistance
        result.formulas.append("P = V_rms^2 / R")
    result.add("power", power, "power")
    if rated is None:
        result.check("power-rating", "not-evaluated", "No rated power was given.")
    else:
        allowed = rated
        if derating is not None:
            assert ambient is not None and zero_at is not None and full_until is not None
            allowed = rated * min(1.0, max(0.0, (zero_at - ambient) / (zero_at - full_until)))
            result.formulas.append("P_allowed = P_rated * clamp((T_zero - T_A) / (T_zero - T_full), 0, 1)")
            result.assumptions.append("Linear derating between the two supplied temperatures; ambient temperature as the reference.")
        else:
            result.assumptions.append("The rated power is used without temperature derating.")
        result.add("allowedPower", allowed, "power")
        if allowed > 0:
            result.add("powerUtilization", power / allowed, "ratio")
        passed = power <= allowed * (1 + 1e-12)
        result.check(
            "power-rating",
            "pass" if passed else "fail",
            f"The dissipation {'does not exceed' if passed else 'exceeds'} the allowed power.",
        )
    if ambient is not None and derating is None:
        result.warn("tAmbient was given without a derating line and is not used.")
    result.limits += [STEADY, "Constant resistance; pulse-overload ratings and the voltage rating are not checked."]


def mosfet(reader: Reader, result: Result) -> None:
    flow = current(reader, "current")
    rds_on = reader.quantity("rdsOn", "resistance", sign="positive")
    frequency = reader.value("frequency", "frequency", required=False, sign="positive")
    switching = reader.obj("switching")
    method = None
    energies = overlap = None
    if switching is not None:
        method = switching.choice("method", ("energy", "linear-overlap"))
        if method == "energy":
            energies = (switching.value("eOn", "energy"), switching.value("eOff", "energy"))
        elif method == "linear-overlap":
            overlap = (
                switching.value("vds", "voltage"),
                switching.value("id", "current"),
                switching.value("tRise", "time"),
                switching.value("tFall", "time"),
            )
        else:
            switching.mark(*switching.data)
    gate = reader.obj("gateDrive")
    charge = drive = None
    if gate is not None:
        charge = gate.value("qg", "charge")
        drive = gate.value("vDrive", "voltage")
    reader.close()
    if not reader.problems and (switching is not None or gate is not None) and frequency is None:
        reader.fail("insufficient", "frequency", "Switching and gate-drive losses need the switching frequency.")
    reader.check()
    assert flow is not None and rds_on is not None
    conduction = flow.rms * flow.rms * rds_on.si
    report_current(result, flow)
    result.add("pConduction", conduction, "power")
    result.formulas.append("P_cond = I_rms^2 * R_DS(on)")
    result.assumptions += [
        WHOLE_PERIOD,
        "R_DS(on) is used as supplied for its stated conditions; no temperature or gate-voltage scaling is applied.",
    ]
    device = conduction
    if energies is not None:
        assert frequency is not None
        loss = (energies[0] + energies[1]) * frequency  # type: ignore[operator]
        result.add("pSwitching", loss, "power")
        device += loss
        result.formulas.append("P_sw = (E_on + E_off) * f")
        result.assumptions.append(
            "Switching loss from the supplied turn-on and turn-off energies at their test conditions; they are not "
            "scaled to another voltage, current, temperature or gate resistance."
        )
    elif overlap is not None:
        assert frequency is not None
        vds, drain, rise, fall = overlap
        loss = 0.5 * vds * drain * (rise + fall) * frequency  # type: ignore[operator]
        result.add("pSwitching", loss, "power")
        device += loss
        result.formulas.append("P_sw = 0.5 * V_DS * I_D * (t_r + t_f) * f")
        result.assumptions.append(
            "Linear-overlap approximation of the switching loss: voltage and current cross linearly during the "
            "supplied rise and fall times; output-capacitance and reverse-recovery losses are not included."
        )
    result.add("pDevice", device, "power")
    result.formulas.append("P_device = P_cond + P_sw")
    if charge is not None and drive is not None:
        assert frequency is not None
        result.add("pGateDrive", charge * drive * frequency, "power")
        result.formulas.append("P_gate = Q_g * V_drive * f")
        result.assumptions.append(
            "The gate-drive power is dissipated in the driver and the gate resistors; it is reported separately and "
            "is not part of the device loss."
        )
    if rds_on.conditions is None:
        result.check("rdson-conditions", "unknown", "R_DS(on) was given without its conditions.")
        result.warn(
            "R_DS(on) was given without conditions (gate voltage, junction temperature); the value may not apply to "
            "this operating point."
        )
    else:
        result.check("rdson-conditions", "pass", f"R_DS(on) conditions declared: {rds_on.conditions}")
    if frequency is not None and switching is None and gate is None:
        result.warn("frequency was given without switching or gate-drive data and is not used.")
    result.limits += [STEADY, "Body-diode conduction, dead-time and output-capacitance losses are not modelled."]


def diode(reader: Reader, result: Result) -> None:
    forward = reader.value("vf", "voltage")
    flow = current(reader, "current")
    dynamic = reader.value("rd", "resistance", required=False)
    recovery = {
        "qrr": reader.value("qrr", "charge", required=False),
        "vr": reader.value("vr", "voltage", required=False),
        "frequency": reader.value("frequency", "frequency", required=False, sign="positive"),
    }
    reader.close()
    present = [name for name in recovery if name in reader.data]
    if not reader.problems:
        if flow is not None and flow.form in SYMMETRIC:
            reader.fail("contradiction", "current", "A diode conducts in one direction; give a pulse, a dc value or rms with average.")
        elif flow is not None and flow.average is None:
            reader.fail("insufficient", "current", "The forward loss needs the average current; add average to the rms value.")
        if 0 < len(present) < 3:
            missing = next(name for name in recovery if name not in reader.data)
            reader.fail("insufficient", missing, "The reverse-recovery loss needs qrr, vr and frequency together.")
    reader.check()
    assert forward is not None and flow is not None and flow.average is not None
    loss = forward * flow.average
    result.formulas.append("P_F = V_F * I_avg + r_d * I_rms^2")
    if dynamic is not None:
        loss += dynamic * flow.rms * flow.rms
    report_current(result, flow)
    result.add("pForward", loss, "power")
    total = loss
    result.assumptions += [
        WHOLE_PERIOD,
        "Constant forward voltage (plus the dynamic resistance when given) as supplied for its stated conditions.",
    ]
    if len(present) == 3:
        reverse = recovery["qrr"] * recovery["vr"] * recovery["frequency"]  # type: ignore[operator]
        result.add("pReverseRecovery", reverse, "power")
        total += reverse
        result.formulas.append("P_rr = Q_rr * V_R * f")
        result.assumptions.append(
            "Reverse-recovery approximation: the whole recovery charge is removed at the full reverse voltage in "
            "every cycle; the part dissipated in the switch is not separated."
        )
    result.add("pTotal", total, "power")
    result.formulas.append("P_total = P_F + P_rr")
    result.limits += [STEADY, "Leakage loss and the temperature dependence of V_F are not modelled."]


def capacitor(reader: Reader, result: Result) -> None:
    esr = reader.value("esr", "resistance", sign="positive")
    flow = current(reader, "current")
    reader.done()
    assert esr is not None and flow is not None
    report_current(result, flow)
    result.add("pEsr", flow.rms * flow.rms * esr, "power")
    result.formulas.append("P_ESR = I_rms^2 * ESR")
    result.assumptions += [WHOLE_PERIOD, "The ESR is used as supplied for its stated frequency and temperature."]
    result.limits += [STEADY, "Only the ESR loss: dielectric and leakage losses are not modelled, and one ESR value is used for the whole ripple spectrum."]


def inductor(reader: Reader, result: Result) -> None:
    dcr = reader.value("dcr", "resistance", sign="positive")
    flow = current(reader, "current")
    core = reader.value("coreLoss", "power", required=False)
    reader.done()
    assert dcr is not None and flow is not None
    copper = flow.rms * flow.rms * dcr
    report_current(result, flow)
    result.add("pCopper", copper, "power")
    result.formulas.append("P_copper = I_rms^2 * DCR")
    result.assumptions.append(WHOLE_PERIOD)
    if core is None:
        result.add("pTotal", copper, "power")
        result.check("core-loss", "not-evaluated", "No core-loss value was supplied.")
        result.warn("Core loss is not estimated without a core model or a supplied value; pTotal holds the copper loss only.")
        result.formulas.append("P_total = P_copper")
    else:
        result.add("pCore", core, "power")
        result.add("pTotal", copper + core, "power")
        result.check("core-loss", "pass", "The core loss was supplied by the request and added as given.")
        result.formulas.append("P_total = P_copper + P_core")
    result.limits += [STEADY, "DC resistance only: skin and proximity effects (AC resistance) are not modelled; no saturation check."]


def power_budget(reader: Reader, result: Result) -> None:
    loads = reader.objects("loads", low=1, high=64)
    powers: list[tuple[str, float]] = []
    for index, load in enumerate(loads or []):
        name = load.text("name")
        power = load.value("power", "power", required=False)
        voltage = load.value("voltage", "voltage", required=False)
        flow = load.value("current", "current", required=False)
        direct = "power" in load.data
        product = "voltage" in load.data or "current" in load.data
        if direct and product:
            reader.fail("contradiction", f"loads.{index}", "Give power, or voltage and current, not both.")
        elif not direct and ("voltage" not in load.data or "current" not in load.data):
            reader.fail("insufficient", f"loads.{index}", "Give power, or voltage and current.")
        elif name is not None:
            if direct and power is not None:
                powers.append((name, power))
            elif not direct and voltage is not None and flow is not None:
                powers.append((name, voltage * flow))
    efficiency = reader.ratio("efficiency", required=False, low_open=True)
    source = reader.value("sourceVoltage", "voltage", required=False, sign="positive")
    reader.close()
    if not reader.problems and source is not None and "efficiency" not in reader.data:
        reader.fail("insufficient", "efficiency", "The input current needs the supply efficiency.")
    reader.check()
    total = sum(power for _, power in powers)
    result.add("pLoads", total, "power")
    result.formulas.append("P_loads = sum(P_k), P_k = V_k * I_k")
    result.details["loads"] = [{"name": name, "power": shown(power, "power")} for name, power in powers]
    if efficiency is not None:
        p_in = total / efficiency
        result.add("efficiency", efficiency, "ratio")
        result.add("pInput", p_in, "power")
        result.add("pLoss", p_in - total, "power")
        result.formulas += ["P_in = P_loads / efficiency", "P_loss = P_in - P_loads"]
        result.assumptions.append("One supply stage with the given efficiency at this load; the efficiency is not a function of load here.")
        if source is not None:
            result.add("inputCurrent", p_in / source, "current")
            result.formulas.append("I_in = P_in / V_source")
    result.assumptions.append("Load powers are simultaneous steady-state values.")
    result.limits += [STEADY, "No margins, start-up currents or sequencing; add them as separate loads."]


MODELS = {
    "losses": {
        "linear-regulator": linear_regulator,
        "resistor": resistor,
        "mosfet": mosfet,
        "diode": diode,
        "capacitor": capacitor,
        "inductor": inductor,
        "power-budget": power_budget,
    }
}
