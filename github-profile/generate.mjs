#!/usr/bin/env node
/**
 * Renders an animated "jet over the contribution grid" SVG from a GitHub
 * user's REAL contribution calendar (last 34 weeks, 34 x 7 — the same layout
 * as GitHub's own heatmap). A little jet flies across the grid and "hits" the
 * busiest days with a bullet + flash + blast effect.
 *
 * Env vars:
 *   GH_USERNAME  GitHub login to render (required)
 *   GH_TOKEN     optional. With a token we use the GraphQL API, which also
 *                picks up private contributions when the token has `read:user`.
 *                Without it we fall back to GitHub's public contributions
 *                endpoint, so `node generate.mjs` still works locally.
 *   OUTPUT_PATH  where to write the SVG (default: dist/github-jet.svg)
 *   SAMPLE=1     generate a deterministic fake calendar (offline preview/tests)
 *
 *   node generate.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const USERNAME = process.env.GH_USERNAME || process.env.GITHUB_REPOSITORY_OWNER;
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const OUTPUT = process.env.OUTPUT_PATH || "dist/github-jet.svg";
const SAMPLE = process.env.SAMPLE === "1";

// ── layout (matches the reference design) ───────────────────────────────
const COLS = 34; // weeks shown
const ROWS = 7;
const CELL = 11;
const STEP = 14; // cell + gap
const GRID_X = 20;
const GRID_Y = 15;
const WIDTH = 513;
const HEIGHT = 170;
const JET_X_START = 35;
const JET_X_END = 478;
const PAD_Y = 128; // where bullets launch from (just under the grid)

// ── tuning ──────────────────────────────────────────────────────────────
const LOOP_DUR = 20; // seconds for one full there-and-back flight
const MAX_TARGETS = 12; // how many "busiest" days the jet fires on
const FLASH_COLOR = "#39d353";
const BULLET_COLOR = "#7ee787";
const BLAST_COLOR = "#56d364";
const EMPTY_COLOR = "#161b22";
const LEVEL_COLORS = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"];

const QUERY = `
  query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          weeks {
            contributionDays {
              date
              contributionCount
              color
            }
          }
        }
      }
    }
  }
`;

async function fetchViaGraphql() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { login: USERNAME } }),
  });
  if (!res.ok) throw new Error(`GitHub GraphQL error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data.user.contributionsCollection.contributionCalendar.weeks;
}

/** Public contribution calendar — no token required. */
async function fetchViaHtml() {
  const res = await fetch(`https://github.com/users/${encodeURIComponent(USERNAME)}/contributions`, {
    headers: { "User-Agent": "github-profile-jet-heatmap" },
  });
  if (!res.ok) throw new Error(`GitHub contributions page error ${res.status}`);
  const html = await res.text();

  const dayRe = /<td[^>]*data-date="(\d{4}-\d{2}-\d{2})"[^>]*data-level="(\d+)"[^>]*>([\s\S]*?)<\/td>/g;
  const days = [];
  let m;
  while ((m = dayRe.exec(html)) !== null) {
    const tooltip = (m[3].match(/<tool-tip[^>]*>([\s\S]*?)<\/tool-tip>/) || [, ""])[1]
      .replace(/<[^>]+>/g, "")
      .trim();
    const count = /^no contributions/i.test(tooltip) ? 0 : parseInt(tooltip, 10) || 0;
    days.push({ date: m[1], contributionCount: count, color: LEVEL_COLORS[Math.min(4, Number(m[2]))] });
  }
  if (!days.length) throw new Error("Could not parse any contribution days from GitHub's calendar");

  days.sort((a, b) => a.date.localeCompare(b.date));
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    const contributionDays = days.slice(i, i + 7);
    if (contributionDays.length === ROWS) weeks.push({ contributionDays });
  }
  return weeks;
}

/** Deterministic offline calendar so the design can be previewed in tests. */
function sampleWeeks() {
  const weeks = [];
  for (let w = 0; w < COLS; w++) {
    const contributionDays = [];
    for (let d = 0; d < ROWS; d++) {
      const seed = (w * 7 + d) % 13;
      const count = seed === 0 ? 12 : seed < 3 ? 4 : seed < 7 ? 1 : 0;
      const level = count === 0 ? 0 : count < 2 ? 1 : count < 5 ? 2 : count < 10 ? 3 : 4;
      contributionDays.push({
        date: `sample-${w}-${d}`,
        contributionCount: count,
        color: LEVEL_COLORS[level],
      });
    }
    weeks.push({ contributionDays });
  }
  return weeks;
}

async function fetchWeeks() {
  if (SAMPLE) return sampleWeeks();
  if (TOKEN) return fetchViaGraphql();
  return fetchViaHtml();
}

function buildCells(weeks) {
  // Most recent COLS weeks, left-padded with empty weeks for newer accounts.
  const recent = weeks.slice(-COLS);
  const padCount = COLS - recent.length;
  const padded = Array.from({ length: padCount }, () => ({
    contributionDays: Array.from({ length: ROWS }, () => ({
      contributionCount: 0,
      color: EMPTY_COLOR,
      date: null,
    })),
  })).concat(recent);

  const cells = [];
  padded.forEach((week, col) => {
    week.contributionDays.forEach((day, row) => {
      cells.push({
        col,
        row,
        x: GRID_X + col * STEP,
        y: GRID_Y + row * STEP,
        color: day.color || EMPTY_COLOR,
        count: day.contributionCount || 0,
        date: day.date,
      });
    });
  });
  return cells;
}

function pickTargets(cells) {
  return [...cells]
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_TARGETS)
    .sort((a, b) => a.col - b.col || a.row - b.row);
}

// Map a column index to the keyTime fraction along one direction of travel
// (forward pass spans 0 -> 0.5, backward spans 0.5 -> 1).
function keyTimeForCol(col, direction) {
  const span = 0.46; // leave headroom at both ends
  const t = 0.02 + (col / (COLS - 1)) * span;
  return direction === "forward" ? t : 1 - t;
}

const fmt = (n) => Number(n.toFixed(4));

function buildGrid(cells, targets) {
  const targetKey = new Set(targets.map((t) => `${t.col}-${t.row}`));
  let svg = "";
  for (const c of cells) {
    if (!targetKey.has(`${c.col}-${c.row}`)) {
      svg += `<rect x="${fmt(c.x)}" y="${fmt(c.y)}" width="${CELL}" height="${CELL}" rx="2" ry="2" fill="${c.color}"/>\n`;
      continue;
    }
    // Flash brighter twice: once as the jet passes forward, once on the way back
    const tFwd = keyTimeForCol(c.col, "forward");
    const tBack = keyTimeForCol(c.col, "backward");
    const [t1, t2] = [Math.min(tFwd, tBack), Math.max(tFwd, tBack)];
    const dur = 0.006;
    svg +=
      `<rect x="${fmt(c.x)}" y="${fmt(c.y)}" width="${CELL}" height="${CELL}" rx="2" ry="2" fill="${c.color}">` +
      `<animate attributeName="fill" dur="${LOOP_DUR}s" repeatCount="indefinite" ` +
      `keyTimes="0;${fmt(t1)};${fmt(t1 + dur)};${fmt(t2)};${fmt(t2 + dur)};1" ` +
      `values="${c.color};${c.color};${FLASH_COLOR};${c.color};${FLASH_COLOR};${c.color}"/>` +
      `</rect>\n`;
  }
  return svg;
}

function buildBulletsAndBlasts(targets) {
  let bullets = "";
  let blasts = "";
  const dur = 0.006;

  for (const dir of ["forward", "backward"]) {
    const ordered = dir === "forward" ? targets : [...targets].reverse();
    for (const c of ordered) {
      const t = keyTimeForCol(c.col, dir);
      const rise = t - dur * 3;
      const arrive = t;
      const fadeEnd = t + dur;
      const cx = fmt(c.x + CELL / 2);
      const targetY = fmt(c.y + CELL / 2);

      bullets +=
        `<circle cx="${cx}" cy="${PAD_Y}" r="2.4" fill="${BULLET_COLOR}">` +
        `<animate attributeName="cy" dur="${LOOP_DUR}s" repeatCount="indefinite" ` +
        `keyTimes="0;${fmt(rise)};${fmt(arrive)};1" values="${PAD_Y};${PAD_Y};${targetY};${targetY}"/>` +
        `<animate attributeName="opacity" dur="${LOOP_DUR}s" repeatCount="indefinite" ` +
        `keyTimes="0;${fmt(rise)};${fmt(arrive)};${fmt(fadeEnd)};1" values="0;1;1;0;0"/>` +
        `</circle>\n`;

      blasts +=
        `<circle cx="${cx}" cy="${targetY}" r="0" fill="none" stroke="${BLAST_COLOR}" stroke-width="1.6" opacity="0">` +
        `<animate attributeName="r" dur="${LOOP_DUR}s" repeatCount="indefinite" ` +
        `keyTimes="0;${fmt(arrive)};${fmt(arrive + dur * 3)};1" values="0;1;9;9"/>` +
        `<animate attributeName="opacity" dur="${LOOP_DUR}s" repeatCount="indefinite" ` +
        `keyTimes="0;${fmt(arrive)};${fmt(arrive + dur * 3)};1" values="0;1;1;0"/>` +
        `</circle>\n`;
    }
  }
  return { bullets, blasts };
}

function buildStars() {
  const pts = [
    [8, 20, 1.2], [8, 60, 1.6], [8, 100, 2.0],
    [505, 25, 1.2], [505, 70, 1.6], [505, 110, 2.0],
    [30, 164, 1.2], [483, 164, 1.6],
  ];
  return pts
    .map(
      ([x, y, dur]) =>
        `<circle cx="${x}" cy="${y}" r="1.1" fill="#8b949e"><animate attributeName="opacity" values="0.2;1;0.2" dur="${dur}s" repeatCount="indefinite"/></circle>`
    )
    .join("\n");
}

function buildJet() {
  return `<g id="jet">
  <g transform="translate(0,0)">
    <polygon points="0,-16 8,6 4,3 -4,3 -8,6" fill="#58a6ff" stroke="#1f6feb" stroke-width="1"/>
    <polygon points="-8,6 -14,12 -4,7" fill="#388bfd"/>
    <polygon points="8,6 14,12 4,7" fill="#388bfd"/>
    <circle cx="0" cy="-6" r="2.2" fill="#c9e6ff"/>
    <polygon points="-3,7 3,7 0,15" fill="#f0883e">
      <animate attributeName="opacity" values="0.5;1;0.6;1" dur="0.18s" repeatCount="indefinite"/>
    </polygon>
  </g>
  <animateTransform attributeName="transform" attributeType="XML" type="translate"
    dur="${LOOP_DUR}s" repeatCount="indefinite"
    keyTimes="0;0.5;1"
    values="${JET_X_START}.00,140.00;${JET_X_END}.00,140.00;${JET_X_START}.00,140.00"/>
</g>`;
}

function buildSvg(weeks) {
  const cells = buildCells(weeks);
  const targets = pickTargets(cells);
  const { bullets, blasts } = buildBulletsAndBlasts(targets);

  return `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" role="img" aria-label="GitHub contribution heatmap with animated jet">
<rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="#0d1117"/>
${buildStars()}
<g id="grid">
${buildGrid(cells, targets)}</g>
<g id="bullets">
${bullets}</g>
<g id="blasts">
${blasts}</g>
${buildJet()}
</svg>`;
}

async function main() {
  if (!USERNAME && !SAMPLE) {
    console.error("Missing GH_USERNAME env var (or set SAMPLE=1 for an offline preview)");
    process.exit(1);
  }
  const source = SAMPLE ? "sample data" : TOKEN ? "GraphQL API" : "public calendar";
  console.log(`Fetching contributions for ${USERNAME} via ${source}...`);
  const weeks = await fetchWeeks();
  const svg = buildSvg(weeks);
  const outPath = path.resolve(ROOT, OUTPUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, svg, "utf8");
  const total = buildCells(weeks).reduce((n, c) => n + c.count, 0);
  console.log(`Wrote ${outPath} (${total} contributions across the last ${COLS} weeks)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});