// Berita Pemko Medan dari https://portal.medan.go.id/berita/
// Dua sumber otomatis:
//   1) Scraping langsung portal (lengkap: judul, tanggal, kategori, ringkasan, foto)
//   2) Google News RSS (fallback jika portal memblokir bot lewat Cloudflare)

import { load } from 'cheerio';
import axios from 'axios';
import { queueBroadcast, getPostedBeritaIds, markBeritaPosted } from './store.js';
import logger from './logger.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
export const PORTAL_BERITA_URL = 'https://portal.medan.go.id/berita/';
export const PORTAL_BASE = 'https://portal.medan.go.id';
// Query dibatasi path /berita agar tautan selalu artikel teks, bukan /galeri-foto/
const GNEWS_Q = 'site:portal.medan.go.id/berita';
export const GNEWS_RSS_URL = 'https://news.google.com/rss/search?q=' + encodeURIComponent(GNEWS_Q) + '&hl=id&gl=ID&ceid=ID:id';
const GNEWS_SEARCH_PAGE = 'https://news.google.com/search?q=' + encodeURIComponent(GNEWS_Q) + '&hl=id&gl=ID&ceid=ID:id';
const GNEWS_SEARCH_RSS = (q) => 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=id&gl=ID&ceid=ID:id';

const BULAN_ID = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
  juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
};
const HARI_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN_NAMA = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function norm(s) {
  return (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/** "Rabu, 05 Agustus 2026, 15:34:22" → Date (dianggap WIB, disimpan netral) */
export function parseTanggalPortal(str) {
  const m = norm(str).match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:[,\s]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?/);
  if (!m) return null;
  const bln = BULAN_ID[(m[2] || '').toLowerCase()];
  if (!bln) return null;
  // Simpan sebagai UTC+7 offset eksplisit agar aman meski server bukan WIB
  const hh = m[4] || '00', mm = m[5] || '00', ss = m[6] || '00';
  const iso = `${m[3]}-${String(bln).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}T${hh.padStart(2, '0')}:${mm}:${ss}+07:00`;
  const d = new Date(iso);
  return isNaN(d) ? null : d;
}

/** Date → "Rabu, 05 Agustus 2026, 15:34 WIB" (displays always in Asia/Jakarta) */
export function formatTanggalWib(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', weekday: 'long', day: '2-digit', month: 'numeric',
    year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  return `${HARI_ID_ID(parts.weekday)}, ${parts.day} ${BULAN_NAMA[parseInt(parts.month, 10)]} ${parts.year}, ${parts.hour}:${parts.minute} WIB`;
}

function HARI_ID_ID(enWeekday) {
  const map = { Sunday: 'Minggu', Monday: 'Senin', Tuesday: 'Selasa', Wednesday: 'Rabu', Thursday: 'Kamis', Friday: 'Jumat', Saturday: 'Sabtu' };
  return map[enWeekday] || enWeekday || '';
}

function absolutize(src) {
  if (!src) return '';
  if (src.startsWith('http')) return src;
  if (src.startsWith('//')) return 'https:' + src;
  if (src.startsWith('/')) return PORTAL_BASE + src;
  return PORTAL_BASE + '/' + src;
}

// ─── Sumber 1: Scraping langsung portal ──────────────────
export async function scrapeBeritaPortal(url = PORTAL_BERITA_URL) {
  let res;
  try {
    res = await axios.get(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
      },
      timeout: 20000,
      maxRedirects: 5,
      validateStatus: () => true,
    });
  } catch (err) {
    throw new Error(`Portal tidak dapat dihubungi: ${err.message}`);
  }

  const html = typeof res.data === 'string' ? res.data : '';
  if (res.status !== 200 || /Just a moment|challenge-platform|Performing security verification/i.test(html)) {
    throw new Error(`PORTAL_BLOCKED: Cloudflare menolak request (HTTP ${res.status})`);
  }

  const $ = load(html);
  const byId = new Map();

  // Semua link artikel berpola …__read<ID>.html
  $("a[href*='__read']").each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    const mId = href.match(/__read(\d+)/);
    if (!mId) return;
    const id = `p:${mId[1]}`;
    const it = byId.get(id) || { id, judul: '', url: absolutize(href), gambarUrl: '', el: null };

    const img = $a.find('img').first();
    if (img.length && !it.gambarUrl) it.gambarUrl = absolutize(img.attr('src') || img.attr('data-src') || '');

    const text = norm($a.text());
    if (text.length > (it.judul || '').length && !/baca selengkapnya/i.test(text)) {
      // Judul biasanya ada di heading; ambil teks heading bila ada
      const heading = norm($a.find('h1,h2,h3,h4,h5').first().text());
      it.judul = heading.length > 8 ? heading : text;
    }
    if (!it.el) it.el = el;
    byId.set(id, it);
  });

  // Lengkapi tanggal / kategori / ringkasan dari kontainer terdekat
  const RE_TGL = /\d{1,2}\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+\d{4}/i;
  const RE_TGL_FULL = /(?:Senin|Selasa|Rabu|Kamis|Jumat|Sabtu|Minggu)?\s*,?\s*\d{1,2}\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+\d{4}(?:[,\s]+\d{1,2}[:.]\d{2}(?:[:.]\d{2})?)?/i;
  for (const it of byId.values()) {
    let container = null;
    let $cur = $(it.el);
    for (let up = 0; up < 5 && $cur.length; up++) {
      const $parent = $cur.parent();
      if (!$parent.length) break;
      if (RE_TGL.test($parent.text())) { container = $parent; break; }
      $cur = $parent;
    }
    it.tanggal = null;
    it.kategori = '';
    it.ringkasan = '';
    if (container) {
      const tglStr = container.text().match(RE_TGL_FULL)?.[0] || '';
      it.tanggal = parseTanggalPortal(tglStr);
      const $kat = container.find("a[href*='berita-kategori']").first();
      if ($kat.length) it.kategori = norm($kat.text());
      // Ringkasan: teks kontainer minus judul, minus baris meta
      let body = norm(container.text());
      if (it.judul) body = body.replace(it.judul, ' ');
      body = body.replace(/baca selengkapnya.*/i, ' ');
      body = body.replace(RE_TGL_FULL, ' ');
      body = body.replace(/dibaca\s*\d+\s*kali/i, ' ');
      if (it.kategori) body = body.replace(it.kategori, ' '); // hanya kemunculan pertama (= label meta)
      it.ringkasan = norm(body).slice(0, 280);
    }
  }

  const items = [...byId.values()]
    .filter(it => it.judul && it.judul.length > 8)
    .map(it => ({ ...it, tanggalWib: it.tanggal ? formatTanggalWib(it.tanggal) : '' }))
    .slice(0, 12);

  if (!items.length) throw new Error('Parser portal: tidak ada artikel berpola __read ditemukan (layout berubah?)');
  items.forEach(it => delete it.el);
  return { source: 'portal-medan.go.id', fetchedAt: new Date().toISOString(), items };
}

// ─── Sumber 2: Google News RSS (fallback) ────────────────
/**
 * Pecahkan URL redirect Google News (news.google.com/rss/articles/…) menjadi
 * URL asli di portal.medan.go.id, agar warga bisa klik langsung ke artikel.
 * Teknik: ambil halaman artikel Google → baca properti garturlreq di <c-wiz data-p>
 * → panggil RPC batchexecute (Fbv4je) → respons berisi URL asli.
 * Gagal → kembalikan null (pesan tetap terkirim memakai link Google).
 */
export async function decodeGoogleNewsUrl(googleUrl) {
  const res = await axios.get(googleUrl, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8' },
    timeout: 20000,
    maxRedirects: 5,
    validateStatus: () => true,
  });
  if (res.status !== 200 || typeof res.data !== 'string') {
    throw new Error(`Halaman Google News HTTP ${res.status}`);
  }
  const m = res.data.match(/<c-wiz[^>]*data-p="([^"]+)"/);
  if (!m) throw new Error('Properti data-p tidak ditemukan (format Google berubah?)');
  const obj = JSON.parse(m[1].replace(/&quot;/g, '"').replace('%.@.', '["garturlreq",'));
  const inner = [...obj.slice(0, -6), ...obj.slice(-2)];
  const outer = [[['Fbv4je', JSON.stringify(inner), 'null', 'generic']]];

  const post = await axios.post(
    'https://news.google.com/_/DotsSplashUi/data/batchexecute',
    new URLSearchParams({ 'f.req': JSON.stringify(outer) }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': UA,
        Referer: 'https://news.google.com/',
      },
      timeout: 20000,
      validateStatus: () => true,
    }
  );
  if (post.status !== 200) throw new Error(`batchexecute HTTP ${post.status}`);
  const arr = JSON.parse(String(post.data).replace(/^\)\]\}'/, '').trim());
  const innerResp = JSON.parse(arr[0][2]);
  const realUrl = Array.isArray(innerResp) ? innerResp[1] : innerResp;
  if (!realUrl || !/^https?:\/\//.test(realUrl)) throw new Error('URL hasil decode tidak valid');
  return realUrl;
}

const RE_GOOGLE_NEWS = /\/\/news\.google\.com\//;

/** Parse RSS Google News → array item {judul, url}; dipakai untuk pencarian judul. */
async function fetchGoogleNewsItems(rssUrl) {
  const res = await axios.get(rssUrl, {
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml,application/xml,text/xml,*/*' },
    timeout: 20000,
    validateStatus: () => true,
  });
  if (res.status !== 200 || typeof res.data !== 'string' || !res.data.includes('<item>')) return [];
  const $ = load(res.data, { xmlMode: true });
  const items = [];
  $('item').each((_, el) => {
    const $it = $(el);
    const judul = norm($it.find('title').first().text()).replace(/\s*-\s*portal\.medan\.go\.id\s*$/i, '');
    const url = norm($it.find('link').first().text());
    if (judul && url) items.push({ judul, url });
  });
  return items;
}

/**
 * Cari URL /berita/ di portal berdasarkan judul persis.
 * Dipakai saat decode Google mengarah ke /galeri-foto/ (twin artikel yang salah).
 */
export async function cariUrlBeritaBerdasarkanJudul(judul) {
  try {
    const items = await fetchGoogleNewsItems(GNEWS_SEARCH_RSS(`"${judul}" site:portal.medan.go.id/berita`));
    for (const it of items.slice(0, 3)) {
      try {
        const real = await decodeGoogleNewsUrl(it.url);
        if (real && real.includes('/berita/')) return real;
      } catch { /* coba kandidat berikutnya */ }
    }
  } catch { /* diamkan */ }
  return null;
}

/** Ganti link Google dengan link portal asli bila bisa; gagal → link semula. */
export async function resolveRealUrl(url, judul = '') {
  if (!url || !RE_GOOGLE_NEWS.test(url)) return url;
  try {
    let real = await decodeGoogleNewsUrl(url);
    // Jika decode mengarah ke galeri-foto (versi foto, bukan artikel teks),
    // cari versi /berita/-nya lewat pencarian judul persis.
    if (real && real.includes('/galeri-foto/') && judul) {
      const versiBerita = await cariUrlBeritaBerdasarkanJudul(judul);
      if (versiBerita) real = versiBerita;
    }
    return real || url;
  } catch {
    return url;
  }
}

// ─── Thumbnail berita dari Google News (untuk foto pesan) ─
// Halaman hasil pencarian Google News memuat thumbnail artikel via
// news.google.com/api/attachments/{token} → 302 → encrypted-tbn.gstatic.com.
// Pemetaan lewat JUDUL: setiap kartu punya judul di <a class="JtKRv">
// dan thumbnail di <img class="Quavad"> pada kontainer yang sama.
export async function ambilPetaThumbnailGNews() {
  const peta = new Map();
  try {
    const res = await axios.get(GNEWS_SEARCH_PAGE, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8' },
      timeout: 25000,
      validateStatus: () => true,
    });
    if (res.status !== 200 || typeof res.data !== 'string') return peta;
    const $ = load(res.data);
    $('a.JtKRv').each((_, a) => {
      const judul = norm($(a).text());
      if (judul.length < 10 || peta.has(judul)) return;
      // Cari thumbnail dalam kontainer kartu yang sama
      let $cur = $(a);
      for (let up = 0; up < 10 && $cur.length; up++) {
        const $p = $cur.parent();
        if (!$p.length) break;
        const $img = $p.find('img.Quavad').first();
        if ($img.length) {
          let thumb = $img.attr('src') || '';
          const m2 = ($img.attr('srcset') || '').match(/([^\s,]+)\s+2x/);
          if (m2) thumb = m2[1];
          if (thumb) {
            if (thumb.startsWith('/')) thumb = 'https://news.google.com' + thumb;
            peta.set(judul, thumb);
          }
          return;
        }
        $cur = $p;
      }
    });
  } catch { /* halaman pencarian gagal → tanpa foto */ }
  return peta;
}

/**
 * Attachment Google News mengembalikan thumbnail webp kecil; URL tujuan redirect
 * (gstatic) tanpa parameter fopt = file ASLI (jpeg) dari situs penerbit.
 * Kembalikan URL asli tersebut; gagal → null.
 */
export async function resolveThumbnailAsli(attachmentUrl) {
  try {
    const res = await axios.get(attachmentUrl, {
      headers: { 'User-Agent': UA },
      timeout: 20000,
      maxRedirects: 0,
      validateStatus: s => s === 301 || s === 302 || s === 200,
    });
    const loc = res.headers.location;
    if (loc && loc.includes('gstatic.com/images')) {
      return loc.replace(/&fopt=.*$/, '');
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchBeritaGoogleNews() {
  let res;
  try {
    res = await axios.get(GNEWS_RSS_URL, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml,application/xml,text/xml,*/*' },
      timeout: 20000,
      validateStatus: () => true,
    });
  } catch (err) {
    throw new Error(`Google News tidak dapat dihubungi: ${err.message}`);
  }
  if (res.status !== 200 || typeof res.data !== 'string' || !res.data.includes('<item>')) {
    throw new Error(`Google News RSS tidak valid (HTTP ${res.status})`);
  }

  const $ = load(res.data, { xmlMode: true });
  const items = [];
  $('item').each((_, el) => {
    const $it = $(el);
    const guid = norm($it.find('guid').first().text());
    let judul = norm($it.find('title').first().text());
    judul = judul.replace(/\s*-\s*portal\.medan\.go\.id\s*$/i, '');
    const url = norm($it.find('link').first().text());
    const pub = norm($it.find('pubDate').first().text());
    const tanggal = pub ? new Date(pub) : null;
    if (!guid || !judul) return;
    items.push({
      id: `g:${guid}`,
      judul,
      url,
      gambarUrl: '',
      kategori: 'Kota Medan',
      ringkasan: '',
      tanggal: tanggal && !isNaN(tanggal) ? tanggal : null,
      tanggalWib: tanggal && !isNaN(tanggal) ? formatTanggalWib(tanggal) : '',
    });
  });

  items.sort((a, b) => (b.tanggal?.getTime() || 0) - (a.tanggal?.getTime() || 0));
  if (!items.length) throw new Error('Google News RSS: tidak ada item untuk portal.medan.go.id');

  // Lampirkan thumbnail dari halaman pencarian Google News (pencocokan via judul)
  const petaThumb = await ambilPetaThumbnailGNews();
  for (const it of items) {
    const thumb = petaThumb.get(norm(it.judul));
    if (thumb) it.thumbAttachmentUrl = thumb;
  }

  return { source: 'google-news-rss', fetchedAt: new Date().toISOString(), items: items.slice(0, 12) };
}

/** Ambil berita terbaru: coba portal langsung, otomatis fallback ke Google News RSS. */
export async function getBeritaTerbaru() {
  try {
    return await scrapeBeritaPortal();
  } catch (errPortal) {
    const fallback = await fetchBeritaGoogleNews().catch(errG => {
      throw new Error(`${errPortal.message} | Fallback Google News juga gagal: ${errG.message}`);
    });
    return { ...fallback, note: `Portal langsung diblokir (${errPortal.message}). Memakai Google News RSS.` };
  }
}

// ─── Format pesan WhatsApp ────────────────────────────────
export function formatBeritaWhatsApp(item) {
  let t = '';
  t += `📰 *BERITA TERKINI — PEMKO MEDAN*\n`;
  t += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  t += `*${item.judul}*\n\n`;
  const meta = [];
  if (item.tanggalWib) meta.push(`🗓️ ${item.tanggalWib}`);
  if (item.kategori) meta.push(`🏷️ ${item.kategori}`);
  if (meta.length) t += meta.join('  ·  ') + '\n\n';
  if (item.ringkasan) t += `${item.ringkasan}…\n\n`;
  t += `🔗 Baca selengkapnya:\n${item.url}\n\n`;
  t += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  t += `_Sumber: Portal Resmi Pemko Medan_\n`;
  t += `🏙️ *#MEDANUNTUKSEMUA* — *Hallo Johor*`;
  return t;
}

/** Unduh gambar berita untuk dikirim sebagai lampiran. Gagal → teks saja. */
export async function downloadGambarBerita(url) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 25000,
    headers: { 'User-Agent': UA, Accept: 'image/*,*/*' },
    maxContentLength: 12 * 1024 * 1024,
    validateStatus: () => true,
  });
  if (res.status !== 200 || !res.data || !res.data.length) {
    throw new Error(`Gambar gagal diunduh (HTTP ${res.status})`);
  }
  const mime = (res.headers['content-type'] || 'image/jpeg').split(';')[0].trim();
  return { buffer: Buffer.from(res.data), mime };
}

// ─── Helper bersama: cek berita baru lalu antrekan broadcast ─
// Dipakai oleh penjadwal (index.js) dan tombol manual dashboard (web.js).
// Riwayat kirim disimpan di Supabase (tabel berita_posted) agar tidak dobel.
export async function antrekanBeritaBaru({ channelJid, forceLatest = false, maxKirim = 3 } = {}) {
  channelJid = (channelJid || '').trim();
  if (!channelJid) throw new Error('Saluran tujuan belum dipilih.');

  const hasil = await getBeritaTerbaru();
  const postedIds = new Set(await getPostedBeritaIds());

  let kandidat;
  if (forceLatest) {
    kandidat = hasil.items.slice(0, 1); // kirim yang paling baru apa pun riwayatnya
  } else {
    // Baru = belum pernah dikirim; urut lama→baru agar saluran menerima kronologis
    kandidat = hasil.items.filter(it => !postedIds.has(it.id)).reverse().slice(0, maxKirim);
  }

  for (const it of kandidat) {
    // Pecahkan link Google → link portal asli (versi /berita/) supaya warga klik langsung ke artikel
    it.url = await resolveRealUrl(it.url, it.judul);
    // Jika belum ada foto dari sumber utama, coba thumbnail Google News → file asli (jpeg)
    if (!it.gambarUrl && it.thumbAttachmentUrl) {
      it.gambarUrl = await resolveThumbnailAsli(it.thumbAttachmentUrl) || '';
    }
    const pesan = formatBeritaWhatsApp(it).trim();
    await queueBroadcast({
      channelJid,
      pesan,
      mediaUrl: it.gambarUrl || null,
      mediaMime: 'image/jpeg',
      sumber: `berita-auto/${hasil.source}`,
    });
    await markBeritaPosted(it.id, it.judul, it.url);
    logger.success('BERITA', `Berita diantrekan → ${channelJid}`, `${it.id} · ${it.judul.substring(0, 50)}`);
    await new Promise(r => setTimeout(r, 800));
  }

  return { source: hasil.source, note: hasil.note || null, fetched: hasil.items.length, queued: kandidat.length, items: kandidat };
}
