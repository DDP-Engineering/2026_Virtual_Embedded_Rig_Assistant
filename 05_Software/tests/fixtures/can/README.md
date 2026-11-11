# CAN fixtures

Fictional data for `tests/integration/can.test.ts`:

- `board.dbc`: `BoardStatus` (0x100, 4 bytes: Temperature int16 x 0.1 degC,
  Voltage uint16 mV) and `MotorCommand` (0x200, 3 bytes: Speed uint16 rpm,
  Enable bit with choices Off/On).
- `frames.log`: candump log replayed by the opt-in test: MotorCommand
  1000 rpm On, an unknown 0x7FF frame, MotorCommand 0 rpm Off.

The opt-in test also sends `100#FA00F00A` twice (25 degC, 2800 mV), so each of
its two captures (.asc and .blf) decodes to two BoardStatus, two MotorCommand
and one unknown frame.

`fake-python-can/can/` is a stdlib stand-in for python-can that the default
tests put on PYTHONPATH: it records each `Bus` call's arguments and every sent
frame to `FAKE_CAN_RECORD`, returns the frames of `FAKE_CAN_FRAMES` from
`recv`, and fails to open when `FAKE_CAN_OPEN_ERROR` is set.
