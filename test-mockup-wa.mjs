// Buat mockup visual pesan WhatsApp (persis seperti di Saluran WA)
import fs from 'fs';

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Konversi format WhatsApp: *tebal*, _miring_, URL → link biru
function waFormat(text) {
  let t = escHtml(text);
  t = t.replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
  t = t.replace(/_([^_\n]+)_/g, '<i>$1</i>');
  t = t.replace(/(https?:\/\/[^\s<]+)/g, '<span style="color:#53bdeb;text-decoration:underline;word-break:break-all">$1</span>');
  return t.replace(/\n/g, '<br>');
}

const pesanPortal = fs.readFileSync('/tmp/pesan-portal.txt', 'utf8').trim();
const pesanLive = fs.readFileSync('/tmp/pesan-live.txt', 'utf8').trim();

// Foto nyata skenario B (diunduh lewat pipeline thumbnail Google News)
let fotoLiveHtml = '';
if (fs.existsSync('/tmp/foto-live.jpg')) {
  const b64 = fs.readFileSync('/tmp/foto-live.jpg').toString('base64');
  fotoLiveHtml = `<img src="data:image/jpeg;base64,${b64}" alt="Foto berita" style="display:block;width:100%">`;
}

const bubble = (inner, time) => `
  <div style="background:#005c4b;border-radius:12px;overflow:hidden;max-width:420px;box-shadow:0 2px 6px rgba(0,0,0,.35)">
    ${inner}
    <div style="text-align:right;padding:2px 12px 8px;font-size:11px;color:rgba(255,255,255,.55)">${time} ✓✓</div>
  </div>`;

// Placeholder foto berita (Cloudflare memblokir unduhan dari sandbox; di produksi = foto asli berita)
const fotoPlaceholder = `
  <div style="background:linear-gradient(135deg,#1e3a5f 0%,#2b5876 55%,#4e79a7 100%);height:230px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;position:relative">
    <div style="font-size:52px">🏛️</div>
    <div style="color:rgba(255,255,255,.85);font-size:13px;font-weight:600;letter-spacing:.5px">FOTO BERITA DARI PORTAL</div>
    <div style="color:rgba(255,255,255,.5);font-size:11px;padding:0 30px;text-align:center">portal.medan.go.id/images/news/…<br>(terkirim otomatis sebagai lampiran foto)</div>
    <div style="position:absolute;top:10px;right:10px;background:rgba(0,0,0,.4);color:#8fd3f4;font-size:10px;padding:3px 9px;border-radius:10px">PLACEHOLDER — foto asli di produksi</div>
  </div>`;

const html = `<!DOCTYPE html>
<html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pratinjau Pesan Bot → Saluran WhatsApp</title></head>
<body style="margin:0;background:#0b141a;font-family:-apple-system,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;color:#e9edef;padding:24px 16px">

<div style="max-width:520px;margin:0 auto">
  <div style="text-align:center;margin-bottom:22px">
    <div style="font-size:30px;margin-bottom:6px">📢</div>
    <h1 style="font-size:19px;margin:0 0 4px">Saluran WhatsApp — Info Kecamatan Medan Johor</h1>
    <div style="color:#8696a0;font-size:13px">Inilah yang diterima warga saat ada berita baru di portal.medan.go.id</div>
  </div>

  <!-- ── SKENARIO A ── -->
  <div style="background:#182034;border:1px solid #2a3942;border-radius:10px;padding:12px 14px;margin-bottom:14px">
    <b style="color:#7ae0a3;font-size:13px">SKENARIO A — Scraping portal langsung BERHASIL</b>
    <div style="color:#8696a0;font-size:12px;margin-top:3px">Pesan terkirim = <b style="color:#d1d7db">FOTO berita + caption lengkap</b> (judul, tanggal, kategori, ringkasan, tautan)</div>
  </div>
  <div style="display:flex;flex-direction:column;align-items:flex-end;margin-bottom:30px">
    ${bubble(fotoPlaceholder + `<div style="padding:10px 12px 4px;font-size:14.2px;line-height:1.42">${waFormat(pesanPortal)}</div>`, '15:34')}
  </div>

  <!-- ── SKENARIO B ── -->
  <div style="background:#332d1c;border:1px solid #5a4d2a;border-radius:10px;padding:12px 14px;margin-bottom:14px">
    <b style="color:#f5c869;font-size:13px">SKENARIO B — Portal diblokir Cloudflare → pakai Google News RSS</b>
    <div style="color:#8696a0;font-size:12px;margin-top:3px">Pesan terkirim = <b style="color:#d1d7db">FOTO berita + caption</b> — foto diambil dari thumbnail Google News (file asli resolusi penuh dari situs penerbit), tautan langsung ke artikel /berita/ portal. Ini data NYATA berita hari ini.</div>
  </div>
  <div style="display:flex;flex-direction:column;align-items:flex-end;margin-bottom:26px">
    ${bubble(fotoLiveHtml + `<div style="padding:10px 12px 4px;font-size:14.2px;line-height:1.42">${waFormat(pesanLive)}</div>`, '15:41')}
  </div>

  <div style="background:#182229;border-radius:10px;padding:14px 16px;font-size:12.5px;color:#8696a0;line-height:1.7">
    <b style="color:#d1d7db">Keterangan:</b><br>
    • Skenario A terjadi bila IP server lolos pemeriksaan Cloudflare.<br>
    • Skenario B: berita tetap terkirim <b style="color:#d1d7db">dengan foto</b> meski portal memblokir — foto berasal dari cache Google (thumbnail berkualitas asli situs penerbit).<br>
    • Jika foto gagal diunduh, bot otomatis mundur ke pesan teks saja.<br>
    • Berita yang sudah terkirim dicatat di Supabase → <b style="color:#d1d7db">tidak akan dikirim dua kali</b>.
  </div>
</div>
</body></html>`;

fs.writeFileSync('/home/user/HALLOJOHORFIX/pratinjau-pesan-berita.html', html);
console.log('✅ Mockup tersimpan: pratinjau-pesan-berita.html');
