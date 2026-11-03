/* Tiny freestanding debug fixture; built without libc, startup or hardware. */
#ifndef WORKSPACE
#define WORKSPACE 16
#endif
volatile unsigned initialized = 3;
volatile unsigned char workspace[WORKSPACE];

__attribute__((noinline, used)) unsigned grow(unsigned value) {
    value += initialized;
#if WORKSPACE > 16
    value ^= value << 3;
    value += value >> 2;
    value ^= 0x1234;
#endif
    return value;
}

__attribute__((noinline, used)) unsigned crash_site(unsigned value) {
    workspace[0] = (unsigned char)value;
    return grow(value);
}
