// VERA fixture: one library of the core (SPI) and one local library (VeraCounter, passed with --library-dir).
#include <SPI.h>
#include <VeraCounter.h>

void setup() {
  Serial.begin(115200);
  SPI.begin();
}

void loop() {
  Serial.println(veraCount());
  delay(1000);
}
