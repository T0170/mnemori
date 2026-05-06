/**
 * Generates ffmpeg-integrity.json containing the SHA-256 hash of the bundled
 * ffmpeg binary. Run during CI before electron-builder packages the app.
 *
 * Usage: node scripts/generate-ffmpeg-hash.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const platform = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';

let ffmpegPath;
try {
  ffmpegPath = require('ffmpeg-static');
} catch (e) {
  console.error('ffmpeg-static not found — skipping integrity hash generation');
  process.exit(0);
}

if (!fs.existsSync(ffmpegPath)) {
  console.error('ffmpeg binary not found at', ffmpegPath);
  process.exit(1);
}

const hash = crypto.createHash('sha256');
hash.update(fs.readFileSync(ffmpegPath));
const digest = hash.digest('hex');

const outPath = path.join(__dirname, '..', 'src', 'main', 'ffmpeg-integrity.json');
let existing = {};
if (fs.existsSync(outPath)) {
  try { existing = JSON.parse(fs.readFileSync(outPath, 'utf-8')); } catch (_) {}
}
existing[platform] = digest;

fs.writeFileSync(outPath, JSON.stringify(existing, null, 2) + '\n');
console.log(`ffmpeg integrity hash for ${platform}: ${digest.slice(0, 16)}...`);
console.log(`Written to ${outPath}`);
