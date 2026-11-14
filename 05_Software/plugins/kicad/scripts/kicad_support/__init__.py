"""Support package of kicad-tool, the KiCad helper of the kicad plugin (spec REQ-DATA-c32834e3).

Standard library only. kicad-cli runs only on a copy of the project in a temporary folder; the run folder in the
working directory is written last, by this package, after the source files were hashed again.
"""

FORMAT = 1
TOOL = "kicad-tool"
VERSION = "1.0.0"
