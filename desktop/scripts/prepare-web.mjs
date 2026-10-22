/**
 * Собирает `desktop/web` - фронт для установщика: тот же Next, что у
 * kort.cards (`output: "standalone"`), из того же коммита.
 *
 *   node scripts/prepare-web.mjs            - собрать фронт и разложить
 *   node scripts/prepare-web.mjs --no-build - разложить уже собранный
 *
 * pnpm кладёт зависимости standalone ссылками в `node_modules/.pnpm`, а
 * установщик ссылок не переносит, и пути вида `.pnpm/next@…_<хеш>/…` в папке
 * профиля Windows упираются в 260 символов. Поэтому пакеты раскладываются
 * плоско, настоящими папками. Две версии одного пакета - отказ, а не выбор.
 *
 * И лежат они в `web/modules`, а не в `node_modules`: папку с таким именем
 * electron-builder из ресурсов выбрасывает молча, даже с фильтром, и
 * собранный KORT падал «Cannot find module 'next'». Где их искать, Node
 * подсказывает `start.js` (NODE_PATH).
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const out = path.resolve(here, "..", "web");
const standalone = path.join(root, ".next", "standalone");

if (!process.argv.includes("--no-build")) {
  execSync("pnpm build", { cwd: root, stdio: "inherit" });
}
if (!fs.existsSync(path.join(standalone, "server.js"))) {
  throw new Error(`нет ${standalone}/server.js - фронт не собран с output: "standalone"`);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const entry of fs.readdirSync(standalone)) {
  if (entry === "node_modules") continue;
  fs.cpSync(path.join(standalone, entry), path.join(out, entry), { recursive: true, dereference: true });
}

/** Пакеты папки `node_modules`: имя → путь; `@scope/имя` - одним именем. */
function packages(dir) {
  const found = [];
  for (const name of fs.readdirSync(dir)) {
    if (name === ".pnpm" || name === ".bin" || name.startsWith(".")) continue;
    if (name.startsWith("@")) {
      for (const inner of fs.readdirSync(path.join(dir, name))) found.push([`${name}/${inner}`, path.join(dir, name, inner)]);
    } else found.push([name, path.join(dir, name)]);
  }
  return found;
}

const modules = path.join(out, "modules");
const source = path.join(standalone, "node_modules");
const store = path.join(source, ".pnpm");
const placed = new Map();

function place(name, from) {
  const real = fs.realpathSync(from);
  if (placed.has(name)) {
    if (placed.get(name) === real) return;
    throw new Error(`две версии пакета ${name}: ${placed.get(name)} и ${real}`);
  }
  placed.set(name, real);
  fs.cpSync(real, path.join(modules, name), { recursive: true, dereference: true });
}

if (fs.existsSync(store)) {
  // pnpm: каждый пакет - настоящей папкой в `.pnpm/<пакет@версия>/node_modules/<имя>`,
  // рядом с ним - ссылки на его зависимости.
  for (const bundle of fs.readdirSync(store)) {
    if (bundle === "node_modules") continue;
    for (const [name, from] of packages(path.join(store, bundle, "node_modules"))) {
      if (fs.lstatSync(from).isSymbolicLink()) continue;
      place(name, from);
    }
  }
} else if (fs.existsSync(source)) {
  for (const [name, from] of packages(source)) place(name, from);
}

fs.cpSync(path.join(root, ".next", "static"), path.join(out, ".next", "static"), { recursive: true });
if (fs.existsSync(path.join(root, "public"))) {
  fs.cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
}

fs.writeFileSync(
  path.join(out, "start.js"),
  [
    "// Фронт десктопа: пакеты - в `modules` (см. desktop/scripts/prepare-web.mjs).",
    'const path = require("node:path");',
    'process.env.NODE_PATH = path.join(__dirname, "modules");',
    'require("node:module")._initPaths();',
    'require("./server.js");',
    "",
  ].join("\n"),
);

console.log(`desktop/web: ${placed.size} пакетов - ${[...placed.keys()].sort().join(", ")}`);
