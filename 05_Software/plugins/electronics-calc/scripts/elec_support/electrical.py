"""Operations `dc`, `divider` and `rc` (spec REQ-DATA-3d15fdfc §5.1-5.3)."""

from __future__ import annotations

import math

from .contract import NOT_FINITE, Reader, Result, refuse, shown
from .quantities import RESULT_UNITS
from .waveforms import SHAPES, SYMMETRIC, factors

OHMIC = "Ideal ohmic elements: no reactance, no temperature coefficient, no self-heating."


def _source_label(result: Result, signal: str | None) -> None:
    if signal == "rms":
        result.assumptions.append("RMS values in a resistive load: the power is the average power over a period.")
    else:
        result.assumptions.append("DC values.")


def dc_ohm(reader: Reader, result: Result) -> None:
    voltage = reader.value("voltage", "voltage", required=False)
    current = reader.value("current", "current", required=False)
    resistance = reader.value("resistance", "resistance", required=False, sign="positive")
    power = reader.value("power", "power", required=False)
    signal = reader.choice("signal", ("dc", "rms"), required=False, default="dc")
    reader.close()
    given = [name for name in ("voltage", "current", "resistance", "power") if name in reader.data]
    if not reader.problems and len(given) != 2:
        reader.fail("schema", "", "Give exactly two of voltage, current, resistance and power.")
    reader.check()

    def zero(name: str) -> None:
        reader.fail("domain", "", f"This pair divides by zero: {name} must be greater than zero.")
        reader.check()

    if voltage is not None and current is not None:
        if current == 0:
            zero("current")
        resistance, power = voltage / current, voltage * current
    elif voltage is not None and resistance is not None:
        current, power = voltage / resistance, voltage * voltage / resistance
    elif current is not None and resistance is not None:
        voltage, power = current * resistance, current * current * resistance
    elif power is not None and resistance is not None:
        voltage, current = math.sqrt(power * resistance), math.sqrt(power / resistance)
    elif power is not None and voltage is not None:
        if voltage == 0 or power == 0:
            zero("voltage" if voltage == 0 else "power")
        current, resistance = power / voltage, voltage * voltage / power
    elif power is not None and current is not None:
        if current == 0 or power == 0:
            zero("current" if current == 0 else "power")
        voltage, resistance = power / current, power / (current * current)
    assert voltage is not None and current is not None and resistance is not None and power is not None
    result.add("voltage", voltage, "voltage")
    result.add("current", current, "current")
    result.add("resistance", resistance, "resistance")
    result.add("power", power, "power")
    result.formulas += ["V = I * R", "P = V * I = I^2 * R = V^2 / R"]
    _source_label(result, signal)
    result.limits.append(OHMIC)


def _network(reader: Reader, result: Result, parallel: bool) -> None:
    resistors = reader.quantities("resistances", "resistance", low=1, high=64, sign="positive")
    voltage = reader.value("voltage", "voltage", required=False)
    current = reader.value("current", "current", required=False)
    signal = reader.choice("signal", ("dc", "rms"), required=False, default="dc")
    reader.close()
    if voltage is not None and current is not None:
        reader.fail("contradiction", "", "Give the voltage or the current of the source, not both.")
    reader.check()
    assert resistors is not None
    values = [item.si for item in resistors]
    total = 1 / sum(1 / value for value in values) if parallel else sum(values)
    if not total > 0:  # A conductance that overflowed leaves no resistance to report.
        raise refuse("domain", "", NOT_FINITE)
    result.add("totalResistance", total, "resistance")
    result.formulas.append("R_total = 1 / (1/R_1 + ... + 1/R_n)" if parallel else "R_total = R_1 + ... + R_n")
    elements = [{"index": index, "resistance": shown(value, "resistance")} for index, value in enumerate(values)]
    if voltage is not None or current is not None:
        if voltage is None:
            voltage = current * total  # type: ignore[operator]
        else:
            current = voltage / total
        result.add("voltage", voltage, "voltage")
        result.add("current", current, "current")  # type: ignore[arg-type]
        result.add("totalPower", voltage * current, "power")  # type: ignore[operator]
        for element, value in zip(elements, values):
            branch_voltage = voltage if parallel else current * value  # type: ignore[operator]
            branch_current = voltage / value if parallel else current
            element["voltage"] = shown(branch_voltage, "voltage")
            element["current"] = shown(branch_current, "current")  # type: ignore[arg-type]
            element["power"] = shown(branch_voltage * branch_current, "power")  # type: ignore[operator]
        result.formulas += ["V = I * R_total", "P_k = V_k * I_k"]
        _source_label(result, signal)
    result.details["elements"] = elements
    result.limits.append(OHMIC)


def dc_series(reader: Reader, result: Result) -> None:
    _network(reader, result, parallel=False)


def dc_parallel(reader: Reader, result: Result) -> None:
    _network(reader, result, parallel=True)


def dc_shunt(reader: Reader, result: Result) -> None:
    resistance = reader.value("resistance", "resistance", sign="positive")
    current = reader.value("current", "current")
    gain = reader.ratio("gain", required=False, low_open=True, high=None)
    rated = reader.value("ratedPower", "power", required=False, sign="positive")
    reader.done()
    assert resistance is not None and current is not None
    drop = current * resistance
    power = current * current * resistance
    result.add("voltageDrop", drop, "voltage")
    result.add("power", power, "power")
    result.formulas += ["V_shunt = I * R_shunt", "P = I^2 * R_shunt"]
    if gain is not None:
        result.add("outputVoltage", drop * gain, "voltage")
        result.formulas.append("V_out = gain * V_shunt")
        result.assumptions.append("Ideal amplifier: no offset, no gain error, no output limit.")
    if rated is None:
        result.check("rated-power", "not-evaluated", "No rated power was given.")
    else:
        result.add("powerUtilization", power / rated, "ratio")
        passed = power <= rated * (1 + 1e-12)
        result.check(
            "rated-power",
            "pass" if passed else "fail",
            f"Dissipation {'does not exceed' if passed else 'exceeds'} the rated power; no temperature derating applied.",
        )
    result.assumptions.append("The current is a DC or RMS value over the whole period.")
    result.limits.append(OHMIC)


def divider_resistive(reader: Reader, result: Result) -> None:
    mode = reader.choice("solveFor", ("vout", "rTop", "rBottom"), required=False, default="vout")
    vin = reader.value("vin", "voltage")
    r_top = reader.value("rTop", "resistance", required=mode in ("vout", "rBottom"), sign="positive")
    r_bottom = reader.value("rBottom", "resistance", required=mode in ("vout", "rTop"), sign="positive")
    r_load = reader.value("rLoad", "resistance", required=False, sign="positive")
    target = reader.value("vout", "voltage", required=False)
    reader.close()
    if mode is not None and not reader.problems:
        if mode == "vout" and target is not None:
            reader.fail("contradiction", "vout", "vout is the result of this mode; set solveFor to size a resistor for it.")
        if mode != "vout":
            if target is None:
                reader.fail("insufficient", "vout", f"Solving for {mode} needs the target output voltage vout.")
            elif not 0 < target < vin:  # type: ignore[operator]
                reader.fail("domain", "vout", "The target must lie strictly between 0 V and vin.")
            if (mode == "rTop" and r_top is not None) or (mode == "rBottom" and r_bottom is not None):
                reader.fail("contradiction", mode, f"{mode} is the result of this mode; remove it or change solveFor.")
    reader.check()
    assert vin is not None and mode is not None
    parallel = lambda a, b: a * b / (a + b)  # noqa: E731
    if mode == "rTop":
        assert r_bottom is not None and target is not None
        bottom = r_bottom if r_load is None else parallel(r_bottom, r_load)
        r_top = bottom * (vin - target) / target
        result.formulas.append("R_top = R_b * (V_in - V_out) / V_out")
    elif mode == "rBottom":
        assert r_top is not None and target is not None
        needed = r_top * target / (vin - target)
        if r_load is not None and needed >= r_load:
            reader.fail("domain", "vout", "The load alone already pulls the output below this target; no bottom resistor reaches it.")
            reader.check()
        r_bottom = needed if r_load is None else 1 / (1 / needed - 1 / r_load)  # type: ignore[operator]
        result.formulas.append("R_b = R_top * V_out / (V_in - V_out);  R_bottom = 1 / (1/R_b - 1/R_load)")
    assert r_top is not None and r_bottom is not None
    bottom = r_bottom if r_load is None else parallel(r_bottom, r_load)
    vout = vin * bottom / (r_top + bottom)
    unloaded = vin * r_bottom / (r_top + r_bottom)
    current_top = vin / (r_top + bottom)
    if mode == "rTop":
        result.add("rTop", r_top, "resistance")
    if mode == "rBottom":
        result.add("rBottom", r_bottom, "resistance")
    result.add("vout", vout, "voltage")
    result.add("voutUnloaded", unloaded, "voltage")
    if unloaded > 0:
        result.add("loadingError", (vout - unloaded) / unloaded, "ratio")
    else:
        result.warn("The loading error is undefined at an unloaded output of 0 V.")
    result.add("theveninResistance", parallel(r_top, r_bottom), "resistance")
    result.add("currentTop", current_top, "current")
    result.add("powerTop", current_top * current_top * r_top, "power")
    result.add("powerBottom", vout * vout / r_bottom, "power")
    if r_load is not None:
        result.add("currentLoad", vout / r_load, "current")
        result.add("powerLoad", vout * vout / r_load, "power")
    result.formulas += [
        "R_b = R_bottom || R_load",
        "V_out = V_in * R_b / (R_top + R_b)",
        "R_thevenin = R_top || R_bottom",
        "loadingError = (V_out - V_out,unloaded) / V_out,unloaded",
    ]
    result.assumptions.append("Ideal voltage source; the load is a resistance across the bottom resistor.")
    result.limits.append(OHMIC)


def rc_time_constant(reader: Reader, result: Result) -> None:
    resistance = reader.value("resistance", "resistance", sign="positive")
    capacitance = reader.value("capacitance", "capacitance", sign="positive")
    v_initial = reader.value("vInitial", "voltage", required=False, sign="any")
    v_final = reader.value("vFinal", "voltage", required=False, sign="any")
    time = reader.value("time", "time", required=False)
    v_target = reader.value("vTarget", "voltage", required=False, sign="any")
    reader.close()
    step = any(name in reader.data for name in ("vInitial", "vFinal", "time", "vTarget"))
    if step and not reader.problems:
        for name, value in (("vInitial", v_initial), ("vFinal", v_final)):
            if value is None:
                reader.fail("insufficient", name, "A step response needs vInitial and vFinal.")
        if time is None and v_target is None:
            reader.fail("insufficient", "time", "A step response needs a time or a target voltage vTarget.")
        if time is not None and v_target is not None:
            reader.fail("contradiction", "vTarget", "Give a time or a target voltage, not both.")
        if v_target is not None and v_initial is not None and v_final is not None:
            low, high = sorted((v_initial, v_final))
            if not low < v_target < high:
                reader.fail("domain", "vTarget", "The target must lie strictly between vInitial and vFinal.")
    reader.check()
    assert resistance is not None and capacitance is not None
    tau = resistance * capacitance
    result.add("tau", tau, "time")
    result.add("cutoffFrequency", 1 / (2 * math.pi * tau), "frequency")
    result.add("riseTime1090", math.log(9) * tau, "time")
    result.add("settlingTime1pct", math.log(100) * tau, "time")
    result.formulas += ["tau = R * C", "f_c = 1 / (2 * pi * tau)", "t_r(10-90 %) = ln(9) * tau", "t_s(1 %) = ln(100) * tau"]
    if step:
        assert v_initial is not None and v_final is not None
        result.formulas.append("v(t) = V_final + (V_initial - V_final) * exp(-t / tau)")
        if time is not None:
            result.add("voltageAtTime", v_final + (v_initial - v_final) * math.exp(-time / tau), "voltage")
        else:
            assert v_target is not None
            result.add("timeToTarget", tau * math.log((v_final - v_initial) / (v_final - v_target)), "time")
            result.formulas.append("t = tau * ln((V_final - V_initial) / (V_final - V_target))")
        result.assumptions.append("Ideal voltage step from V_initial to V_final through R into C; the capacitor starts at V_initial.")
    result.limits.append("First-order lumped RC: ideal source, no load on the capacitor, no ESR, leakage or dielectric absorption.")


def rc_filter(reader: Reader, result: Result) -> None:
    kind = reader.choice("type", ("lowpass", "highpass"))
    resistance = reader.value("resistance", "resistance", sign="positive")
    capacitance = reader.value("capacitance", "capacitance", sign="positive")
    frequency = reader.value("frequency", "frequency", sign="positive")
    amplitude = reader.value("amplitude", "voltage", required=False)
    amplitude_kind = reader.choice("amplitudeKind", ("peak", "rms", "peak-to-peak"), required=False)
    reader.close()
    if not reader.problems:
        if amplitude is not None and amplitude_kind is None:
            reader.fail("insufficient", "amplitudeKind", "State whether the amplitude is a peak, rms or peak-to-peak value.")
        if amplitude is None and "amplitudeKind" in reader.data:
            reader.fail("insufficient", "amplitude", "amplitudeKind needs an amplitude.")
    reader.check()
    assert resistance is not None and capacitance is not None and frequency is not None
    cutoff = 1 / (2 * math.pi * resistance * capacitance)
    ratio = frequency / cutoff
    if kind == "lowpass":
        gain = 1 / math.sqrt(1 + ratio * ratio)
        phase = -math.degrees(math.atan(ratio))
        result.formulas += ["|H| = 1 / sqrt(1 + (f / f_c)^2)", "phase = -atan(f / f_c)"]
    else:
        gain = ratio / math.sqrt(1 + ratio * ratio)
        phase = math.degrees(math.atan(1 / ratio))
        result.formulas += ["|H| = (f / f_c) / sqrt(1 + (f / f_c)^2)", "phase = atan(f_c / f)"]
    result.formulas.insert(0, "f_c = 1 / (2 * pi * R * C)")
    result.add("cutoffFrequency", cutoff, "frequency")
    result.add("gain", gain, "ratio")
    if not gain > 0:  # So far beyond the cutoff that the gain underflows: no finite level in decibels.
        raise refuse("domain", "", NOT_FINITE)
    result.add("gainDb", 20 * math.log10(gain), "decibel")
    result.add("phase", phase, "angle")
    if amplitude is not None:
        sine = factors("sine")
        peak_in = {"peak": amplitude, "rms": amplitude / sine.rms, "peak-to-peak": amplitude / sine.peak_to_peak}[amplitude_kind]  # type: ignore[index]
        peak = gain * peak_in
        result.add("outputPeak", peak, "voltage")
        result.add("outputRms", peak * sine.rms, "voltage")
        result.add("outputPeakToPeak", peak * sine.peak_to_peak, "voltage")
        result.add("outputAverage", peak * sine.average, "voltage")
        result.add("outputRectifiedAverage", peak * sine.rectified, "voltage")
        result.formulas.append("sine: V_rms = V_peak / sqrt(2), V_pp = 2 * V_peak, rectified average = 2 * V_peak / pi, average = 0")
        result.assumptions.append(f"Sinusoidal steady state; the input amplitude is a {amplitude_kind} value.")
    else:
        result.assumptions.append("Sinusoidal steady state.")
    result.limits.append("First-order RC with an ideal source and an unloaded output; component tolerances and parasitics are not included.")


def rc_waveform(reader: Reader, result: Result) -> None:
    shape = reader.choice("shape", SHAPES)
    amplitudes = {
        name: reader.quantity(name, ("voltage", "current"), required=False) for name in ("peak", "rms", "average")
    }
    given = [name for name in amplitudes if name in reader.data]
    duty = None
    if shape == "pulse":
        if reader.has("duty"):
            duty = reader.ratio("duty", low_open=True)
        else:
            reader.fail("insufficient", "duty", "A pulse needs its duty cycle (0 < duty <= 1).")
    elif reader.has("duty"):
        reader.fail("contradiction", "duty", "Only the pulse shape has a duty cycle.")
    reader.close()
    if not reader.problems:
        if not given:
            reader.fail("schema", "", "Give exactly one of peak, rms and average.")
        elif len(given) > 1:
            reader.fail("contradiction", given[1], "Give exactly one of peak, rms and average.")
        elif given[0] == "average" and shape in SYMMETRIC:
            reader.fail("contradiction", "average", f"The average of a symmetric {shape} is zero for every amplitude; give peak or rms.")
    reader.check()
    assert shape is not None
    known = amplitudes[given[0]]
    assert known is not None
    unit = factors(shape, duty)
    per_peak = {"peak": 1.0, "rms": unit.rms, "average": unit.average}[given[0]]
    peak = known.si / per_peak
    kind = known.dimension
    result.add("peak", peak, kind)
    result.add("rms", peak * unit.rms, kind)
    result.add("average", peak * unit.average, kind)
    result.add("rectifiedAverage", peak * unit.rectified, kind)
    result.add("peakToPeak", peak * unit.peak_to_peak, kind)
    if peak > 0:
        result.add("crestFactor", 1 / unit.rms, "ratio")
        result.add("formFactor", unit.rms / unit.rectified, "ratio")
    else:
        result.warn("Crest and form factor are undefined at zero amplitude.")
    symbol = RESULT_UNITS[kind]
    result.formulas.append(
        {
            "sine": "sine: rms = peak / sqrt(2), average = 0, rectified average = 2 * peak / pi, peak-to-peak = 2 * peak",
            "triangle": "triangle: rms = peak / sqrt(3), average = 0, rectified average = peak / 2, peak-to-peak = 2 * peak",
            "square": "square: rms = peak, average = 0, rectified average = peak, peak-to-peak = 2 * peak",
            "pulse": "pulse 0..peak: rms = peak * sqrt(duty), average = peak * duty, peak-to-peak = peak "
            "(0 at duty 1, a constant level)",
            "dc": "dc: peak = rms = average, peak-to-peak = 0",
        }[shape]
    )
    result.formulas.append("crest factor = peak / rms;  form factor = rms / rectified average")
    result.assumptions.append(
        f"Ideal {shape} waveform in {symbol}"
        + (", symmetric about zero." if shape in SYMMETRIC else ", rectangular pulses from zero to the peak." if shape == "pulse" else ".")
    )
    result.limits.append("Ideal shape: no rise and fall times, ringing or offset.")


MODELS = {
    "dc": {"ohm": dc_ohm, "series": dc_series, "parallel": dc_parallel, "shunt": dc_shunt},
    "divider": {"resistive": divider_resistive},
    "rc": {"time-constant": rc_time_constant, "filter": rc_filter, "waveform": rc_waveform},
}
