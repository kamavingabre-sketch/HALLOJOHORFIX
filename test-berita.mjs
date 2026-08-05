// Test harness untuk berita-medan.js
import http from 'http';
import fs from 'fs';

// store.js (diimport berita-medan.js) butuh env + WebSocket native (Node 20 polyfill)
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'dummy';
if (typeof globalThis.WebSocket === 'undefined') {
  const { default: ws } = await import('ws');
  globalThis.WebSocket = ws;
}
const { scrapeBeritaPortal, fetchBeritaGoogleNews, getBeritaTerbaru, parseTanggalPortal, formatTanggalWib, formatBeritaWhatsApp, resolveRealUrl } = await import('./berita-medan.js');

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}`); }
}

console.log('═══ 1) parseTanggalPortal & formatTanggalWib ═══');
const d1 = parseTanggalPortal('Rabu, 05 Agustus 2026, 15:34:22');
assert(d1 && !isNaN(d1), 'parse "Rabu, 05 Agustus 2026, 15:34:22"');
console.log('     →', d1.toISOString(), '=>', formatTanggalWib(d1));
assert(formatTanggalWib(d1).includes('Rabu'), 'format WIB hari Rabu');
assert(formatTanggalWib(d1).includes('05 Agustus 2026'), 'format WIB tanggal');
assert(formatTanggalWib(d1).includes('15:34'), 'format WIB jam tetap 15:34 (bukan tergeser timezone)');
const d2 = parseTanggalPortal('28 Juli 2026');
assert(d2 && !isNaN(d2), 'parse tanpa nama hari & jam');
assert(parseTanggalPortal('abc') === null, 'string aneh → null');

console.log('\n═══ 2) Parser HTML portal (fixture lokal) ═══');
const fixture = fs.readFileSync('./test-fixture-berita.html', 'utf8');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(fixture);
});
await new Promise(r => server.listen(45671, r));
try {
  const hasil = await scrapeBeritaPortal('http://localhost:45671/berita/');
  console.log(`     ${hasil.items.length} item terparse`);
  const [a, b, c] = hasil.items;
  assert(hasil.items.length === 3, '3 artikel terdeteksi');
  assert(a.id === 'p:6470', `ID artikel benar (${a.id})`);
  assert(a.judul.includes('Duta Penggerak Ayah Teladan'), `judul benar: "${a.judul.substring(0, 60)}…"`);
  assert(a.url === 'https://portal.medan.go.id/berita/wali-kota-medan-dikukuhkan-jadi-duta-penggerak-ayah-teladan-rico-waas-jabatan-tertinggi-pria-dalam-keluarga__read6470.html', 'URL absolut benar');
  assert(a.gambarUrl === 'https://portal.medan.go.id/images/news/whatsapp-image-2026-08-05-at-152542_1785918862.jpeg', `gambarUrl benar: ${a.gambarUrl}`);
  assert(a.tanggalWib.includes('Rabu') && a.tanggalWib.includes('15:34'), `tanggalWib: ${a.tanggalWib}`);
  assert(a.kategori === 'Kota Medan', `kategori: "${a.kategori}"`);
  assert(a.ringkasan.includes('BKKBN') && !a.ringkasan.includes('Baca Selengkapnya') && !a.ringkasan.includes('Dibaca'), `ringkasan bersih: "${a.ringkasan.substring(0, 70)}…"`);
  assert(b.judul.includes('Sekolah Rakyat'), 'item 2 judul ✓');
  assert(c.gambarUrl.includes('/images/news/img-20260804'), 'item 3 gambar (src relatif) ✓');

  console.log('\n     Contoh pesan WhatsApp:');
  console.log('     ─────────────────────────────');
  console.log(formatBeritaWhatsApp(a).split('\n').map(s => '     ' + s).join('\n'));
  console.log('     ─────────────────────────────');
} finally {
  server.close();
}

console.log('\n═══ 3) Cloudflare page → harus throw PORTAL_BLOCKED ═══');
const cfServer = http.createServer((req, res) => {
  res.writeHead(403, { 'Content-Type': 'text/html' });
  res.end('<html><head><title>Just a moment...</title></head><body>challenge-platform</body></html>');
});
await new Promise(r => cfServer.listen(45672, r));
try {
  let threw = '';
  try { await scrapeBeritaPortal('http://localhost:45672/berita/'); } catch (e) { threw = e.message; }
  assert(/PORTAL_BLOCKED/.test(threw), `terdeteksi blokir: ${threw}`);
} finally {
  cfServer.close();
}

console.log('\n═══ 4) Google News RSS (jaringan nyata) ═══');
try {
  const g = await fetchBeritaGoogleNews();
  console.log(`     ${g.items.length} item · sumber: ${g.source}`);
  const first = g.items[0];
  assert(g.items.length >= 1, 'ada ≥1 item');
  assert(first.judul.length > 10 && !first.judul.includes('portal.medan.go.id'), `judul bersih: "${first.judul.substring(0, 60)}…"`);
  assert(first.id.startsWith('g:'), `id prefix g: ✓`);
  assert(first.url.includes('news.google.com'), 'url google ✓');
  console.log('     tanggalWib:', first.tanggalWib || '(kosong)');
} catch (e) {
  fail++; console.log('  ❌ Google News gagal:', e.message);
}

console.log('\n═══ 4b) Decode link Google → link portal asli (versi /berita/) ═══');
try {
  const g2 = await fetchBeritaGoogleNews();
  const item0 = g2.items[0];
  const real = await resolveRealUrl(item0.url, item0.judul);
  console.log('     judul  :', item0.judul.substring(0, 70) + '…');
  console.log('     google :', item0.url.substring(0, 90) + '…');
  console.log('     asli   :', real);
  assert(real.includes('portal.medan.go.id'), 'terpecahkan ke portal.medan.go.id');
  assert(!real.includes('news.google.com'), 'bukan link Google lagi');
  assert(!real.includes('/galeri-foto/'), 'BUKAN link galeri-foto (harus /berita/)');
  const urlTetap = await resolveRealUrl('https://portal.medan.go.id/berita/contoh__read123.html');
  assert(urlTetap === 'https://portal.medan.go.id/berita/contoh__read123.html', 'URL non-Google dibiarkan apa adanya');
} catch (e) {
  fail++; console.log('  ❌ decode gagal:', e.message);
}

console.log('\n═══ 4c) Kasus regresi: artikel "Duta Penggerak Ayah Teladan" → harus read6470 ═══');
try {
  const judulKasus = 'Wali Kota Medan Dikukuhkan Jadi Duta Penggerak Ayah Teladan, Rico Waas: Jabatan Tertinggi Pria Dalam Keluarga';
  const { cariUrlBeritaBerdasarkanJudul } = await import('./berita-medan.js');
  const u = await cariUrlBeritaBerdasarkanJudul(judulKasus);
  console.log('     →', u);
  assert(u && u.includes('/berita/'), 'ditemukan di /berita/');
  assert(u && u.includes('read6470'), 'persis artikel read6470');
} catch (e) {
  fail++; console.log('  ❌ kasus regresi gagal:', e.message);
}

console.log('\n═══ 4d) Foto berita via thumbnail Google News ═══');
try {
  const { ambilPetaThumbnailGNews, resolveThumbnailAsli } = await import('./berita-medan.js');
  const g3 = await fetchBeritaGoogleNews();
  const denganThumb = g3.items.filter(it => it.thumbAttachmentUrl);
  console.log(`     ${denganThumb.length}/${g3.items.length} item punya thumbnail`);
  assert(denganThumb.length >= 1, 'minimal 1 item punya thumbnail');
  const thumbAsli = await resolveThumbnailAsli(denganThumb[0].thumbAttachmentUrl);
  console.log('     URL asli:', (thumbAsli || '(gagal)').substring(0, 100));
  assert(thumbAsli && thumbAsli.includes('gstatic.com/images'), 'terresolve ke gstatic original');
  assert(!thumbAsli.includes('fopt'), 'param fopt sudah dibuang (kualitas asli)');
  // Unduh nyata — harus JPEG utuh
  const { default: axiosT } = await import('axios');
  const img = await axiosT.get(thumbAsli, { responseType: 'arraybuffer', timeout: 20000, validateStatus: () => true });
  const mime = (img.headers['content-type'] || '').split(';')[0];
  console.log(`     unduh: HTTP ${img.status}, ${img.data?.length || 0} bytes, ${mime}`);
  assert(img.status === 200 && img.data?.length > 5000, 'file terunduh dan berukuran wajar (>5KB)');
  assert(mime.startsWith('image/'), `mime gambar (${mime})`);
} catch (e) {
  fail++; console.log('  ❌ thumbnail gagal:', e.message);
}

console.log('\n═══ 5) getBeritaTerbaru end-to-end (portal diblokir → fallback) ═══');
try {
  const r = await getBeritaTerbaru();
  console.log(`     sumber: ${r.source} · ${r.items.length} item`);
  if (r.note) console.log('     note:', r.note);
  assert(r.items.length >= 1, 'selalu ada hasil');
} catch (e) {
  fail++; console.log('  ❌ getBeritaTerbaru gagal total:', e.message);
}

console.log(`\n═══ HASIL: ${pass} lolos, ${fail} gagal ═══`);
process.exit(fail ? 1 : 0);
