import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import PDFDocument from "pdfkit";

/**
 * A fictional workbench whose PDFs have the layouts that real datasheets have and the demo PDFs do
 * not: a register table, two columns, a rotated pinout table, footnotes, a table split across pages
 * and a page without text (a scan). Generated with fixed metadata, so every run gets the same bytes.
 */
const FIXED = new Date("2026-01-01T00:00:00Z");

function pdf(path, title, draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      info: { Title: title, Author: "VERA hard-layout fixtures", CreationDate: FIXED, ModDate: FIXED },
    });
    const stream = createWriteStream(path);
    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.on("error", reject);
    doc.pipe(stream);
    draw(doc);
    doc.end();
  });
}

function table(doc, x, y, widths, rows, { header = false } = {}) {
  let top = y;
  rows.forEach((row, index) => {
    let left = x;
    doc.font(header && index === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(10);
    row.forEach((cell, column) => {
      doc.text(cell, left + 3, top + 4, { width: widths[column] - 6, lineBreak: false });
      left += widths[column];
    });
    doc
      .moveTo(x, top + 18)
      .lineTo(left, top + 18)
      .stroke();
    top += 20;
  });
  return top;
}

export const REGISTER_ROWS = [
  ["Register", "Offset", "Reset", "Fields"],
  ["TIM2_CR1", "0x00", "0x0000", "CEN UDIS URS OPM DIR"],
  ["TIM2_CR2", "0x04", "0x0000", "CCDS MMS TI1S"],
  ["TIM2_SMCR", "0x08", "0x0000", "SMS TS MSM ETF"],
  ["TIM2_DIER", "0x0C", "0x0000", "UIE CC1IE CC2IE TIE"],
  ["TIM2_SR", "0x10", "0x0000", "UIF CC1IF CC2IF TIF"],
  ["TIM2_PSC", "0x28", "0x0000", "PSC[15:0]"],
];
export const SPLIT_ROWS = [
  ["Pin", "Function", "Drive"],
  ["PC0", "LED_RED", "8 mA"],
  ["PC1", "LED_GREEN", "8 mA"],
  ["PC2", "BUZZER", "20 mA"],
  ["PC3", "RELAY_EN", "20 mA"],
  ["PC4", "FAN_PWM", "8 mA"],
  ["PC5", "HEATER_EN", "20 mA"],
  ["PC6", "USB_VBUS_SENSE", "2 mA"],
  ["PC7", "CAN_STBY", "2 mA"],
];

export async function writeHardCorpus(folder) {
  await mkdir(join(folder, ".vera"), { recursive: true });
  await mkdir(join(folder, "docs"), { recursive: true });
  await writeFile(
    join(folder, ".vera", "workbench.yaml"),
    'format: 1\nid: wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0H\nname: VERA-HARD-02\ndescription: Fictional hard-layout datasheets\ndocs:\n  include: ["docs/**"]\n  exclude: []\nskills:\n  disabled: []\ntools:\n  disabled: []\nagent:\n  permission_mode: ask\n  model: null\n',
  );
  const docs = join(folder, "docs");
  await pdf(join(docs, "register-map.pdf"), "VERA-HARD-02 Timer register map", (doc) => {
    doc.font("Helvetica-Bold").fontSize(16).text("TIM2 register map");
    doc.font("Helvetica").fontSize(10).text("All registers are 32 bits wide; reserved bits read as zero.");
    table(doc, 48, 140, [110, 70, 80, 240], REGISTER_ROWS, { header: true });
  });
  await pdf(join(docs, "two-column.pdf"), "VERA-HARD-02 Analog front end", (doc) => {
    doc.font("Helvetica-Bold").fontSize(16).text("Analog front end");
    doc.moveDown();
    doc
      .font("Helvetica")
      .fontSize(10)
      .text(
        "The ADC converts twelve input channels with a resolution of 12 bits. Each channel samples for 12.5 cycles at the 14 MHz ADC clock, so one conversion takes 1 us including the successive approximation. " +
          "Calibration runs once after reset and stores its offset in ADC_CALFACT. The reference buffer needs 10 us to settle after it is enabled. " +
          "The DAC has two channels with a settling time of 3 us to within one LSB. The DAC output buffer drives loads down to 5 kohm and 50 pF. " +
          "When the buffer is off, the output impedance is 15 kohm and the output must be followed by an external amplifier.",
        { columns: 2, columnGap: 24, height: 200, align: "justify" },
      );
  });
  await pdf(join(docs, "rotated-pinout.pdf"), "VERA-HARD-02 Pinout", (doc) => {
    doc.font("Helvetica-Bold").fontSize(16).text("Package pinout (landscape)");
    doc.save();
    doc.rotate(90, { origin: [300, 400] });
    table(
      doc,
      120,
      300,
      [80, 140, 160],
      [
        ["Pin", "Name", "Alternate"],
        ["1", "PA0", "ADC_IN0 / TIM2_CH1"],
        ["2", "PA1", "ADC_IN1 / TIM2_CH2"],
        ["3", "PA2", "USART2_TX"],
        ["4", "PA3", "USART2_RX"],
        ["5", "PA4", "DAC_OUT1 / SPI1_NSS"],
      ],
      { header: true },
    );
    doc.restore();
  });
  await pdf(join(docs, "footnotes.pdf"), "VERA-HARD-02 Absolute ratings", (doc) => {
    doc.font("Helvetica-Bold").fontSize(16).text("Absolute maximum ratings");
    doc.moveDown();
    doc.font("Helvetica").fontSize(10).text("Supply voltage: -0.3 V to 4.0 V.");
    doc.text("Current into any I/O pin: 25 mA (1).");
    doc.text("Storage temperature: -40 to 125 degrees C (2).");
    doc.text("Footnotes", 48, 720, { underline: true });
    doc
      .fontSize(8)
      .text("(1) Per pin. The total current into all I/O pins together must stay below 120 mA.", 48, 735);
    doc.text("(2) Exposure above 105 degrees C for more than 1000 hours reduces data retention.", 48, 747);
  });
  await pdf(join(docs, "split-table.pdf"), "VERA-HARD-02 Port C", (doc) => {
    doc.font("Helvetica-Bold").fontSize(16).text("Port C assignment");
    doc.font("Helvetica").fontSize(10).text("The table continues on the next page.");
    table(doc, 48, 640, [80, 200, 100], SPLIT_ROWS.slice(0, 5), { header: true });
    doc.addPage();
    table(doc, 48, 60, [80, 200, 100], [SPLIT_ROWS[0], ...SPLIT_ROWS.slice(5)], { header: true });
  });
  await pdf(join(docs, "scanned.pdf"), "VERA-HARD-02 Scanned errata", (doc) => {
    // Only drawn shapes: a scan without a text layer.
    for (let line = 0; line < 30; line++)
      doc
        .rect(60, 80 + line * 20, 180 + ((line * 37) % 300), 6)
        .fillColor("#444444")
        .fill();
  });
}
