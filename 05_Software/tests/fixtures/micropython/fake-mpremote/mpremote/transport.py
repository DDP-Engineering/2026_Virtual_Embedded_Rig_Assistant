"""The errors of mpremote.transport 1.29.0 that micropython-tool catches (test stand-in)."""


class TransportError(Exception):
    pass


class TransportExecError(TransportError):
    def __init__(self, status_code, error_output):
        self.status_code = status_code
        self.error_output = error_output
        super().__init__(error_output)
