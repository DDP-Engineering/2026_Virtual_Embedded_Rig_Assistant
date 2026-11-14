"""Writes the power-profiler CSV fixtures (README.md gives each one's closed-form integrals). Deterministic:
integer sample arithmetic only, so every edge lies exactly on a sample. Run: python make_fixtures.py <folder>."""

import sys
from pathlib import Path


def write(path: Path, header: str, rows: list[list[str]]) -> None:
    path.write_text(header + "\n" + "\n".join(",".join(row) for row in rows) + "\n", encoding="utf-8", newline="\n")


def g(value: float) -> str:
    return format(value, ".12g")


def constant(gap: range | None = None) -> list[list[str]]:
    rows = []
    for k in range(1001):  # t = 0 ... 1 s, 1 ms steps; 10 mA at 3.3 V
        empty = gap is not None and k in gap
        rows.append([g(k / 1000), "" if empty else "10", "" if empty else "3.3", "" if empty else "33"])
    return rows


def ramp() -> list[list[str]]:
    rows = []
    for k in range(101):  # t = (k / 100)^2: non-uniform; i = 0.02 t A, v = 2 V, p = 0.04 t W
        t = (k / 100) ** 2
        rows.append([g(t), g(0.02 * t), "2", g(0.04 * t)])
    return rows


def sleepwake(active: int, voltage: float) -> list[list[str]]:
    rows = []
    for k in range(2000):  # 2 kHz, 1 s; period 200 samples (0.1 s); 20 mA while the marker is high, else 10 uA
        on = k % 200 < active
        current = 0.02 if on else 1e-5
        rows.append([g(k / 2000), g(current), g(voltage), g(current * voltage), "1" if on else "0"])
    return rows


def main() -> None:
    folder = Path(sys.argv[1])
    folder.mkdir(parents=True, exist_ok=True)
    write(folder / "uniform-constant.csv", "t,i_mA,v,p_mW", constant())
    write(folder / "gap.csv", "t,i_mA,v,p_mW", constant(range(400, 450)))
    write(folder / "nonuniform-ramp.csv", "t,i,v,p", ramp())
    write(folder / "sleepwake-a.csv", "t,i,v,p,gpio", sleepwake(40, 3.0))
    write(folder / "sleepwake-b.csv", "t,i,v,p,gpio", sleepwake(30, 3.0))
    write(folder / "sleepwake-b-3v3.csv", "t,i,v,p,gpio", sleepwake(30, 3.3))


if __name__ == "__main__":
    main()
