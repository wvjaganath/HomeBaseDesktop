/* Build-time patch for MagicMirror's index.html (run inside the image build).
 *
 * The page has a single inline <script> that sets window.mmVersion and
 * window.mmTestMode. Moving it to js/mm-env.js lets the hub serve MagicMirror
 * under a CSP with no 'unsafe-inline' for scripts. Fails the build loudly if
 * the upstream markup changes, so a MagicMirror upgrade can't silently undo it.
 *
 * Also pre-generates js/positions.js (see below).
 *
 * Usage: node patch-index.cjs /opt/magic_mirror
 */
const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("usage: node patch-index.cjs <magicmirror-dir>");
const indexPath = path.join(root, "index.html");
const html = fs.readFileSync(indexPath, "utf8");
const inline = /<script type="text\/javascript">\s*window\.mmVersion = "#VERSION#";\s*window\.mmTestMode = "#TESTMODE#";\s*<\/script>/;
if (!inline.test(html)) throw new Error("MagicMirror index.html changed: inline env script not found; review patch-index.cjs");

const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`unexpected MagicMirror version: ${version}`);

fs.writeFileSync(path.join(root, "js", "mm-env.js"), `window.mmVersion = ${JSON.stringify(version)};\nwindow.mmTestMode = "false";\n`);
fs.writeFileSync(indexPath, html.replace(inline, '<script src="js/mm-env.js"></script>'));
if (/<script(?![^>]*\bsrc=)[^>]*>/.test(fs.readFileSync(indexPath, "utf8"))) throw new Error("an inline <script> remains in index.html");

// js/positions.js is normally generated at startup, which can't happen on the
// read-only container filesystem. Generate it now with the same rule
// (MagicMirror's js/utils.js: /"region ([^"]*)/ per line of index.html).
const positions = [];
for (const line of html.split("\n")) {
	const m = /"region ([^"]*)/i.exec(line);
	const name = m && m[1].replace(" ", "_");
	if (name && !positions.includes(name)) positions.push(name);
}
if (positions.length < 5) throw new Error("could not discover module positions from index.html");
fs.writeFileSync(path.join(root, "js", "positions.js"), `const modulePositions=${JSON.stringify(positions)};\nglobalThis.modulePositions = modulePositions;`);

console.log(`patched index.html for MagicMirror ${version} (${positions.length} positions)`);
