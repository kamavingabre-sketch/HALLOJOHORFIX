# 📰 Fitur Baru: Berita Otomatis — Portal Pemko Medan

Bot sekarang bisa memantau **https://portal.medan.go.id/berita/** dan mengirim berita baru
secara otomatis ke saluran WhatsApp yang dipilih di dashboard.

## Cara Kerja

1. **Penjadwal** di bot (`index.js`) memeriksa halaman berita setiap N menit
   (interval diatur di dashboard, default 30 menit).
2. Berita dianalisis: judul, tanggal, kategori, ringkasan, foto, dan tautan.
3. Berita yang **belum pernah dikirim** dideteksi lewat tabel `berita_posted` (Supabase)
   → antri ke broadcast worker → terkirim ke saluran sebagai foto + caption
   (otomatis teks-saja kalau foto gagal diunduh).
4. Maksimal **3 berita per siklus** agar tidak dianggap spam; urutan lama → baru.

## Sumber Ganda (Otomatis)

| Sumber | Isi | Kapan dipakai |
|--------|-----|---------------|
| **Portal langsung** (scraping) | Lengkap + foto portal | Default |
| **Google News RSS** | Judul, tanggal, tautan **+ foto berita** | Fallback otomatis jika portal diblokir Cloudflare dari server |

> 📷 **Foto tetap terkirim di mode fallback.** Thumbnail berita diambil dari halaman
> pencarian Google News (dipetakan per judul), lalu di-resolve ke file gambar **asli (JPEG)**
> dari situs penerbit lewat cache `gstatic.com` Google — bebas blokir Cloudflare.

> ℹ️ `portal.medan.go.id` dilindungi Cloudflare. Jika IP server Railway Anda diblokir,
> bot otomatis memakai Google News RSS — berita tetap terkirim tanpa campur tangan Anda.
> Sumber yang dipakai selalu tercatat di dashboard ("Sumber terakhir").
>
> 🔗 **Tautan selalu menuju artikel /berita/ di portal.** Link Google News
> (`news.google.com/rss/articles/…`) otomatis dipecahkan (decode) menjadi URL artikel asli
> `portal.medan.go.id/berita/…` sebelum dikirim. Jika decode mengarah ke `/galeri-foto/`
> (kembaran galeri foto sebuah berita), bot mencari ulang versi `/berita/` berdasarkan
> judul persis. Cadangan terakhir: link Google (pesan tetap terkirim).

## Langkah Aktivasi (Wajib)

1. **Jalankan ulang `supabase_schema.sql`** di Supabase SQL Editor
   (menambah tabel `berita_auto_schedule` + `berita_posted`; aman dijalankan berulang).
2. Push kode ke GitHub → Railway auto-deploy:
   ```bash
   git add .
   git commit -m "feat: berita otomatis portal.medan.go.id → saluran WA"
   git push
   ```
3. Buka **Dashboard → Broadcast Saluran → 📰 Berita Otomatis — Portal Pemko Medan**:
   - Pilih **saluran berita** (daftarkan dulu di "Daftarkan Saluran WhatsApp" bila belum ada)
   - Pilih interval: **15 / 30 / 60 … menit**
   - Centang **"Kirim otomatis berita baru ke saluran di atas"**
   - Klik **💾 Simpan pengaturan**
4. Uji dulu dengan **🔍 Cek berita sekarang** (lihat daftar berita terbaru tanpa mengirim)
   dan **📤 Kirim berita terbaru sekarang** (kirim 1 berita terbaru sebagai tes end-to-end).

## Tombol di Dashboard

| Tombol | Fungsi |
|--------|--------|
| 💾 Simpan pengaturan | Simpan saluran, interval, dan status aktif |
| 🔍 Cek berita sekarang | Ambil daftar berita terbaru; tandai mana yang *baru* / *sudah terkirim* |
| 📤 Kirim berita terbaru sekarang | Langsung kirim 1 berita paling baru (mengabaikan riwayat — untuk tes) |
| ♻️ Reset riwayat kirim | Hapus tabel `berita_posted`; berita lama bisa dikirim ulang |

## File yang Berubah

| File | Perubahan |
|------|-----------|
| `berita-medan.js` | **BARU** — scraper portal + Google News RSS + formatter WA + helper antrian |
| `index.js` | Penjadwal berita (`startBeritaScheduler`); broadcast worker kini mendukung `mediaUrl` (unduh foto dari URL) |
| `web.js` | Section UI baru + 5 endpoint API `/api/berita/*` |
| `store.js` | Fungsi config & riwayat berita; polyfill WebSocket untuk Node < 22 |
| `supabase_schema.sql` | + tabel `berita_auto_schedule`, `berita_posted` |
| `package.json` | + dependency `ws` (fallback Node < 22) |
| `test-berita.mjs` | **BARU** — harness uji: `node test-berita.mjs` (22 tes) |

## Catatan Teknis

- **Anti-duplikat:** ID berita portal = nomor artikel (`p:6470`); ID Google = GUID RSS (`g:...`).
  Jika sumber berpindah (portal ↔ google), berita yang sama bisa terkirim sekali lagi —
  hal ini wajar dan hanya terjadi saat transisi sumber.
- **Interval minimum** 5 menit (clamp di server), maksimum 1440 menit (24 jam).
- Pesan WhatsApp berformat: header 📰, judul tebal, tanggal WIB + kategori, ringkasan,
  tautan "Baca selengkapnya", footer khas Hallo Johor.
