"""Independent reference for the Monte Carlo statistics of `elec-calc tolerance` (test fixture).

It follows the algorithm the specification documents (REQ-DATA-3d15fdfc §5.6), not the plugin's code, and it
does not import the plugin: the divider is computed here from its closed form. The test compares its output with
the program's, which pins the generator, the draw order, the uniform and Box-Muller formulas, the n - 1 standard
deviation and the interpolated percentiles.

Usage: montecarlo_reference.py <uniform|normal> <seed> <samples> [sigmas]
Circuit: 5 V into two 10 kOhm resistors with a 1 % tolerance each; output vout; limits 2.49 V .. 2.51 V.
"""

import json
import math
import random
import sys

distribution, seed, samples = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
sigmas = float(sys.argv[4]) if len(sys.argv) > 4 else None
VIN, NOMINAL, TOLERANCE = 5.0, 10_000.0, 0.01
LOW, HIGH = NOMINAL * (1 - TOLERANCE), NOMINAL * (1 + TOLERANCE)
generator = random.Random(seed)


def draw() -> float:
    if distribution == "uniform":
        return LOW + (HIGH - LOW) * generator.random()
    assert sigmas is not None
    first, second = generator.random(), generator.random()
    deviate = math.sqrt(-2.0 * math.log(1.0 - first)) * math.cos(2.0 * math.pi * second)
    return (LOW + HIGH) / 2 + deviate * (HIGH - LOW) / (2 * sigmas)


values = []
for _ in range(samples):
    # Parameters are drawn in sorted key order: rBottom before rTop.
    bottom = draw()
    top = draw()
    values.append(VIN * bottom / (top + bottom))
ordered = sorted(values)
mean = math.fsum(ordered) / samples


def percentile(fraction: float) -> float:
    position = (samples - 1) * fraction
    lower = math.floor(position)
    upper = min(lower + 1, samples - 1)
    return ordered[lower] + (position - lower) * (ordered[upper] - ordered[lower])


print(
    json.dumps(
        {
            "vout.mean": mean,
            "vout.stdDev": math.sqrt(math.fsum((value - mean) ** 2 for value in ordered) / (samples - 1)),
            "vout.sampleMin": ordered[0],
            "vout.sampleMax": ordered[-1],
            "vout.p01": percentile(0.01),
            "vout.p05": percentile(0.05),
            "vout.p50": percentile(0.5),
            "vout.p95": percentile(0.95),
            "vout.p99": percentile(0.99),
            "vout.fractionWithin": sum(1 for value in ordered if 2.49 <= value <= 2.51) / samples,
        }
    )
)
