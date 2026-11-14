/* A RISC-V image: gdb-debug refuses it for an ARM profile (LAB-04). */
volatile unsigned counter;
void _start(void) {
    for (;;) counter++;
}
