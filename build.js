"use strict";
/* Inlines styles.css + data.js + charts.js + app.js into a single self-contained
   app.html for static preview/sharing. Run: node build.js */
const fs = require("fs");
const path = require("path");

const read = f => fs.readFileSync(path.join(__dirname, f), "utf8");
const css  = read("styles.css");
const data = read("data.js");
const charts = read("charts.js");
const app  = read("app.js");

const html = read("index.html")
  .replace('<link rel="stylesheet" href="styles.css"/>', `<style>\n${css}\n</style>`)
  .replace('<script src="data.js"></script>', `<script>\n${data}\n</script>`)
  .replace('<script src="charts.js"></script>', `<script>\n${charts}\n</script>`)
  .replace('<script src="app.js"></script>', `<script>\n${app}\n</script>`);

fs.writeFileSync(path.join(__dirname, "app.html"), html, "utf8");
console.log("built app.html —", (html.length / 1024).toFixed(1), "KB");
