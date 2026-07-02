# 🗄️ Panduan Setup Supabase — Hallo Johor

## Langkah 1 — Buat Project Supabase

1. Buka https://supabase.com dan login
2. Klik **New project**
3. Isi nama project: `hallo-johor`
4. Pilih region: **Southeast Asia (Singapore)**
5. Buat password database yang kuat, lalu klik **Create project**

---

## Langkah 2 — Jalankan Schema SQL

1. Di dashboard Supabase, buka **SQL Editor** (ikon database di sidebar kiri)
2. Klik **New query**
3. Copy seluruh isi file `supabase_schema.sql`
4. Paste ke editor, lalu klik **Run**
5. Pastikan tidak ada error merah

---

## Langkah 3 — Ambil API Keys

1. Di sidebar kiri, buka **Project Settings → API**
2. Catat dua nilai ini:
   - **Project URL** → ini `SUPABASE_URL`
   - **service_role secret** (bukan anon key!) → ini `SUPABASE_SERVICE_KEY`

> ⚠️ Gunakan `service_role` key, BUKAN `anon` key. Service role key memiliki akses penuh ke database dan diperlukan agar bot bisa menulis data.

---

## Langkah 4 — Set Environment Variables di Railway

1. Buka project Railway kamu
2. Masuk ke tab **Variables**
3. Tambahkan dua variable baru:

```
SUPABASE_URL     = https://xxxxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY = eyJhbGciOi....(service_role key)
```

---

## Langkah 5 — Deploy

Karena `package.json` sudah diupdate dengan `@supabase/supabase-js`, Railway akan otomatis install dependency baru saat deploy.

Push ke GitHub seperti biasa:
```bash
git add .
git commit -m "feat: integrasi Supabase untuk persistensi data"
git push
```

---

## Catatan Penting

### Fungsi yang tetap in-memory (tidak disimpan ke DB)
- `getSession / setSession / clearSession` — sesi percakapan bot bersifat sementara, tidak perlu persisten

### Migrasi data lama
Jika sebelumnya ada data di folder `./data/*.json` yang ingin dipindahkan ke Supabase, bisa dilakukan manual via Supabase Table Editor atau dengan script migrasi khusus.

### Semua fungsi store sekarang async
Karena operasi database bersifat async, pastikan di semua file yang memanggil fungsi store menggunakan `await`. Contoh:

```js
// Sebelum (JSON/sync)
const groups = getLaporanGroups();

// Sekarang (Supabase/async)  
const groups = await getLaporanGroups();
```

File yang perlu dicek: `handler.js`, `web.js`, `web-pages.js`, `web-excel.js`

---

## Struktur Tabel

| Tabel | Data |
|-------|------|
| `laporan_groups` | Grup WhatsApp tujuan forward laporan |
| `laporan_counter` | Counter ID laporan (atomic) |
| `laporan_archive` | Semua laporan masuk |
| `feedback_queue` | Antrian feedback rating |
| `status_notif_queue` | Antrian notifikasi update status |
| `livechat_sessions` | Sesi live chat admin-warga |
| `livechat_replies` | Antrian balasan live chat |
| `group_routing` | Routing kategori → grup |
| `kegiatan` | Info kegiatan kecamatan |
| `broadcast_channels` | Saluran broadcast terdaftar |
| `broadcast_queue` | Antrian dan histori broadcast |
| `weather_broadcast_schedule` | Konfigurasi jadwal cuaca BMKG |
| `umkm_binaan` | Data UMKM binaan kecamatan |
