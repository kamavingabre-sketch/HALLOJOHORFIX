// Demo: tampilkan persis pesan yang dikirim bot saat ada berita baru
import fs from 'fs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'dummy';
if (typeof globalThis.WebSocket === 'undefined') {
  const { default: ws } = await import('ws');
  globalThis.WebSocket = ws;
}
const { getBeritaTerbaru, formatBeritaWhatsApp, scrapeBeritaPortal, resolveRealUrl, resolveThumbnailAsli } = await import('./berita-medan.js');

// ── Skenario A: sumber PORTAL (foto + caption lengkap) — pakai fixture struktur nyata
const http = await import('http');
const fixture = fs.readFileSync('./test-fixture-berita.html', 'utf8');
const server = http.createServer((req, res) => { res.writeHead(200, {'Content-Type':'text/html'}); res.end(fixture); });
await new Promise(r => server.listen(45673, r));
const portal = await scrapeBeritaPortal('http://localhost:45673/berita/');
server.close();

const a = portal.items[0];
console.log('═══ SKENARIO A — sumber: PORTAL LANGSUNG ═══');
console.log('Jenis pesan : FOTO + CAPTION');
console.log('URL foto    :', a.gambarUrl);
console.log('── isi caption ──');
console.log(formatBeritaWhatsApp(a));
console.log('');

// ── Skenario B: sumber GOOGLE NEWS RSS (fallback) — data asli hari ini, alur persis produksi
const live = await getBeritaTerbaru();
const b = live.items[0];
b.url = await resolveRealUrl(b.url, b.judul);
console.log('(link dipecahkan →', b.url, ')');
if (!b.gambarUrl && b.thumbAttachmentUrl) {
  b.gambarUrl = await resolveThumbnailAsli(b.thumbAttachmentUrl) || '';
}
if (b.gambarUrl) {
  try {
    const { default: axiosD } = await import('axios');
    const img = await axiosD.get(b.gambarUrl, { responseType: 'arraybuffer', timeout: 20000 });
    fs.writeFileSync('/tmp/foto-live.jpg', Buffer.from(img.data));
    console.log('(foto live terunduh:', img.data.length, 'bytes,', img.headers['content-type'], ')');
  } catch (e) { console.log('(unduh foto gagal:', e.message, ')'); }
}
console.log('');
console.log('═══ SKENARIO B — sumber saat ini: ' + live.source.toUpperCase() + ' (data asli, barusan diambil) ═══');
console.log('Jenis pesan : ' + (b.gambarUrl ? 'FOTO + CAPTION' : 'TEKS'));
console.log('URL foto    :', b.gambarUrl || '(tidak ada)');
console.log('── isi caption ──');
console.log(formatBeritaWhatsApp(b));

// Simpan contoh untuk mockup visual
fs.writeFileSync('/tmp/pesan-portal.txt', formatBeritaWhatsApp(a));
fs.writeFileSync('/tmp/pesan-live.txt', formatBeritaWhatsApp(b));
console.log('\n(disimpan ke /tmp/pesan-portal.txt & /tmp/pesan-live.txt)');
