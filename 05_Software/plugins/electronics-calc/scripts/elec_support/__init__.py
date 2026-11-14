"""Support package of the VERA electronics plugins: quantity, result and report contracts (format 1) and the
numeric models of `elec-calc`.

This folder is the single source of the shared contracts. A plugin never imports it from another plugin's
installed folder; a later plugin that needs it ships its own verified copy.
"""

VERSION = "1.0.0"
FORMAT = 1
TOOL = "elec-calc"
