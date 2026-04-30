const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'node_modules', 'builder-util', 'out', 'util.js');

if (!fs.existsSync(target)) {
  console.log('builder-util not found, skipping patch');
  process.exit(0);
}

let src = fs.readFileSync(target, 'utf8');
const needle = 'if (code === 0) {';
const replacement = 'if (code === 0 || code === 2) {';

if (src.includes(replacement)) {
  console.log('patch already applied');
  process.exit(0);
}

if (!src.includes(needle)) {
  console.log('patch target not found — builder-util may have changed');
  process.exit(0);
}

src = src.replace(needle, replacement);
fs.writeFileSync(target, src);
console.log('patched builder-util to tolerate 7-Zip exit code 2 (symlink warnings)');
