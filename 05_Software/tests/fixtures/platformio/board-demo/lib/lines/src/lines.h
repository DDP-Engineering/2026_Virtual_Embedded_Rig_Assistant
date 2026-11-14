/* Line assembly and number text of the platformio fixture (LAB-08); pure logic, tested on the host and the device. */
#ifndef LINES_H
#define LINES_H

#include <stddef.h>
#include <stdint.h>

#define LINES_CAPACITY 32

typedef struct {
    char text[LINES_CAPACITY + 1];
    size_t length;
} lines_t;

void lines_init(lines_t *lines);
/* Feeds one character; returns 1 when a non-empty line is complete (CR or LF), its text in lines->text. */
int lines_feed(lines_t *lines, char c);
/* Writes the decimal text of value into out (at least 11 bytes); returns its length. */
size_t lines_number(uint32_t value, char *out);

#endif
