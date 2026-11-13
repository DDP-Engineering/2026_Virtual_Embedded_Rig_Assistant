// VERA fixture: prints its version banner on the serial port at boot and once a second, and blinks LED_BUILTIN.
// The banner is what the serial readback of an upload test looks for.
#define VERA_FIXTURE_VERSION "1.0.0"

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(115200);
  Serial.println("VERA-FIXTURE arduino-cli blink " VERA_FIXTURE_VERSION);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
  Serial.println("VERA-FIXTURE arduino-cli blink " VERA_FIXTURE_VERSION);
}
