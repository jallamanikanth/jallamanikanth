#!/usr/bin/env node
/**
 * Renders the animated "terminal card" that sits at the top of the profile
 * README: an ASCII portrait of the person on the left, a system/contact
 * readout on the right, with a top-down reveal + typewriter animation.
 *
 * Everything is data-driven from profile.config.json + portrait.txt, so
 * updating the card is a matter of editing JSON and re-running `npm run card`.
 *
 * Outputs: light.svg + dark.svg (README swaps them with <picture>).
 *
 *   node generate-card.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const cfg = JSON.parse(read("profile.config.json"));
const portrait = read(cfg.portrait || "portrait.txt").replace(/\n+$/, "").split("\n");

// ── geometry ────────────────────────────────────────────────────────────
const W = 1180;
const H = 610;
const DIV_X = 520; // vertical rule between the two panels
const RIGHT = 1150;
const MONO = "'JetBrains Mono','SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace";
const CYCLE = 14; // seconds — ambient gradient + scan cycle

const A = { x: 34, top: 100, font: 8.6, lh: 10.3 };
const I = { x: 548, head: 100, sep: 124, top: 150, lh: 21, font: 12, cw: 7.2, valueX: 772 };
const LEAD_IN = 0.5; // when the first row starts typing
const STAGGER = 0.05;

// ── themes ──────────────────────────────────────────────────────────────
const THEMES = {
  light: {
    page: ["#F8FAFC", "#DDE4EC"],
    card: ["#FFFFFF", "#F6F8FB"],
    titlebar: "#F1F5F9",
    border: ["#4F46E5", "#0EA5E9", "#059669"],
    dots: ["#F87171", "#FBBF24", "#34D399"],
    chrome: "#64748B",
    command: "#334155",
    panel: "#94A3B8",
    ascii: ["#4338CA", "#7C3AED", "#0891B2"],
    key: "#0369A1",
    value: "#0F172A",
    leader: "#CBD5E1",
    accent: "#0D9488",
    scan: "#0EA5E9",
    scanline: "#334155",
    rule: "#E2E8F0",
  },
  dark: {
    page: ["#0E1524", "#080C14"],
    card: ["#0D1117", "#111827"],
    titlebar: "#161B22",
    border: ["#6366F1", "#22D3EE", "#10B981"],
    dots: ["#F87171", "#FBBF24", "#34D399"],
    chrome: "#8B949E",
    command: "#C9D1D9",
    panel: "#6E7681",
    ascii: ["#818CF8", "#A78BFA", "#22D3EE"],
    key: "#7DD3FC",
    value: "#E6EDF3",
    leader: "#30363D",
    accent: "#34D399",
    scan: "#38BDF8",
    scanline: "#E6EDF3",
    rule: "#21262D",
  },
};

// ── helpers ─────────────────────────────────────────────────────────────
const fmt = (n) => Number(n.toFixed(2));

function buildInfo(t) {
  const clips = [];
  const groups = [];
  const maxW = RIGHT - I.x + 6;
  let y = I.top;
  let i = 0;

  // one animated (typewriter) group per content line
  const emit = (inner) => {
    const begin = fmt(LEAD_IN + i * STAGGER);
    clips.push(
      `<clipPath id="ty${i}"><rect x="${I.x - 6}" y="${fmt(y - 15)}" width="0" height="21">` +
        `<animate attributeName="width" from="0" to="${fmt(maxW)}" dur="0.42s" begin="${begin}s" fill="freeze"/>` +
        `</rect></clipPath>`
    );
    groups.push(`<g clip-path="url(#ty${i})">${inner}</g>`);
    i += 1;
  };

  for (const section of cfg.sections) {
    if (section.heading) {
      const hw = section.heading.length * I.cw;
      emit(
        `<text class="heading" x="${I.x}" y="${y}">${esc(section.heading)}</text>` +
          `<line x1="${fmt(I.x + hw + 12)}" y1="${fmt(y - 4)}" x2="${RIGHT}" y2="${fmt(y - 4)}" ` +
          `stroke="${t.leader}" stroke-width="1" stroke-dasharray="2 5"/>`
      );
      y += I.lh;
    }
    for (const [key, value] of section.rows) {
      const labelled = `${key}:`;
      const leaderX = I.x + 18 + labelled.length * I.cw;
      const dots = ".".repeat(Math.max(2, Math.floor((I.valueX - leaderX) / I.cw) - 1));
      emit(
        `<text class="bullet" x="${I.x}" y="${y}">·</text>` +
          `<text class="key" x="${I.x + 18}" y="${y}">${esc(labelled)}</text>` +
          `<text class="leader" x="${fmt(leaderX)}" y="${y}">${dots}</text>` +
          `<text class="value" x="${I.valueX}" y="${y}">${esc(value)}</text>`
      );
      y += I.lh;
    }
    y += 9; // breathing room between sections
  }

  return { clips: clips.join(""), groups: groups.join("") };
}

function buildAscii() {
  return portrait
    .map(
      (line, i) =>
        `<text class="ascii" x="${A.x}" y="${fmt(A.top + i * A.lh)}" ` +
        `xml:space="preserve">${esc(line)}</text>`
    )
    .join("");
}

function buildCard(t) {
  const info = buildInfo(t);
  const asciiTop = A.top - A.font;
  const asciiBottom = A.top + portrait.length * A.lh;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Profile card for ${esc(cfg.host)}">
<defs>
  <linearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="${t.border[0]}"/>
    <stop offset="50%" stop-color="${t.border[1]}"/>
    <stop offset="100%" stop-color="${t.border[2]}"/>
  </linearGradient>
  <linearGradient id="asciiGrad" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="${t.ascii[0]}">
      <animate attributeName="stop-color" values="${t.ascii[0]};${t.ascii[1]};${t.ascii[2]};${t.ascii[0]}" dur="${CYCLE}s" repeatCount="indefinite"/>
    </stop>
    <stop offset="100%" stop-color="${t.ascii[2]}">
      <animate attributeName="stop-color" values="${t.ascii[2]};${t.ascii[0]};${t.ascii[1]};${t.ascii[2]}" dur="${CYCLE}s" repeatCount="indefinite"/>
    </stop>
  </linearGradient>
  <radialGradient id="pageGrad" cx="28%" cy="10%" r="95%">
    <stop offset="0%" stop-color="${t.page[0]}"/>
    <stop offset="100%" stop-color="${t.page[1]}"/>
  </radialGradient>
  <linearGradient id="cardGrad" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="${t.card[0]}"/>
    <stop offset="100%" stop-color="${t.card[1]}"/>
  </linearGradient>
  <linearGradient id="scanGrad" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="${t.scan}" stop-opacity="0"/>
    <stop offset="50%" stop-color="${t.scan}" stop-opacity="0.42"/>
    <stop offset="100%" stop-color="${t.scan}" stop-opacity="0"/>
  </linearGradient>
  <pattern id="scanlines" width="4" height="4" patternUnits="userSpaceOnUse">
    <rect width="4" height="1" fill="${t.scanline}" opacity="0.05"/>
  </pattern>
  <filter id="softGlow" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur stdDeviation="3.2" result="b"/>
    <feMerge>
      <feMergeNode in="b"/>
      <feMergeNode in="SourceGraphic"/>
    </feMerge>
  </filter>
  <mask id="reveal" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
    <rect x="0" y="0" width="${W}" height="0" fill="#ffffff">
      <animate attributeName="height" from="0" to="${fmt(H - 10)}" dur="1.5s" begin="0.15s" fill="freeze"/>
    </rect>
  </mask>
  ${info.clips}
  <style>
    .ascii { font-family: ${MONO}; font-size: ${A.font}px; fill: url(#asciiGrad); }
    .headline { font-family: ${MONO}; font-size: ${I.font}px; font-weight: 700; fill: ${t.key}; }
    .bullet { font-family: ${MONO}; font-size: ${I.font}px; fill: ${t.accent}; }
    .key { font-family: ${MONO}; font-size: ${I.font}px; fill: ${t.key}; }
    .leader { font-family: ${MONO}; font-size: ${I.font}px; fill: ${t.leader}; }
    .value { font-family: ${MONO}; font-size: ${I.font}px; fill: ${t.value}; }
    .heading { font-family: ${MONO}; font-size: ${I.font}px; font-weight: 700; letter-spacing: 1.1px; fill: ${t.accent}; text-transform: uppercase; }
    .chrome { font-family: ${MONO}; font-size: 11px; letter-spacing: 1.7px; fill: ${t.chrome}; }
    .command { font-family: ${MONO}; font-size: 12px; fill: ${t.command}; }
  </style>
</defs>

<rect x="0" y="0" width="${W}" height="${H}" rx="22" fill="url(#pageGrad)"/>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="21" fill="url(#cardGrad)" stroke="url(#borderGrad)" stroke-width="1.6"/>
<rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="20" fill="url(#scanlines)"/>

<!-- title bar -->
<path d="M2 22 A20 20 0 0 1 22 2 H${W - 22} A20 20 0 0 1 ${W - 2} 22 V48 H2 Z" fill="${t.titlebar}" opacity="0.92"/>
<line x1="2" y1="48" x2="${W - 2}" y2="48" stroke="${t.rule}" stroke-width="1"/>
<circle cx="28" cy="25" r="5.4" fill="${t.dots[0]}"/>
<circle cx="48" cy="25" r="5.4" fill="${t.dots[1]}"/>
<circle cx="68" cy="25" r="5.4" fill="${t.dots[2]}"/>
<text class="command" x="${W / 2}" y="29" text-anchor="middle">${esc(cfg.host)} ~ % ${esc(cfg.command)}</text>
<circle cx="1063" cy="25" r="3.4" fill="${t.scan}">
  <animate attributeName="opacity" values="1;0.2;1" dur="1.6s" repeatCount="indefinite"/>
</circle>
<text class="chrome" x="${RIGHT}" y="29" text-anchor="end">SCANNING</text>

<!-- panel headers -->
<text class="chrome" x="${A.x}" y="76">VISUAL.MAP</text>
<text class="chrome" x="${I.x}" y="76">SYSTEM.INFO</text>
<line x1="${DIV_X}" y1="62" x2="${DIV_X}" y2="${H - 24}" stroke="${t.rule}" stroke-width="1"/>

<!-- left: ascii portrait, revealed top-down -->
<g mask="url(#reveal)" filter="url(#softGlow)">
${buildAscii()}
</g>
<rect x="${A.x}" y="${fmt(asciiBottom + 6)}" width="180" height="1.4" fill="url(#asciiGrad)" opacity="0.5"/>
<text class="chrome" x="${A.x}" y="${fmt(asciiBottom + 28)}">ASCII.PORTRAIT · ${portrait[0].length}×${portrait.length}</text>
<rect x="${DIV_X - 62}" y="${fmt(asciiTop)}" width="34" height="${fmt(asciiBottom - asciiTop)}" fill="url(#scanGrad)" opacity="0.5">
  <animate attributeName="x" values="${A.x};${DIV_X - 62};${A.x}" dur="${CYCLE}s" repeatCount="indefinite"/>
</rect>

<!-- right: system readout -->
<text class="headline" x="${I.x}" y="${I.head}">${esc(cfg.host)}</text>
<line x1="${I.x}" y1="${I.sep - 4}" x2="${RIGHT}" y2="${I.sep - 4}" stroke="${t.leader}" stroke-width="1" stroke-dasharray="1 3"/>
${info.groups}
<rect x="${I.x}" y="${I.top - 16}" width="8" height="15" fill="${t.key}" opacity="0.75">
  <animate attributeName="opacity" values="0.75;0;0.75" dur="1.1s" repeatCount="indefinite"/>
</rect>
</svg>
`;
}

// ── main ────────────────────────────────────────────────────────────────
const outputs = cfg.outputs || { light: "light.svg", dark: "dark.svg" };
for (const [theme, file] of Object.entries(outputs)) {
  const themeSpec = THEMES[theme];
  if (!themeSpec) throw new Error(`Unknown theme "${theme}" in profile.config.json outputs`);
  const svg = buildCard(themeSpec);
  const out = path.join(ROOT, file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, svg, "utf8");
  console.log(`wrote ${file} (${svg.length} bytes)`);
}