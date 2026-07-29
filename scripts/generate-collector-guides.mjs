import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const output = resolve('collector-web/public/guides');
await mkdir(output, { recursive: true });

const good = `<svg width="1200" height="525" viewBox="0 0 1200 525" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="525" fill="#dfe7e2"/>
  <rect x="58" y="45" width="1084" height="435" rx="22" fill="#f7f8f6" stroke="#92aa9d" stroke-width="4"/>
  <ellipse cx="600" cy="276" rx="265" ry="170" fill="#ffffff" stroke="#c9cfcc" stroke-width="8"/>
  <ellipse cx="600" cy="276" rx="215" ry="128" fill="#f2c354"/>
  <path d="M425 265C480 192 548 212 584 248C620 195 720 208 774 278C709 357 499 365 425 265Z" fill="#c84943"/>
  <path d="M499 234C530 205 556 228 574 258C532 282 502 273 499 234ZM650 232C689 202 721 234 715 276C670 278 646 263 650 232Z" fill="#f7d46f"/>
  <path d="M502 331C538 296 570 322 578 349M643 342C670 304 710 321 721 346" fill="none" stroke="#3d8a57" stroke-width="18" stroke-linecap="round"/>
  <path d="M83 75h80M83 75v80M1117 75h-80M1117 75v80M83 450h80M83 450v-80M1117 450h-80M1117 450v-80" stroke="#167a58" stroke-width="8" stroke-linecap="round"/>
</svg>`;

const bad = `<svg width="1200" height="525" viewBox="0 0 1200 525" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="525" fill="#e7dddd"/>
  <rect x="58" y="45" width="1084" height="435" rx="22" fill="#e5e3e3" stroke="#ae8f92" stroke-width="4"/>
  <g opacity=".72">
    <ellipse cx="355" cy="270" rx="200" ry="134" fill="#fff"/><ellipse cx="355" cy="270" rx="158" ry="96" fill="#9a6445"/>
    <ellipse cx="765" cy="290" rx="205" ry="135" fill="#fff"/><ellipse cx="765" cy="290" rx="159" ry="95" fill="#788747"/>
    <circle cx="1020" cy="136" r="80" fill="#d8bd9b"/><path d="M944 118Q1020 34 1096 118V70H944Z" fill="#41454a"/>
  </g>
  <g stroke="#b4232f" stroke-width="16" stroke-linecap="round"><path d="M92 78l82 82M174 78l-82 82"/><path d="M1026 384l82 82M1108 384l-82 82"/></g>
  <path d="M260 190L920 370M250 320L890 196" stroke="#ffffff" stroke-width="24" opacity=".38"/>
</svg>`;

await Promise.all([
  sharp(Buffer.from(good)).jpeg({ quality: 90 }).toFile(resolve(output, 'photo-good.jpg')),
  sharp(Buffer.from(bad)).blur(1.4).jpeg({ quality: 90 }).toFile(resolve(output, 'photo-bad.jpg')),
]);
