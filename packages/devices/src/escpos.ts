/**
 * Minimal ESC/POS command builder (Epson-compatible command set).
 * Production code will use @point-of-sale/receipt-printer-encoder (MIT);
 * this builder documents the raw bytes involved and is unit tested.
 */
export class EscPos {
  private bytes: number[] = [];

  initialize(): this { this.bytes.push(0x1b, 0x40); return this; }                 // ESC @
  align(a: 'left' | 'center' | 'right'): this {                                      // ESC a n
    this.bytes.push(0x1b, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2); return this;
  }
  bold(on: boolean): this { this.bytes.push(0x1b, 0x45, on ? 1 : 0); return this; } // ESC E n
  size(width: 1 | 2, height: 1 | 2): this {                                          // GS ! n
    this.bytes.push(0x1d, 0x21, ((width - 1) << 4) | (height - 1)); return this;
  }
  text(s: string): this {
    for (const ch of s) {
      const code = ch.charCodeAt(0);
      this.bytes.push(code < 0x80 ? code : 0x3f); // non-ASCII -> '?' (code pages handled by encoder lib)
    }
    return this;
  }
  line(s = ''): this { return this.text(s).newline(); }
  newline(): this { this.bytes.push(0x0a); return this; }
  /** Two-column line: left text, right text, padded to the paper width in characters. */
  columns(left: string, right: string, width: number): this {
    const space = Math.max(1, width - left.length - right.length);
    return this.line(left + ' '.repeat(space) + right);
  }
  feedAndPartialCut(): this { this.bytes.push(0x1d, 0x56, 0x42, 0x00); return this; } // GS V 66 0
  /** Pulse the cash drawer connected to the printer: ESC p m t1 t2 */
  openDrawer(pin: 0 | 1 = 0): this { this.bytes.push(0x1b, 0x70, pin, 0x19, 0xfa); return this; }
  build(): Uint8Array { return Uint8Array.from(this.bytes); }
}
