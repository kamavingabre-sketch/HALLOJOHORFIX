// ╔══════════════════════════════════════════════════════════╗
// ║     WhatsApp Bot - Layanan Kecamatan Medan Johor         ║
// ║     Powered by Baileys v6.5.0 (Stable) + Node.js         ║
// ║     Author: Bot Pelayanan Digital                        ║
// ║     NOTE: Gunakan dengan "node index-v6-cjs.cjs"         ║
// ╚══════════════════════════════════════════════════════════╝

const { 
  useSingleFileAuthState, 
  makeWASocket, 
  DisconnectReason, 
  makeCacheableSignalKeyStore,
  Boom 
} = require('@whiskeysockets/baileys');

const { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } = require('fs');
const { join, dirname } = require('path');
const { fileURLToPath } = require('url');
const { createInterface } = require('readline');
const axios = require('axios');

// Import lokal (harus menggunakan .js extension)
const { handleMessage } = require('./handler.js');
const { 
  getPendingFeedbacks, markFeedbackDone, getPendingLivechatReplies, markLivechatReplyDone, 
  addLivechatMessage, closeLivechatSession, getPendingStatusNotifs, markStatusNotifDone, 
  getPendingBroadcasts, markBroadcastDone, queueBroadcast, getWeatherBroadcastConfig, 
  markWeatherBroadcastSent, getBeritaAutoConfig, markBeritaChecked 
} = require('./store.js');
const { scrapeMedanJohorCuacaHariIni, formatCuacaWhatsApp } = require('./bmkg-cuaca.js');
const { antrekanBeritaBaru } = require('./berita-medan.js');
const logger = require('./logger.js');

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Configuration ────────────────────────────────────────
const CONFIG = {
  AUTH_DIR: './auth_info_baileys',
  RECONNECT_DELAY: 5000,
  PAIRING_TIMEOUT: 120,
  MAX_RECONNECT_ATTEMPTS: 10,
};

// Silent pino logger
const pinoLogger = require('pino')({ level: 'silent' });

// ─── Readline Helper ──────────────────────────────────────
const question = (prompt) => {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
};

// ─── Delay ───────────────────────────────────────────────
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ─── Track Reconnect ─────────────────────────────────────
let reconnectCount = 0;

// ─── Restore Auth dari Environment Variable ───────────────
function restoreAuthFromEnv() {
  const encoded = process.env.AUTH_CREDS;
  if (!encoded) return;
  try {
    const files = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    if (!existsSync(CONFIG.AUTH_DIR)) {
      mkdirSync(CONFIG.AUTH_DIR, { recursive: true });
    }
    for (const [filename, content] of Object.entries(files)) {
      writeFileSync(
        `${CONFIG.AUTH_DIR}/${filename}`,
        typeof content === 'string' ? content : JSON.stringify(content),
        'utf8'
      );
    }
    logger.info('AUTH', '🔑 Credentials dipulihkan dari AUTH_CREDS env var');
  } catch (err) {
    logger.warn('AUTH', 'Gagal memulihkan AUTH_CREDS', err.message);
  }
}

// ─── Feedback Worker ──────────────────────────────────────
let feedbackInterval = null;
let livechatReplyInterval = null;
let statusNotifInterval = null;
let broadcastInterval = null;

function startFeedbackWorker(sock) {
  if (feedbackInterval) clearInterval(feedbackInterval);

  feedbackInterval = setInterval(async () => {
    let pending;
    try { pending = await getPendingFeedbacks(); }
    catch { return; }

    for (const fb of pending) {
      try {
        const jid = fb.pelapor.includes('@') ? fb.pelapor : `${fb.pelapor}@s.whatsapp.net`;
        const noLaporan = String(fb.laporanId || '').padStart(4, '0');

        const headerText =
          `✅ *Pembaruan Laporan #${noLaporan}*\n` +
          `Halo ${fb.namaPelapor || 'Bapak/Ibu'}, berikut tanggapan dari *Kecamatan Medan Johor*:\n\n` +
          `${fb.pesan}\n\n` +
          `_Terima kasih telah menggunakan layanan Hallo Johor_ 🏙️`;

        if (fb.fotoPath && existsSync(fb.fotoPath)) {
          const imgBuffer = readFileSync(fb.fotoPath);
          await sock.sendMessage(jid, {
            image: imgBuffer,
            caption: headerText,
            mimetype: 'image/jpeg',
          });
        } else {
          await sock.sendMessage(jid, { text: headerText });
        }

        await markFeedbackDone(fb.id, 'done');
        logger.success('FEEDBACK', `Balasan terkirim ke ${jid}`, `Laporan #${noLaporan}`);

      } catch (err) {
        await markFeedbackDone(fb.id, 'failed');
        logger.error('FEEDBACK', `Gagal kirim balasan ke ${fb.pelapor}`, err.message);
      }

      await delay(1500);
    }
  }, 5000);

  logger.info('FEEDBACK', '📬 Feedback worker aktif (poll setiap 5 detik)');
}

// ─── Status Notif Worker ───────────────────────────────────
function startStatusNotifWorker(sock) {
  if (statusNotifInterval) clearInterval(statusNotifInterval);

  statusNotifInterval = setInterval(async () => {
    let pending;
    try { pending = await getPendingStatusNotifs(); }
    catch { return; }

    for (const notif of pending) {
      try {
        const jid = notif.pelapor.includes('@') ? notif.pelapor : `${notif.pelapor}@s.whatsapp.net`;
        const noLaporan = String(notif.laporanId || '').padStart(4, '0');

        const STATUS_TEXT = {
          terkirim: '📨 *Terkirim* — laporan Anda telah diterima dan sedang menunggu tindak lanjut.',
          diproses: '⚙️ *Sedang Diproses* — petugas sedang menangani laporan Anda.',
          selesai:  '✅ *Selesai* — laporan Anda telah selesai ditindaklanjuti.',
          ditolak:  '❌ *Ditolak* — laporan Anda tidak dapat diproses.',
        };

        const statusText = STATUS_TEXT[notif.statusBaru] || `📌 *${notif.statusBaru}*`;

        const text =
          `📋 *PEMBARUAN STATUS LAPORAN*\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `Halo ${notif.namaPelapor || 'Bapak/Ibu'}, status laporan Anda telah diperbarui:\n\n` +
          `📋 *No. Laporan:* #${noLaporan}\n` +
          `🗂 *Kategori:* ${notif.kategori}\n` +
          `🏘️ *Kelurahan:* ${notif.kelurahan}\n\n` +
          `🔄 *Status Terbaru:*\n${statusText}\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `Ketik *10* untuk melihat semua laporan Anda.\n` +
          `_Hallo Johor — Kecamatan Medan Johor_ 🏙️`;

        await sock.sendMessage(jid, { text });
        await markStatusNotifDone(notif.id, 'done');
        logger.success('STATUS', `Notifikasi terkirim ke ${jid}`, `Laporan #${noLaporan} → ${notif.statusBaru}`);

      } catch (err) {
        await markStatusNotifDone(notif.id, 'failed');
        logger.error('STATUS', `Gagal kirim notifikasi ke ${notif.pelapor}`, err.message);
      }

      await delay(1500);
    }
  }, 5000);

  logger.info('STATUS', '🔔 Status notif worker aktif (poll setiap 5 detik)');
}

// ─── LiveChat Reply Worker ─────────────────────────────────
function startLivechatReplyWorker(sock) {
  if (livechatReplyInterval) clearInterval(livechatReplyInterval);

  livechatReplyInterval = setInterval(async () => {
    let pending;
    try { pending = await getPendingLivechatReplies(); }
    catch { return; }

    for (const reply of pending) {
      try {
        const jid = reply.jid.includes('@') ? reply.jid : `${reply.jid}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: reply.text });
        await markLivechatReplyDone(reply.id, 'sent');
        logger.success('LIVECHAT', `Reply terkirim ke ${jid}`, `"${reply.text.substring(0, 40)}..."`);
      } catch (err) {
        await markLivechatReplyDone(reply.id, 'failed');
        logger.error('LIVECHAT', `Gagal kirim reply ke ${reply.jid}`, err.message);
      }
      await delay(300);
    }
  }, 2000);

  // Worker untuk menutup sesi
  setInterval(() => {
    try {
      const closedFile = './data/livechat_close_queue.json';
      if (!existsSync(closedFile)) return;
      const data = JSON.parse(readFileSync(closedFile, 'utf8'));
      const pending = (data.queue || []).filter(c => c.status === 'pending');
      if (!pending.length) return;
      pending.forEach(async (c) => {
        try {
          const jid = c.jid.includes('@') ? c.jid : `${c.jid}@s.whatsapp.net`;
          await sock.sendMessage(jid, { text: `✅ Sesi LiveChat Anda telah ditutup oleh admin.\n\nTerima kasih! Ketik *menu* untuk kembali ke menu utama.` });
          c.status = 'done';
          writeFileSync(closedFile, JSON.stringify(data, null, 2), 'utf8');
          const { clearSession } = require('./store.js');
          clearSession(jid);
        } catch {}
      });
    } catch {}
  }, 3000);

  logger.info('LIVECHAT', '💬 LiveChat reply worker aktif (poll setiap 2 detik)');
}

// ─── Broadcast Worker ────────────────────────────────────
function startBroadcastWorker(sock) {
  if (broadcastInterval) clearInterval(broadcastInterval);

  broadcastInterval = setInterval(async () => {
    let pending;
    try { pending = await getPendingBroadcasts(); }
    catch { return; }

    for (const bc of pending) {
      try {
        const jid = bc.channelJid;
        if (!jid) { await markBroadcastDone(bc.id, 'failed', 'channelJid kosong'); continue; }

        // Skip saluran di v6.5.0
        const isNewsletter = jid.endsWith('@newsletter');
        if (isNewsletter) {
          await markBroadcastDone(bc.id, 'failed', 'Saluran tidak didukung di v6.5.0');
          logger.warn('BROADCAST', `Broadcast ke saluran dilewati (${jid})`);
          continue;
        }

        const { path: pathModule } = require('path');
        const mediaPath = bc.mediaFilename
          ? pathModule.join(__dirname, 'data', 'broadcast_media', bc.mediaFilename)
          : null;
        let mediaBuffer = null;
        let mediaMime = bc.mediaMime || '';
        
        if (mediaPath && existsSync(mediaPath)) {
          mediaBuffer = readFileSync(mediaPath);
        } else if (bc.mediaUrl) {
          try {
            const r = await axios.get(bc.mediaUrl, {
              responseType: 'arraybuffer', timeout: 25000,
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' },
              maxContentLength: 12 * 1024 * 1024,
              validateStatus: () => true,
            });
            if (r.status === 200 && r.data?.length) {
              mediaBuffer = Buffer.from(r.data);
              mediaMime = (r.headers['content-type'] || mediaMime || 'image/jpeg').split(';')[0].trim();
            }
          } catch (dlErr) {
            logger.warn('BROADCAST', 'Unduh mediaUrl error, kirim teks saja', dlErr.message);
          }
        }
        const hasMedia = !!mediaBuffer;

        const sendFn = (payload) => sock.sendMessage(jid, payload);

        if (hasMedia) {
          const isVideo = (mediaMime || '').startsWith('video/');
          try {
            if (isVideo) {
              await sendFn({ video: mediaBuffer, caption: bc.pesan || '', mimetype: mediaMime || 'video/mp4' });
            } else {
              await sendFn({ image: mediaBuffer, caption: bc.pesan || '', mimetype: mediaMime || 'image/jpeg' });
            }
          } catch (mediaErr) {
            logger.warn('BROADCAST', `Media gagal, fallback ke teks`, mediaErr.message);
            const fallbackText = [bc.pesan, '_(Foto/video tidak dapat dikirim)_'].filter(Boolean).join('\n');
            await sock.sendMessage(jid, { text: fallbackText });
          }
        } else if (bc.pesan) {
          await sendFn({ text: bc.pesan });
        } else {
          await markBroadcastDone(bc.id, 'failed', 'Tidak ada pesan maupun media');
          continue;
        }

        await markBroadcastDone(bc.id, 'sent');
        logger.success('BROADCAST', `Broadcast terkirim → ${jid} [grup]`, bc.pesan?.substring(0, 40) || `[${mediaMime}]`);

      } catch (err) {
        await markBroadcastDone(bc.id, 'failed', err.message);
        logger.error('BROADCAST', `Gagal broadcast → ${bc.channelJid}`, err.message);
      }

      await delay(2500);
    }
  }, 5000);

  logger.info('BROADCAST', '📢 Broadcast worker aktif (poll setiap 5 detik)');
}

// ─── Time Helper ─────────────────────────────────────────
function wibTimeParts() {
  const parts = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())) {
    if (type !== 'literal') parts[type] = value;
  }
  return parts;
}

// ─── Berita Auto Broadcast ────────────────────────────────
function startBeritaScheduler() {
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    let cfg;
    try { cfg = await getBeritaAutoConfig(); } catch { return; }
    if (!cfg.enabled || !cfg.channelJid) return;
    
    if (cfg.channelJid.endsWith('@newsletter')) {
      logger.warn('BERITA', 'Broadcast berita ke saluran dilewati (v6.5.0 tidak support saluran)');
      return;
    }
    
    const intervalMs = (cfg.intervalMinutes || 30) * 60_000;
    if (cfg.lastCheckAt && Date.now() - new Date(cfg.lastCheckAt).getTime() < intervalMs) return;
    busy = true;
    try {
      const r = await antrekanBeritaBaru({ channelJid: cfg.channelJid });
      await markBeritaChecked({ source: r.source, error: null });
      if (r.queued > 0) logger.info('BERITA', `Siklus selesai: ${r.queued} berita baru diantrekan`, `sumber: ${r.source}`);
    } catch (err) {
      await markBeritaChecked({ source: null, error: err.message });
      logger.warn('BERITA', 'Siklus cek berita gagal (dicoba lagi jadwal berikutnya)', err.message);
    } finally {
      busy = false;
    }
  }, 60_000);
  logger.info('BERITA', '📰 Penjadwal berita otomatis aktif (interval diatur di dashboard)');
}

// ─── Weather Scheduler ─────────────────────────────────────
function startWeatherScheduler() {
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    const cfg = await getWeatherBroadcastConfig();
    if (!cfg.enabled || !cfg.channelJid) return;
    
    if (cfg.channelJid.endsWith('@newsletter')) {
      logger.warn('CUACA', 'Broadcast cuaca ke saluran dilewati (v6.5.0 tidak support saluran)');
      return;
    }
    
    const p = wibTimeParts();
    const ymd = `${p.year}-${p.month}-${p.day}`;
    if (cfg.lastSentDate === ymd) return;
    const h = parseInt(p.hour, 10);
    const m = parseInt(p.minute, 10);
    if (h !== 0 || m > 12) return;
    busy = true;
    try {
      const data = await scrapeMedanJohorCuacaHariIni();
      const pesan = formatCuacaWhatsApp(data);
      await queueBroadcast({ channelJid: cfg.channelJid, pesan: pesan.trim() });
      await markWeatherBroadcastSent(ymd);
      logger.success('CUACA', `Jadwal 00:00 WIB: prakiraan BMKG diantrekan → ${cfg.channelJid}`);
    } catch (err) {
      logger.warn('CUACA', 'Gagal jadwal BMKG (akan dicoba lagi dalam jendela 00:00)', err.message);
    } finally {
      busy = false;
    }
  }, 40_000);
  logger.info('CUACA', '⏰ Penjadwal prakiraan BMKG aktif (00:00 WIB, jika diaktifkan di dashboard)');
}

// ─── Start Bot ───────────────────────────────────────────
async function startBot() {
  logger.banner();
  logger.info('BOOT', 'Inisialisasi sistem bot...');
  await delay(500);

  // Pulihkan auth dari env var
  restoreAuthFromEnv();

  // Load auth state - SINGLE FILE MODE
  const { state, saveCreds } = await useSingleFileAuthState('./auth_info_baileys/creds.json');
  logger.info('AUTH', 'Auth state dimuat (Single File Mode)');

  // Create WA Socket
  const sock = makeWASocket({
    logger: pinoLogger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pinoLogger),
    },
    browser: ['HalloJohorBot', 'Chrome', '1.0.0'],
    syncFullHistory: false,
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: false,
    getMessage: async () => {
      return { conversation: 'hello' };
    }
  });

  // ─── Pairing Code Handler ─────────────────────────────
  if (!sock.authState.creds.me) {
    await delay(2000);

    logger.divider();
    logger.info('PAIR', 'Akun belum terdaftar. Memulai proses Pairing Code...');
    logger.divider();

    let phoneNumber;
    if (process.env.PHONE_NUMBER) {
      phoneNumber = process.env.PHONE_NUMBER;
      logger.info('PAIR', `Menggunakan PHONE_NUMBER dari environment: ${phoneNumber}`);
    } else {
      phoneNumber = await question('\n📱 Masukkan nomor WhatsApp (format: 628xxxxxxxxxx): ');
    }

    phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
    if (!phoneNumber.startsWith('62')) {
      phoneNumber = '62' + phoneNumber.replace(/^0/, '');
    }

    logger.info('PAIR', `Nomor yang digunakan: +${phoneNumber}`);
    logger.info('PAIR', 'Meminta pairing code...');

    await delay(3000);

    try {
      const code = await sock.requestPairingCode(phoneNumber);
      const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;

      logger.divider();
      console.log(`\n`);
      console.log(`  ╔══════════════════════════════╗`);
      console.log(`  ║   🔑  PAIRING CODE ANDA      ║`);
      console.log(`  ║                              ║`);
      console.log(`  ║      \x1b[33m\x1b[1m${formattedCode}\x1b[0m          ║`);
      console.log(`  ║                              ║`);
      console.log(`  ╚══════════════════════════════╝`);
      console.log(`\n`);
      logger.info('PAIR', 'Cara pairing:');
      logger.info('PAIR', '1. Buka WhatsApp di HP');
      logger.info('PAIR', '2. Tap tiga titik > Perangkat Tertaut');
      logger.info('PAIR', '3. Tap "Tautkan Perangkat"');
      logger.info('PAIR', '4. Masukkan kode pairing di atas');
      logger.divider();
      logger.info('PAIR', `Kode kedaluwarsa dalam ${CONFIG.PAIRING_TIMEOUT} detik...`);
    } catch (err) {
      logger.error('PAIR', 'Gagal mendapatkan pairing code', err.message);
      logger.warn('PAIR', 'Mencoba restart dalam 5 detik...');
      await delay(5000);
      return startBot();
    }
  }

  // ─── Connection Update ────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, isOnline } = update;

    // Check for new login (pairing success)
    if (update.isNewLogin) {
      logger.success('CONNECTED', '🎉 New login! Pairing BERHASIL!');
    }

    if (connection === 'connecting') {
      logger.state('CONNECTING', 'Menghubungkan ke server WhatsApp...');
    }

    if (connection === 'open') {
      reconnectCount = 0;
      const botJid = sock.user?.id;
      const botName = sock.user?.name;
      logger.success('CONNECTED', `Bot terhubung!`, `${botName} (${botJid})`);
      logger.divider();
      logger.success('READY', '🚀 Bot siap menerima pesan!');
      logger.info('READY', 'Ketik Ctrl+C untuk menghentikan bot');
      logger.divider();
      startFeedbackWorker(sock);
      startStatusNotifWorker(sock);
      startLivechatReplyWorker(sock);
      startBroadcastWorker(sock);
    }

    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      logger.warn('CONNECTION', `Koneksi terputus`, `Kode: ${reason}`);

      if (reason === DisconnectReason.badSession) {
        logger.error('AUTH', 'Sesi rusak! Hapus folder auth_info_baileys dan jalankan ulang.');
        process.exit(1);
      } else if (reason === DisconnectReason.connectionReplaced) {
        logger.error('AUTH', 'Sesi digantikan perangkat lain. Bot berhenti.');
        process.exit(1);
      } else if (reason === DisconnectReason.loggedOut) {
        logger.error('AUTH', 'Bot di-logout! Hapus folder auth dan jalankan ulang.');
        process.exit(1);
      } else {
        logger.warn('RECONNECT', `Disconnect (${reason}). Mencoba reconnect...`);
        await scheduleReconnect();
      }
    }

    if (isOnline !== undefined) {
      logger.state('ONLINE STATUS', isOnline ? '🟢 Online' : '🔴 Offline');
    }
  });

  // ─── Credentials Update ───────────────────────────────
  sock.ev.on('creds.update', async () => {
    await saveCreds();
    logger.info('AUTH', 'Credentials disimpan');
  });

  // ─── Message Handler ──────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.remoteJid === 'status@broadcast') continue;
      if (!msg.message) continue;

      try {
        await handleMessage(sock, msg);
      } catch (err) {
        logger.error('HANDLER', `Error memproses pesan`, err.message);
        console.error(err);
      }
    }
  });

  // ─── Group Events ─────────────────────────────────────
  sock.ev.on('groups.update', (updates) => {
    for (const update of updates) {
      logger.info('GROUP', `Update grup: ${update.id}`, JSON.stringify(update).substring(0, 80));
    }
  });

  sock.ev.on('group-participants.update', ({ id, participants, action }) => {
    logger.info('GROUP', `Grup ${id}: ${action}`, participants.join(', '));
  });

  // ─── Reconnect Scheduler ──────────────────────────────
  async function scheduleReconnect() {
    if (reconnectCount >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
      logger.error('RECONNECT', `Gagal reconnect setelah ${CONFIG.MAX_RECONNECT_ATTEMPTS} percobaan. Bot berhenti.`);
      process.exit(1);
    }
    reconnectCount++;
    const waitTime = CONFIG.RECONNECT_DELAY * reconnectCount;
    logger.info('RECONNECT', `Percobaan ke-${reconnectCount}/${CONFIG.MAX_RECONNECT_ATTEMPTS}`, `tunggu ${waitTime / 1000}s`);
    await delay(waitTime);
    startBot();
  }

  return sock;
}

// ─── Process Handlers ─────────────────────────────────────
process.on('uncaughtException', (err) => {
  logger.error('SYSTEM', 'Uncaught Exception', err.message);
  console.error(err);
});

process.on('unhandledRejection', (err) => {
  logger.error('SYSTEM', 'Unhandled Rejection', err?.message || String(err));
});

process.on('SIGINT', () => {
  logger.warn('SYSTEM', 'Menerima SIGINT. Bot dihentikan dengan aman...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.warn('SYSTEM', 'Menerima SIGTERM. Bot dihentikan...');
  process.exit(0);
});

// ─── Run ──────────────────────────────────────────────────
startWeatherScheduler();
startBeritaScheduler();
startBot().catch(err => {
  logger.error('BOOT', 'Gagal menjalankan bot', err.message);
  console.error(err);
  process.exit(1);
});
