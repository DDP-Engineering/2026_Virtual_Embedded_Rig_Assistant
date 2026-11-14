/* Line assembly and number text of the platformio fixture (LAB-08). */
#include "lines.h"

void lines_init(lines_t *lines) {
    lines->length = 0;
    lines->text[0] = 0;
}

int lines_feed(lines_t *lines, char c) {
    if (c == '\r' || c == '\n') {
        if (!lines->length) return 0;
        lines->text[lines->length] = 0;
        lines->length = 0;
        return 1;
    }
    if (lines->length < LINES_CAPACITY) lines->text[lines->length++] = c;
    return 0;
}

size_t lines_number(uint32_t value, char *out) {
    char digits[10];
    size_t count = 0;
    do {
        digits[count++] = (char)('0' + value % 10u);
        value /= 10u;
    } while (value && count < sizeof digits);
    for (size_t i = 0; i < count; i++) out[i] = digits[count - 1 - i];
    out[count] = 0;
    return count;
}
