"use strict";
/* ============================================================
   Maskable PWA icon generator — zero dependencies.

   Chrome only surfaces the install prompt when the manifest
   declares a 192px and a 512px PNG, and a maskable icon has to
   survive being cropped to the central 80% circle by Android.
   So this renders the same fan mark as icon.svg with a
   full-bleed background and the glyph kept inside the safe zone.

   Everything is written by hand: a PNG is just a signature,
   a CRC32'd IHDR, a zlib-deflated IDAT of filtered scanlines,
   and an IEND. No canvas, no native modules, no npm.

   Run: node tools/make-icons.js
   ============================================================ */
const fs = require("fs");
const path = require("path");
const zlib = require("node:zlib");

/* ---------- PNG container ---------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++){
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf){
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data){
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/* 8-bit RGBA, no interlacing — the only PNG flavour this needs */
function encodePng(width, height, rgba){
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    /* bit depth   */
  ihdr[9] = 6;    /* colour type: truecolour + alpha */
  ihdr[10] = 0;   /* compression */
  ihdr[11] = 0;   /* filter      */
  ihdr[12] = 0;   /* interlace   */

  /* every scanline is prefixed with its filter type; 0 = None */
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++){
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- the fan mark, drawn analytically ---------- */

/* same palette as icon.svg, and the same geometry in 0..1 units */
const INK = [0x0b, 0x12, 0x20];
const ACCENT_HI = [0x38, 0xbd, 0xf8];
const ACCENT_LO = [0x25, 0x63, 0xeb];

const DISC_R = 0.375;              /* inside the 0.4 maskable safe radius */
const BLADE_RX = 0.0844;
const BLADE_RY = 0.1375;
const BLADE_OFF = -0.19375;        /* blade centre, above the hub */
const HUB_R = 0.0906;
const DOT_R = 0.0406;
const ROT = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];

/* Shades one point, in 0..1 canvas units. */
function shade(u, v){
  const px = u - 0.5, py = v - 0.5;
  const d = Math.hypot(px, py);

  if (d > DISC_R) return INK;                                    /* full-bleed plate */

  /* the disc carries the same diagonal gradient as icon.svg */
  const t = Math.min(1, Math.max(0, (px + py) / (2 * DISC_R) + 0.5));
  let col = [
    Math.round(ACCENT_HI[0] + (ACCENT_LO[0] - ACCENT_HI[0]) * t),
    Math.round(ACCENT_HI[1] + (ACCENT_LO[1] - ACCENT_HI[1]) * t),
    Math.round(ACCENT_HI[2] + (ACCENT_LO[2] - ACCENT_HI[2]) * t),
  ];

  /* four blades, punched back out in the plate colour */
  for (const a of ROT){
    const qx =  px * Math.cos(a) + py * Math.sin(a);
    const qy = -px * Math.sin(a) + py * Math.cos(a);
    const ex = qx / BLADE_RX;
    const ey = (qy - BLADE_OFF) / BLADE_RY;
    if (ex * ex + ey * ey <= 1) return INK;
  }

  if (d <= DOT_R) return ACCENT_HI;
  if (d <= HUB_R) return INK;
  return col;
}

/* Supersampled so the disc edge and the blade edges stay smooth at 192px. */
function render(size, ss = 3){
  const rgba = Buffer.alloc(size * size * 4);
  const step = 1 / (size * ss);
  const n = size * ss;
  for (let y = 0; y < size; y++){
    for (let x = 0; x < size; x++){
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++){
        for (let sx = 0; sx < ss; sx++){
          const c = shade((x * ss + sx + 0.5) * step, (y * ss + sy + 0.5) * step);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const total = ss * ss;
      const o = (y * size + x) * 4;
      rgba[o]     = Math.round(r / total);
      rgba[o + 1] = Math.round(g / total);
      rgba[o + 2] = Math.round(b / total);
      rgba[o + 3] = 255;                       /* maskable: never transparent */
    }
  }
  return encodePng(size, size, rgba);
}

/* ---------- emit ---------- */

const OUT = path.join(__dirname, "..");
for (const size of [192, 512]){
  const file = path.join(OUT, `icon-${size}.png`);
  const png = render(size);
  fs.writeFileSync(file, png);
  console.log(`wrote icon-${size}.png — ${size}×${size}, ${(png.length / 1024).toFixed(1)} KB`);
}