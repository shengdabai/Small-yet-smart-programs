import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScript, seed } from "./helpers/run.ts";

const scratch = mkdtempSync(join(tmpdir(), "smart-programs-htmlv2-"));
const DB = join(scratch, "miner.db");
const outDir = join(scratch, "reports");
const binDir = join(scratch, "bin");
const profilePath = join(scratch, "profile.json");
const openLog = join(scratch, "open.log");

beforeAll(() => {
  Bun.spawnSync({ cmd: ["mkdir", "-p", binDir, outDir] });
  // The script opens the finished page with `open`; a shim records the call so
  // no browser is launched and the test can prove the shim was what ran.
  const fakeOpen = join(binDir, "open");
  writeFileSync(fakeOpen, `#!/bin/sh\nprintf '%s\\n' "$@" >> "${openLog}"\n`);
  chmodSync(fakeOpen, 0o755);

  // Operator profile with markup in every string field.
  writeFileSync(profilePath, JSON.stringify({
    owner: `Op <b>bold</b>`,
    assets: [],
    currentProjects: [{ name: `<img src=x onerror="alert(3)">`, stage: `"><i>stage</i>`, est: 20, fit: "x" }],
  }));

  seed(DB, [
    {
      // ⭐⭐⭐ with hostile LLM output in why_them / replication_difficulty and a non-web URL.
      source: "hackernews",
      external_id: "hostile",
      name: `Tom &amp; Jerry Tools Builder Studio Pro XL`,
      url: "javascript:alert(1)",
      description: `<script>alert(2)</script>`,
      signal_score: 40,
      scored: {
        total: 30,
        tier: "⭐⭐⭐",
        window_estimate: "6-12 个月",
        replication_difficulty: `Low<script>alert(4)</script>`,
        why_them: JSON.stringify({ ta_has: [`<b>x</b>`], operator_has: [], gap_severity: `high" onmouseover="alert(5)` }),
      },
    },
    {
      source: "toolify",
      external_id: "plain",
      name: "Plain",
      url: "https://example.com/p?a=1&b=2",
      description: "fine",
      signal_score: 5,
      scored: { total: 24, tier: "⭐⭐", replication_difficulty: "Mid", why_them: JSON.stringify({ gap_severity: "mid" }) },
    },
    // Unscored candidate whose name is NULL (sources may store none).
    { source: "toolify", external_id: "noname", url: "https://example.com/n", signal_score: 1 },
  ]);
});

afterAll(() => rmSync(scratch, { force: true, recursive: true }));

describe("report-html-v2.ts", () => {
  test("writes to --out, escapes stored and profile data, and never emits executable markup", () => {
    const r = runScript(DB, "report-html-v2.ts", ["--out", outDir], {
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      SMART_PROGRAMS_PROFILE: profilePath,
    });
    expect(r.code).toBe(0);
    const files = readdirSync(outDir).filter((f) => f.endsWith("-report-v2.html"));
    expect(files).toHaveLength(1);
    const outPath = join(outDir, files[0]);
    expect(r.out.trim()).toBe(outPath);
    // the shim was invoked with the page, so a real browser was never opened
    expect(existsSync(openLog)).toBe(true);
    expect(readFileSync(openLog, "utf8").trim()).toBe(outPath);

    const html = readFileSync(outPath, "utf8");
    // link targets
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="https://example.com/p?a=1&amp;b=2"');
    // candidate data
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("alert(4)</script>");
    expect(html).toContain("Low&lt;script&gt;alert(4)&lt;/script&gt;");
    expect(html).not.toContain("<b>x</b>");
    // why_them.gap_severity may only select a known class, never inject an attribute
    expect(html).not.toContain('" onmouseover="');
    expect(html).not.toContain('class="gap-high" onmouseover');
    expect(html).toContain('class="gap-unknown">high&quot; onmouseover=&quot;alert(5)</span>');
    expect(html).toContain('class="gap-mid">mid</span>');
    // operator profile
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<i>stage</i>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(3)&quot;&gt;");
    expect(html).toContain("Op &lt;b&gt;bold&lt;/b&gt;");
    // a NULL name renders as an empty heading instead of "null"
    expect(html).not.toContain(">null<");
  });

  test("truncates matrix names before escaping and labels every filter control", () => {
    const files = readdirSync(outDir).filter((f) => f.endsWith("-report-v2.html"));
    const html = readFileSync(join(outDir, files[0]), "utf8");
    // 40 raw chars of "Tom &amp; Jerry Tools Builder Studio Pro XL", then escaped: no half entity
    expect(html).toContain('<td class="cand-name"><a href="#" target="_blank" rel="noopener">Tom &amp;amp; Jerry Tools Builder Studio Pro</a></td>');
    for (const id of ["f-tier", "f-source", "f-diff", "f-sort"]) {
      expect(html).toMatch(new RegExp(`<label class="fl">[^<]+<select id="${id}">`));
    }
    expect(html).toContain('<th scope="col">候选</th>');
  });
});
