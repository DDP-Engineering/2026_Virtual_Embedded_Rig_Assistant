"""Run by KiCad's own Python (its SWIG `pcbnew` module): export a board to a Specctra DSN file.

Usage: python export_dsn.py BOARD.kicad_pcb OUT.dsn. Exit 0 when KiCad wrote the file."""

import sys

import pcbnew  # noqa: E402 - KiCad's module, present only in KiCad's Python

board = pcbnew.LoadBoard(sys.argv[1])
sys.exit(0 if pcbnew.ExportSpecctraDSN(board, sys.argv[2]) else 1)
