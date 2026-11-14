# /// script
# requires-python = ">=3.11"
# dependencies = ["paho-mqtt==2.1.0"]
# ///
"""Bounded MQTT telemetry and controlled commands on a configured broker for VERA (program `mqtt-tool` of the
mqtt-tools plugin).

Operations: capabilities, check-profile, connect-test, subscribe, publish, request. The broker, TLS, credential
reference, client identity, protocol, topic ACL, QoS, limits and reconnect policy come from a profile file in the
workbench; the password arrives only on stdin from VERA. Exit codes: 0 pass, 1 fail, 2 blocked before any packet,
3 incomplete or error.
"""

import os
import sys

# VERA hashes every file of the installed plugin folder: Python must not write a bytecode cache next to the
# support package. Set before the first import of it.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mqtt_support.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
