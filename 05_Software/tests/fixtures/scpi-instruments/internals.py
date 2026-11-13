"""Parser checks of scpi_support.waveform, run by scpi-instruments.test.ts: argv[1] is the plugin's scripts folder."""

import json
import struct
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])

from scpi_support.waveform import BlockError, SampleFormat, parse_header, parse_preamble, samples, series  # noqa: E402

out = {}
out["header"] = parse_header(b"#9000001200")
out["short"] = parse_header(b"#15")
for name, header in {"truncated": b"#90000", "indefinite": b"#0abc", "noHash": b"9000"}.items():
    try:
        parse_header(header)
        out[name] = "accepted"
    except BlockError as error:
        out[name] = str(error)
little = SampleFormat.of({"width": 2, "signed": True, "endian": "little"})
big = SampleFormat.of({"width": 2, "signed": True, "endian": "big"})
out["little"] = samples(struct.pack("<3h", -2, 0, 300), little)
out["big"] = samples(struct.pack(">3h", -2, 0, 300), big)
try:
    samples(b"\x00\x01\x02", little)
    out["odd"] = "accepted"
except BlockError as error:
    out["odd"] = str(error)
fields = ["format", "type", "points", "count", "xincrement", "xorigin", "xreference", "yincrement", "yorigin", "yreference"]
pre = parse_preamble("0,0,3,1,1e-6,-1e-6,0,0.04,0,127", fields)
out["series"] = series([127, 177, 77], pre)
print(json.dumps(out))
