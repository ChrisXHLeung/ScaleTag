import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { STATIC_ASSETS, serviceWorkerSource } from "../src/pwa.js";

test("poster.js is allowlisted in service worker static assets", () => {
  assert.ok(STATIC_ASSETS.includes("/poster.js"));
  const sw = serviceWorkerSource();
  assert.match(sw, /\/poster\.js/);
});

test("poster.js defines A4 300 DPI dimensions and bilingual labels", async () => {
  const src = await readFile(new URL("../public/poster.js", import.meta.url), "utf8");
  assert.match(src, /POSTER_WIDTH\s*=\s*2480/);
  assert.match(src, /POSTER_HEIGHT\s*=\s*3508/);
  assert.match(src, /打印 A4 海报/);
  assert.match(src, /Print A4 poster/);
  assert.match(src, /保存 A4 海报/);
  assert.match(src, /Save A4 poster/);
  assert.match(src, /window\.print\(\)/);
});

test("poll, task, and sale pages wire mountPosterActions while keeping pure QR endpoints", async () => {
  for (const [file, qrPattern] of [
    ["../public/app.js", /\/api\/polls\/\$\{id\}\/qr\.png/],
    ["../public/tasks.js", /\/api\/tasks\/\$\{id\}\/qr\.png/],
    ["../public/sales.js", /\/api\/sales\/\$\{id\}\/qr\.png/],
  ]) {
    const src = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(src, /mountPosterActions/, `${file} should mount poster actions`);
    assert.match(src, qrPattern, `${file} should preserve pure QR image`);
  }
});

test("base.css configures A4 portrait print layout for #poster-print-root", async () => {
  const css = await readFile(new URL("../public/base.css", import.meta.url), "utf8");
  assert.match(css, /@media\s+print/);
  assert.match(css, /size:\s*A4\s+portrait/);
  assert.match(css, /#poster-print-root/);
});
