import fs from 'node:fs';
import assert from 'node:assert/strict';

const app = fs.readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('./public/styles.css', import.meta.url), 'utf8');
const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

assert.ok(['0.7.8','0.7.9','0.8.0'].includes(pkg.version));
assert.match(app, /const FRESHNESS_POLL_MS = 20_000;/);
assert.match(app, /document\.hidden \|\| !state\.accessKey/);
assert.match(app, /await loadDashboard\(\{ silent: true \}\)/);
assert.match(app, /await loadReport\(\{ silent: true \}\)/);
assert.match(app, /async function loadDashboard\(\{ silent = false \} = \{\}\)/);
assert.match(app, /if \(silent\) console\.warn\("silent dashboard refresh failed"/);
assert.match(app, /ล่าสุด \$\{formatBangkokClock\(metrics\.last_event_at\)\}/);

assert.match(html, />อัปเดต<\/button>/);
assert.match(html, /<strong>ข้อมูลเปลี่ยนแล้ว<\/strong>/);
assert.match(html, /<h2>สรุปยอด<\/h2>/);
assert.match(html, /<h2>ตัดยอด<\/h2>/);
assert.match(html, /เลือกรหัสได้หลายตัว ระบบแบ่งรอบให้เอง/);
assert.match(html, /กำหนดรหัสก่อนปิดยอด/);
assert.match(html, /ตั้งค่ากลุ่ม, %, Point และคลัง/);

assert.doesNotMatch(html, /Risk Budget/);
assert.doesNotMatch(html, /Point Reserve/);
assert.doesNotMatch(html, /ตรวจผล Parser/);
assert.doesNotMatch(html, /SQL Editor/);
assert.doesNotMatch(app, /ข้อมูลล่าสุด:/);
assert.doesNotMatch(app, /อัปเดต ณ ตอนนี้/);
assert.match(styles, /v6\.8: quieter refresh \+ concise operational copy/);

console.log('PASS: Quiet 20s refresh + concise UI copy v6.8 smoke tests');
