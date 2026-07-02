// ═══════════════════════════════════════════════════════════
//   IVA TEST SKRINING — Flow Handler
//   Import fungsi ini ke handler.js
// ═══════════════════════════════════════════════════════════
//
// CARA PAKAI di handler.js:
//   import { handleIvaFlow, buildIvaMenu } from './iva-flow.js';
//
// Di bagian session dispatch (sebelum switch textMsg), tambahkan:
//   if (session?.flow === 'iva') {
//     await handleIvaFlow(sock, senderJid, pushName, session, textMsg);
//     return;
//   }
//
// Di switch case, tambahkan case baru (mis. '13' atau 'iva'):
//   case 'iva': case 'IVA':
//     clearSession(senderJid);
//     setSession(senderJid, { flow: 'iva', step: 'q1', skor: 0, jawaban: {} });
//     await sendText(sock, senderJid, buildIvaMenu());
//     break;
//
// ═══════════════════════════════════════════════════════════

import { setSession, clearSession, saveIvaResult } from './store.js';

// ── Pertanyaan skrining ──────────────────────────────────
// Setiap pertanyaan punya bobot skor jika jawaban berisiko.
// Skor total → 0–3 = rendah, 4–6 = sedang, 7+ = tinggi
export const IVA_PERTANYAAN = [
  {
    id: 'q1',
    next: 'q2',
    teks: '1️⃣ *Berapa usia Anda saat ini?*\n\n1 — Di bawah 25 tahun\n2 — 25–35 tahun\n3 — 36–50 tahun\n4 — Di atas 50 tahun',
    pilihan: {
      '1': { label: '< 25 tahun',   skor: 0, field: 'usia_grup' },
      '2': { label: '25–35 tahun',  skor: 1, field: 'usia_grup' },
      '3': { label: '36–50 tahun',  skor: 2, field: 'usia_grup' },
      '4': { label: '> 50 tahun',   skor: 1, field: 'usia_grup' },
    },
  },
  {
    id: 'q2',
    next: 'q3',
    teks: '2️⃣ *Apakah Anda sudah/pernah menikah?*\n\n1 — Belum pernah menikah\n2 — Sudah/pernah menikah',
    pilihan: {
      '1': { label: 'Belum menikah',      skor: 0, field: 'status_nikah' },
      '2': { label: 'Sudah/pernah menikah', skor: 1, field: 'status_nikah' },
    },
  },
  {
    id: 'q3',
    next: 'q4',
    teks: '3️⃣ *Berapa kali Anda pernah menikah / berganti pasangan?*\n\n1 — Tidak pernah / 1 kali\n2 — 2 kali\n3 — 3 kali atau lebih',
    pilihan: {
      '1': { label: '1 kali',          skor: 0, field: 'jml_pasangan' },
      '2': { label: '2 kali',          skor: 1, field: 'jml_pasangan' },
      '3': { label: '3 kali atau lebih', skor: 2, field: 'jml_pasangan' },
    },
  },
  {
    id: 'q4',
    next: 'q5',
    teks: '4️⃣ *Apakah Anda pernah mengalami keputihan yang berbau atau tidak normal?*\n\n1 — Tidak pernah\n2 — Kadang-kadang\n3 — Sering / terus-menerus',
    pilihan: {
      '1': { label: 'Tidak pernah',        skor: 0, field: 'keputihan' },
      '2': { label: 'Kadang-kadang',       skor: 1, field: 'keputihan' },
      '3': { label: 'Sering/terus-menerus', skor: 2, field: 'keputihan' },
    },
  },
  {
    id: 'q5',
    next: 'q6',
    teks: '5️⃣ *Apakah Anda pernah mengalami perdarahan di luar haid atau setelah berhubungan?*\n\n1 — Tidak pernah\n2 — Pernah 1–2 kali\n3 — Sering terjadi',
    pilihan: {
      '1': { label: 'Tidak pernah',  skor: 0, field: 'perdarahan' },
      '2': { label: 'Pernah 1–2 kali', skor: 2, field: 'perdarahan' },
      '3': { label: 'Sering terjadi', skor: 3, field: 'perdarahan' },
    },
  },
  {
    id: 'q6',
    next: 'q7',
    teks: '6️⃣ *Apakah Anda atau pasangan Anda merokok?*\n\n1 — Tidak\n2 — Pasangan yang merokok\n3 — Saya sendiri merokok',
    pilihan: {
      '1': { label: 'Tidak',                   skor: 0, field: 'rokok' },
      '2': { label: 'Pasangan merokok',        skor: 1, field: 'rokok' },
      '3': { label: 'Saya sendiri merokok',    skor: 1, field: 'rokok' },
    },
  },
  {
    id: 'q7',
    next: null, // pertanyaan terakhir
    teks: '7️⃣ *Kapan terakhir kali Anda melakukan pemeriksaan IVA Test atau Pap Smear?*\n\n1 — Pernah, dalam 1 tahun terakhir\n2 — Pernah, lebih dari 1 tahun lalu\n3 — Belum pernah sama sekali',
    pilihan: {
      '1': { label: 'Dalam 1 tahun terakhir', skor: 0, field: 'riwayat_tes' },
      '2': { label: 'Lebih dari 1 tahun lalu', skor: 1, field: 'riwayat_tes' },
      '3': { label: 'Belum pernah',            skor: 2, field: 'riwayat_tes' },
    },
  },
];

// ── Hitung level risiko dari total skor ─────────────────
const hitungRisiko = (skor) => {
  if (skor <= 3) return 'rendah';
  if (skor <= 6) return 'sedang';
  return 'tinggi';
};

// ── Pesan hasil berdasarkan risiko ──────────────────────
const pesanHasil = (risiko, skor) => {
  const totalMax = 12;
  const bar = Math.round((skor / totalMax) * 10);
  const barStr = '🟥'.repeat(bar) + '⬜'.repeat(10 - bar);

  if (risiko === 'rendah') {
    return (
      `✅ *HASIL SKRINING IVA TEST*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Tingkat Risiko: *🟢 RENDAH*\n` +
      `Skor: ${skor}/${totalMax}\n` +
      `${barStr}\n\n` +
      `Berdasarkan jawaban Anda, faktor risiko kanker serviks Anda *saat ini tergolong rendah*.\n\n` +
      `📌 *Saran:*\n` +
      `• Tetap lakukan IVA Test secara rutin setiap *3–5 tahun sekali*\n` +
      `• Jaga pola hidup sehat dan hindari merokok\n` +
      `• Kunjungi Puskesmas terdekat untuk informasi lebih lanjut\n\n` +
      `🏥 *Lokasi Puskesmas:*\n` +
      `› Puskesmas UPT Medan Johor\n` +
      `› Puskesmas Gedung Johor\n\n` +
      `_Skrining ini bukan diagnosis medis. Konsultasikan ke tenaga kesehatan untuk kepastian._\n\n` +
      `Ketik *menu* untuk kembali ke menu utama.`
    );
  }

  if (risiko === 'sedang') {
    return (
      `⚠️ *HASIL SKRINING IVA TEST*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Tingkat Risiko: *🟡 SEDANG*\n` +
      `Skor: ${skor}/${totalMax}\n` +
      `${barStr}\n\n` +
      `Berdasarkan jawaban Anda, terdapat *beberapa faktor risiko* yang perlu diperhatikan.\n\n` +
      `📌 *Saran:*\n` +
      `• *Segera jadwalkan IVA Test* di Puskesmas terdekat\n` +
      `• IVA Test *gratis* untuk peserta JKN/BPJS\n` +
      `• Jangan tunda — deteksi dini sangat penting!\n\n` +
      `🏥 *Daftar di Puskesmas:*\n` +
      `› Puskesmas UPT Medan Johor\n` +
      `  📞 Hubungi di jam kerja untuk jadwal\n` +
      `› Puskesmas Gedung Johor\n\n` +
      `_Skrining ini bukan diagnosis medis. Konsultasikan ke tenaga kesehatan untuk kepastian._\n\n` +
      `Ketik *menu* untuk kembali ke menu utama.`
    );
  }

  // tinggi
  return (
    `🚨 *HASIL SKRINING IVA TEST*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `Tingkat Risiko: *🔴 TINGGI*\n` +
    `Skor: ${skor}/${totalMax}\n` +
    `${barStr}\n\n` +
    `Berdasarkan jawaban Anda, terdapat *faktor risiko tinggi* yang memerlukan perhatian segera.\n\n` +
    `📌 *Tindakan yang Disarankan:*\n` +
    `• *Segera kunjungi Puskesmas* atau dokter kandungan\n` +
    `• Minta pemeriksaan IVA Test atau Pap Smear\n` +
    `• Jangan panik — deteksi dini sangat bisa ditangani\n\n` +
    `🏥 *Puskesmas Terdekat:*\n` +
    `› Puskesmas UPT Medan Johor\n` +
    `  📞 Hubungi di jam kerja untuk pendaftaran\n` +
    `› Puskesmas Gedung Johor\n\n` +
    `⚠️ _Ini adalah skrining awal, bukan diagnosis. Pemeriksaan langsung oleh tenaga medis tetap diperlukan._\n\n` +
    `Ketik *menu* untuk kembali ke menu utama.`
  );
};

// ── Menu intro ───────────────────────────────────────────
export const buildIvaMenu = () =>
  `🎗️ *SKRINING IVA TEST — DETEKSI DINI KANKER SERVIKS*\n` +
  `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
  `Layanan ini membantu Anda mengetahui *tingkat risiko* kanker serviks berdasarkan faktor-faktor umum.\n\n` +
  `📋 Terdiri dari *7 pertanyaan singkat*\n` +
  `⏱️ Selesai dalam ±2 menit\n` +
  `🔒 Data Anda disimpan secara rahasia\n\n` +
  `_Skrining ini bukan pengganti pemeriksaan medis langsung._\n\n` +
  `Ketik *0* kapan saja untuk membatalkan.\n\n` +
  `━━━━━━━━━━━━━━━━━━━━━━━\n` +
  IVA_PERTANYAAN[0].teks +
  `\n\nKetik angka pilihan Anda (1/2/3/4):`;

// ── Flow handler utama ───────────────────────────────────
export const handleIvaFlow = async (sock, jid, name, session, textMsg, sendText) => {
  const step = session.step;

  // Batal kapan saja
  if (textMsg === '0' || textMsg?.toLowerCase() === 'batal') {
    clearSession(jid);
    await sendText(sock, jid,
      `❌ Skrining IVA dibatalkan.\n\nKetik *menu* untuk kembali ke menu utama.`
    );
    return;
  }

  const pertanyaan = IVA_PERTANYAAN.find(p => p.id === step);
  if (!pertanyaan) {
    clearSession(jid);
    await sendText(sock, jid, `⚠️ Sesi tidak valid. Ketik *menu* untuk mulai ulang.`);
    return;
  }

  const pilihan = pertanyaan.pilihan[textMsg];
  if (!pilihan) {
    const jumlahOpsi = Object.keys(pertanyaan.pilihan).length;
    await sendText(sock, jid,
      `⚠️ Pilihan tidak valid. Ketik angka *1–${jumlahOpsi}*.\n\nAtau ketik *0* untuk batal.`
    );
    return;
  }

  // Simpan jawaban & akumulasi skor
  const jawaban = { ...(session.jawaban || {}), [pilihan.field]: pilihan.label };
  const skor    = (session.skor || 0) + pilihan.skor;
  const nextId  = pertanyaan.next;

  if (nextId) {
    // Lanjut ke pertanyaan berikutnya
    const nextPertanyaan = IVA_PERTANYAAN.find(p => p.id === nextId);
    setSession(jid, { ...session, step: nextId, skor, jawaban });
    await sendText(sock, jid,
      `✅ Jawaban diterima!\n\n` +
      nextPertanyaan.teks +
      `\n\nKetik angka pilihan Anda:`
    );
  } else {
    // Pertanyaan terakhir — hitung hasil
    const risiko = hitungRisiko(skor);
    const hasil  = pesanHasil(risiko, skor);

    // Simpan ke Supabase
    await saveIvaResult({
      waNumber: jid,
      nama:     name,
      skor,
      risiko,
      jawaban,
    });

    clearSession(jid);
    await sendText(sock, jid, hasil);
  }
};
