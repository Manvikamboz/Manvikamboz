#!/usr/bin/env node
/**
 * Generates animated "jet over contribution grid" SVGs (dark and light themes)
 * using a GitHub user's REAL contribution calendar.
 *
 * Env vars:
 *   GH_USERNAME  - GitHub login to fetch contributions for (default: Manvikamboz)
 *   GH_TOKEN     - token for GraphQL API (optional; falls back to public scraper if missing/invalid)
 */

import fs from "node:fs";
import path from "node:path";

const USERNAME = process.env.GH_USERNAME || "Manvikamboz";
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

const COLS = 53; // full year of weeks shown
const ROWS = 7;
const CELL = 11;
const STEP = 14; // cell + gap
const GRID_X = 20;
const GRID_Y = 15;
const WIDTH = 775;
const HEIGHT = 170;
const JET_X_START = 35;
const JET_X_END = 735;
const LOOP_DUR = 20; // seconds, one full there-and-back pass
const MAX_TARGETS = 12; // how many busiest days the jet fires on
const PAD_Y = 128; // bullet launch line

const DARK_THEME = {
  bg: "#0d1117",
  star: "#8b949e",
  flash: "#ff69b4",
  bullet: "#ff99d8",
  blast: "#ff69b4",
  jetMain: "#58a6ff",
  jetStroke: "#1f6feb",
  jetWing: "#388bfd",
  jetCockpit: "#c9e6ff",
  jetFlame: "#f0883e",
  levelColors: ["#161b22", "#4a1534", "#912361", "#e03e8c", "#ff69b4"],
};

const LIGHT_THEME = {
  bg: "#ffffff",
  star: "#d0d7de",
  flash: "#f74799",
  bullet: "#d61b6e",
  blast: "#f74799",
  jetMain: "#0969da",
  jetStroke: "#0550ae",
  jetWing: "#2188ff",
  jetCockpit: "#ddf4ff",
  jetFlame: "#ff8c00",
  levelColors: ["#ebedf0", "#ffc2e2", "#ff85c0", "#f74799", "#d61b6e"],
};

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

async function fetchWeeksFromGraphQL() {
  if (!TOKEN) return null;
  try {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `bearer ${TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "jet-heatmap-generator",
      },
      body: JSON.stringify({ query: QUERY, variables: { login: USERNAME } }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.errors || !json.data?.user?.contributionsCollection?.contributionCalendar?.weeks) {
      return null;
    }
    return json.data.user.contributionsCollection.contributionCalendar.weeks;
  } catch {
    return null;
  }
}

async function fetchWeeksFromHTML() {
  const url = `https://github.com/users/${USERNAME}/contributions`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch contributions page for ${USERNAME}: ${res.status}`);
  }
  const html = await res.text();
  const dayRegex = /<td[^>]*data-date="([^"]+)"[^>]*data-level="(\d+)"[^>]*>/g;
  const days = [];
  let match;
  while ((match = dayRegex.exec(html)) !== null) {
    days.push({
      date: match[1],
      level: parseInt(match[2], 10),
      count: parseInt(match[2], 10) * 3, // estimation for level sorting
    });
  }

  if (days.length === 0) {
    throw new Error("Could not parse contribution days from GitHub HTML");
  }

  // GitHub HTML table lists days by row (Sundays first, Mondays second, etc.).
  // Sort chronologically by date so grouping into 7-day weeks is 100% accurate.
  days.sort((a, b) => a.date.localeCompare(b.date));

  // Group into weeks of 7 days
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    const weekDays = days.slice(i, i + 7).map((d) => ({
      date: d.date,
      contributionCount: d.count,
      level: d.level,
    }));
    weeks.push({ contributionDays: weekDays });
  }
  return weeks;
}

async function getWeeksData() {
  const graphqlData = await fetchWeeksFromGraphQL();
  if (graphqlData) {
    console.log("Fetched contribution data via GitHub GraphQL API.");
    return graphqlData;
  }
  console.log("Fetching contribution data via public GitHub contributions endpoint...");
  return await fetchWeeksFromHTML();
}

function buildCells(weeks, theme) {
  const recent = weeks.slice(-COLS);
  const padCount = COLS - recent.length;
  const padded = Array.from({ length: padCount }, () => ({
    contributionDays: Array.from({ length: ROWS }, () => ({
      contributionCount: 0,
      level: 0,
      color: theme.levelColors[0],
      date: null,
    })),
  })).concat(recent);

  const cells = [];
  padded.forEach((week, col) => {
    week.contributionDays.forEach((day, row) => {
      let color = day.color;
      if (!color) {
        const level = typeof day.level === "number" ? day.level : 0;
        color = theme.levelColors[level] || theme.levelColors[0];
      }
      cells.push({
        col,
        row,
        x: GRID_X + col * STEP,
        y: GRID_Y + row * STEP,
        color,
        count: day.contributionCount || (day.level ? day.level * 3 : 0),
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

function keyTimeForCol(col, direction) {
  const span = 0.46;
  const t = 0.02 + (col / (COLS - 1)) * span;
  return direction === "forward" ? t : 1 - t;
}

function fmt(n) {
  return Number(n.toFixed(4));
}

function buildGrid(cells, targets, theme) {
  const targetKey = new Set(targets.map((t) => `${t.col}-${t.row}`));
  let svg = "";
  for (const c of cells) {
    const isTarget = targetKey.has(`${c.col}-${c.row}`);
    if (!isTarget) {
      svg += `<rect x="${c.x.toFixed(2)}" y="${c.y.toFixed(2)}" width="${CELL}" height="${CELL}" rx="2" ry="2" fill="${c.color}"/>\n`;
      continue;
    }
    const tFwd = keyTimeForCol(c.col, "forward");
    const tBack = keyTimeForCol(c.col, "backward");
    const [t1, t2] = [Math.min(tFwd, tBack), Math.max(tFwd, tBack)];
    const dur = 0.006;
    svg += `<rect x="${c.x.toFixed(2)}" y="${c.y.toFixed(2)}" width="${CELL}" height="${CELL}" rx="2" ry="2" fill="${c.color}">` +
      `<animate attributeName="fill" dur="${LOOP_DUR}s" repeatCount="indefinite" ` +
      `keyTimes="0;${fmt(t1)};${fmt(t1 + dur)};${fmt(t2)};${fmt(t2 + dur)};1" ` +
      `values="${c.color};${c.color};${theme.flash};${c.color};${theme.flash};${c.color}"/>` +
      `</rect>\n`;
  }
  return svg;
}

function buildBulletsAndBlasts(targets, theme) {
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

      bullets += `<circle cx="${cx}" cy="${PAD_Y}" r="2.4" fill="${theme.bullet}">` +
        `<animate attributeName="cy" dur="${LOOP_DUR}s" repeatCount="indefinite" ` +
        `keyTimes="0;${fmt(rise)};${fmt(arrive)};1" values="${PAD_Y};${PAD_Y};${targetY};${targetY}"/>` +
        `<animate attributeName="opacity" dur="${LOOP_DUR}s" repeatCount="indefinite" ` +
        `keyTimes="0;${fmt(rise)};${fmt(arrive)};${fmt(fadeEnd)};1" values="0;1;1;0;0"/>` +
        `</circle>\n`;

      blasts += `<circle cx="${cx}" cy="${targetY}" r="0" fill="none" stroke="${theme.blast}" stroke-width="1.6" opacity="0">` +
        `<animate attributeName="r" dur="${LOOP_DUR}s" repeatCount="indefinite" ` +
        `keyTimes="0;${fmt(arrive)};${fmt(arrive + dur * 3)};1" values="0;1;9;9"/>` +
        `<animate attributeName="opacity" dur="${LOOP_DUR}s" repeatCount="indefinite" ` +
        `keyTimes="0;${fmt(arrive)};${fmt(arrive + dur * 3)};1" values="0;1;1;0"/>` +
        `</circle>\n`;
    }
  }
  return { bullets, blasts };
}

function buildStars(theme) {
  const pts = [
    [8, 20, 1.2], [8, 60, 1.6], [8, 100, 2.0],
    [765, 25, 1.2], [765, 70, 1.6], [765, 110, 2.0],
    [30, 164, 1.2], [745, 164, 1.6],
  ];
  return pts.map(([x, y, dur]) =>
    `<circle cx="${x}" cy="${y}" r="1.1" fill="${theme.star}"><animate attributeName="opacity" values="0.2;1;0.2" dur="${dur}s" repeatCount="indefinite"/></circle>`
  ).join("\n");
}

function buildJet(theme) {
  return `<g id="jet">
  <g transform="translate(0,0)">
    <polygon points="0,-16 8,6 4,3 -4,3 -8,6" fill="${theme.jetMain}" stroke="${theme.jetStroke}" stroke-width="1"/>
    <polygon points="-8,6 -14,12 -4,7" fill="${theme.jetWing}"/>
    <polygon points="8,6 14,12 4,7" fill="${theme.jetWing}"/>
    <circle cx="0" cy="-6" r="2.2" fill="${theme.jetCockpit}"/>
    <polygon points="-3,7 3,7 0,15" fill="${theme.jetFlame}">
      <animate attributeName="opacity" values="0.5;1;0.6;1" dur="0.18s" repeatCount="indefinite"/>
    </polygon>
  </g>
  <animateTransform attributeName="transform" attributeType="XML" type="translate"
    dur="${LOOP_DUR}s" repeatCount="indefinite"
    keyTimes="0;0.5;1"
    values="${JET_X_START}.00,140.00;${JET_X_END}.00,140.00;${JET_X_START}.00,140.00"/>
</g>`;
}

function generateSvgForTheme(weeks, theme) {
  const cells = buildCells(weeks, theme);
  const targets = pickTargets(cells);
  const { bullets, blasts } = buildBulletsAndBlasts(targets, theme);

  return `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
<rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="${theme.bg}"/>
${buildStars(theme)}
<g id="grid">
${buildGrid(cells, targets, theme)}</g>
<g id="bullets">
${bullets}</g>
<g id="blasts">
${blasts}</g>
${buildJet(theme)}
</svg>`;
}

async function main() {
  console.log(`Generating GitHub Jet Heatmap animation for user: ${USERNAME}...`);
  const weeks = await getWeeksData();

  const darkSvg = generateSvgForTheme(weeks, DARK_THEME);
  const lightSvg = generateSvgForTheme(weeks, LIGHT_THEME);

  // Write dark.svg and light.svg at root
  fs.writeFileSync(path.resolve("dark.svg"), darkSvg, "utf8");
  fs.writeFileSync(path.resolve("light.svg"), lightSvg, "utf8");
  console.log("Successfully wrote dark.svg and light.svg");
}

main().catch((err) => {
  console.error("Error generating SVGs:", err);
  process.exit(1);
});
