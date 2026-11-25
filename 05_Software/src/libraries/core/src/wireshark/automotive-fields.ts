export const doipFields = [
  "doip.version",
  "doip.inverse",
  "doip.type",
  "doip.length",
  "doip.source_address",
  "doip.target_address",
  "doip.logical_address",
  "doip.tester_logical_address",
  "doip.activation_type_v1",
  "doip.activation_type",
  "doip.response_code",
  "doip.nack_code",
  "doip.diag_ack_code",
  "doip.diag_nack_code",
];
export const someipFields = [
  "someip.serviceid",
  "someip.methodid",
  "someip.messageid",
  "someip.length",
  "someip.clientid",
  "someip.sessionid",
  "someip.protoversion",
  "someip.interfaceversion",
  "someip.messagetype",
  "someip.returncode",
  "someip.tp.offset",
  "someip.tp.flags.more_segments",
];
export const entryFields = [
  "someipsd.entry.type",
  "someipsd.entry.serviceid",
  "someipsd.entry.instanceid",
  "someipsd.entry.majorver",
  "someipsd.entry.minorver",
  "someipsd.entry.eventgroupid",
  "someipsd.entry.counter",
  "someipsd.entry.ttl",
];
export const automotiveFields = [...doipFields, ...someipFields, "someipsd.flags", ...entryFields];
export const sdMessageId = 0xffff8100;
