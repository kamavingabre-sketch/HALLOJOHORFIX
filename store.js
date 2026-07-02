// ═══════════════════════════════════════════════════════════
//   DATA STORE - Supabase Integration
//   Semua data tersimpan di Supabase PostgreSQL
// ═══════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY; // gunakan service_role key

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('❌ SUPABASE_URL dan SUPABASE_SERVICE_KEY wajib diisi di environment variables!');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const logErr = (fn, err) => console.error(`[store:${fn}]`, err?.message || err);

// ══════════════════════════════════════════════════════════
//   USER SESSIONS (tetap in-memory)
// ══════════════════════════════════════════════════════════

const sessions = {};
export const getSession = (jid) => sessions[jid] || null;
export const setSession = (jid, data) => { sessions[jid] = { ...data, updatedAt: Date.now() }; };
export const clearSession = (jid) => { delete sessions[jid]; };

// ══════════════════════════════════════════════════════════
//   GRUP LAPORAN
// ══════════════════════════════════════════════════════════

export const getLaporanGroups = async () => {
  const { data, error } = await supabase.from('laporan_groups').select('*').order('added_at', { ascending: true });
  if (error) { logErr('getLaporanGroups', error); return []; }
  return (data || []).map(r => ({ id: r.id, name: r.name, addedAt: r.added_at }));
};

export const addLaporanGroup = async (groupId, groupName) => {
  const { error } = await supabase.from('laporan_groups').insert({ id: groupId, name: groupName });
  if (error) { if (error.code === '23505') return false; logErr('addLaporanGroup', error); return false; }
  return true;
};

export const removeLaporanGroup = async (groupId) => {
  const { error, count } = await supabase.from('laporan_groups').delete({ count: 'exact' }).eq('id', groupId);
  if (error) { logErr('removeLaporanGroup', error); return false; }
  return (count || 0) > 0;
};

// ══════════════════════════════════════════════════════════
//   LAPORAN COUNTER & ARCHIVE
// ══════════════════════════════════════════════════════════

export const getNextLaporanId = async () => {
  const { data, error } = await supabase.rpc('increment_laporan_counter');
  if (error) { logErr('getNextLaporanId', error); return Date.now(); }
  return data;
};

export const saveLaporan = async (laporan) => {
  const { error } = await supabase.from('laporan_archive').insert({
    id:           String(laporan.id),
    pelapor:      laporan.pelapor || null,
    nama_pelapor: laporan.namaPelapor || null,
    kategori:     laporan.kategori || null,
    kelurahan:    laporan.kelurahan || null,
    isi:          laporan.isi || null,
    foto_url:     laporan.fotoUrl || laporan.fotoPath || laporan.foto_url || null,
    alamat:       laporan.alamat || null,
    lokasi:       laporan.koordinat ? JSON.stringify(laporan.koordinat) : null,
    status:       laporan.status || 'terkirim',
    tanggal:      laporan.tanggal || new Date().toISOString(),
  });
  if (error) logErr('saveLaporan', error);
};

const mapLaporan = (r) => ({
  id: r.id, pelapor: r.pelapor, kategori: r.kategori, kelurahan: r.kelurahan,
  isi: r.isi, fotoUrl: r.foto_url,
  lokasi: r.lokasi ? (typeof r.lokasi === 'string' ? JSON.parse(r.lokasi) : r.lokasi) : null,
  status: r.status, tanggal: r.tanggal, statusUpdatedAt: r.status_updated_at,
});

export const getLaporanById = async (id) => {
  const { data, error } = await supabase.from('laporan_archive').select('*').eq('id', String(id)).single();
  if (error) return null;
  return mapLaporan(data);
};

export const getLaporanByJid = async (jid) => {
  const { data, error } = await supabase.from('laporan_archive').select('*').eq('pelapor', jid).order('tanggal', { ascending: false });
  if (error) { logErr('getLaporanByJid', error); return []; }
  return (data || []).map(mapLaporan);
};

export const getAllLaporan = async () => {
  const { data, error } = await supabase.from('laporan_archive').select('*').order('tanggal', { ascending: false });
  if (error) { logErr('getAllLaporan', error); return []; }
  return (data || []).map(r => ({
    id: r.id,
    pelapor: r.pelapor,
    namaPelapor: r.nama_pelapor || '',
    kategori: r.kategori,
    kelurahan: r.kelurahan,
    isi: r.isi,
    fotoUrl: r.foto_url,
    foto: r.foto_url,
    fotoPath: r.foto_url ? (r.foto_url.startsWith('http') ? r.foto_url : `/foto/${r.foto_url}`) : null,
    alamat: r.alamat || '',
    koordinat: r.lokasi ? (typeof r.lokasi === 'string' ? JSON.parse(r.lokasi) : r.lokasi) : null,
    status: r.status,
    tanggal: r.tanggal,
    statusUpdatedAt: r.status_updated_at,
  }));
};

export const updateLaporanStatus = async (id, status) => {
  const VALID = ['terkirim', 'diproses', 'selesai', 'ditolak'];
  if (!VALID.includes(status)) return false;
  const { error, count } = await supabase.from('laporan_archive')
    .update({ status, status_updated_at: new Date().toISOString() }, { count: 'exact' }).eq('id', String(id));
  if (error) { logErr('updateLaporanStatus', error); return false; }
  return (count || 0) > 0;
};

export const deleteLaporan = async (id) => {
  const { error, count } = await supabase.from('laporan_archive').delete({ count: 'exact' }).eq('id', String(id));
  if (error) { logErr('deleteLaporan', error); return false; }
  return (count || 0) > 0;
};

const STATUS_BADGE = { terkirim: '📨 Terkirim', diproses: '⚙️ Sedang Diproses', selesai: '✅ Selesai', ditolak: '❌ Ditolak' };

export const buildStatusLaporan = async (jid) => {
  const list = await getLaporanByJid(jid);
  const total = list.length;
  let text = `📋 *STATUS LAPORAN SAYA*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  if (total === 0) {
    text += `📭 *Anda belum pernah mengirimkan laporan.*\n\nGunakan menu *2 – Pengaduan Masyarakat* untuk melaporkan masalah di wilayah Anda.\n`;
  } else {
    text += `📊 Total laporan Anda: *${total} laporan*\n\n`;
    list.slice(0, 5).forEach((l, i) => {
      const tgl = new Date(l.tanggal).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const badge = STATUS_BADGE[l.status] || `📌 ${l.status}`;
      text += `${i + 1}. 📋 *No. #${String(l.id).padStart(4, '0')}*\n   ${badge}\n   🗂 ${l.kategori} — ${l.kelurahan}\n   📅 ${tgl}\n`;
      if (l.isi) text += `   📝 _${l.isi.length > 60 ? l.isi.slice(0, 60) + '…' : l.isi}_\n`;
      text += `\n`;
    });
    if (total > 5) text += `_...dan ${total - 5} laporan lainnya_\n\n`;
  }
  text += `━━━━━━━━━━━━━━━━━━━━━━━\n💡 Estimasi tindak lanjut setiap laporan: *2×24 jam*\n📞 Pertanyaan lebih lanjut: *0813-6777-2047*\n\nKetik *menu* untuk kembali ke menu utama.`;
  return text;
};

// ══════════════════════════════════════════════════════════
//   FEEDBACK QUEUE
// ══════════════════════════════════════════════════════════

export const queueFeedback = async (item) => {
  const { error } = await supabase.from('feedback_queue').insert({ id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, status: 'pending', data: item });
  if (error) logErr('queueFeedback', error);
};

export const getPendingFeedbacks = async () => {
  const { data, error } = await supabase.from('feedback_queue').select('*').eq('status', 'pending');
  if (error) { logErr('getPendingFeedbacks', error); return []; }
  return (data || []).map(r => ({ id: r.id, status: r.status, createdAt: r.created_at, sentAt: r.sent_at, ...r.data }));
};

export const markFeedbackDone = async (id, status = 'done') => {
  const { error } = await supabase.from('feedback_queue').update({ status, sent_at: new Date().toISOString() }).eq('id', id);
  if (error) logErr('markFeedbackDone', error);
};

// ══════════════════════════════════════════════════════════
//   STATUS NOTIFICATION QUEUE
// ══════════════════════════════════════════════════════════

export const queueStatusNotif = async (item) => {
  const { error } = await supabase.from('status_notif_queue').insert({ id: `sn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, status: 'pending', data: item });
  if (error) logErr('queueStatusNotif', error);
};

export const getPendingStatusNotifs = async () => {
  const { data, error } = await supabase.from('status_notif_queue').select('*').eq('status', 'pending');
  if (error) { logErr('getPendingStatusNotifs', error); return []; }
  return (data || []).map(r => ({ id: r.id, status: r.status, createdAt: r.created_at, sentAt: r.sent_at, ...r.data }));
};

export const markStatusNotifDone = async (id, status = 'done') => {
  const { error } = await supabase.from('status_notif_queue').update({ status, sent_at: new Date().toISOString() }).eq('id', id);
  if (error) logErr('markStatusNotifDone', error);
};

// ══════════════════════════════════════════════════════════
//   LIVE CHAT
// ══════════════════════════════════════════════════════════

const mapLivechat = (r) => ({
  id: r.id, jid: r.jid, name: r.name, status: r.status,
  startedAt: r.started_at || r.startedAt,
  lastMessageAt: r.last_message_at || r.lastMessageAt,
  closedAt: r.closed_at || r.closedAt || null,
  messages: Array.isArray(r.messages) ? r.messages : [],
  unread: r.unread || 0,
});

export const getLivechatSessions = async () => {
  const { data, error } = await supabase.from('livechat_sessions').select('*').order('last_message_at', { ascending: false });
  if (error) { logErr('getLivechatSessions', error); return []; }
  return (data || []).map(mapLivechat);
};

export const getLivechatByJid = async (jid) => {
  const { data, error } = await supabase.from('livechat_sessions').select('*').eq('jid', jid).eq('status', 'active').single();
  if (error) return null;
  return mapLivechat(data);
};

export const getLivechatById = async (sessionId) => {
  const { data, error } = await supabase.from('livechat_sessions').select('*').eq('id', sessionId).single();
  if (error) return null;
  return mapLivechat(data);
};

export const startLivechatSession = async (jid, name) => {
  await supabase.from('livechat_sessions').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('jid', jid).eq('status', 'active');
  const session = { id: `lc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, jid, name, status: 'active', started_at: new Date().toISOString(), last_message_at: new Date().toISOString(), messages: [], unread: 0 };
  const { error } = await supabase.from('livechat_sessions').insert(session);
  if (error) { logErr('startLivechatSession', error); return null; }
  return mapLivechat(session);
};

export const addLivechatMessage = async (jid, from, text, mediaPath = null) => {
  const { data: row, error: fetchErr } = await supabase.from('livechat_sessions').select('*').eq('jid', jid).eq('status', 'active').single();
  if (fetchErr || !row) return null;
  const messages = Array.isArray(row.messages) ? row.messages : [];
  const message = { id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, from, text, mediaPath: mediaPath || null, timestamp: new Date().toISOString() };
  messages.push(message);
  const { error } = await supabase.from('livechat_sessions').update({ messages, last_message_at: message.timestamp, unread: from === 'user' ? (row.unread || 0) + 1 : row.unread }).eq('id', row.id);
  if (error) { logErr('addLivechatMessage', error); return null; }
  return { session: mapLivechat({ ...row, messages }), message };
};

export const closeLivechatSession = async (jid) => {
  const { error, count } = await supabase.from('livechat_sessions').update({ status: 'closed', closed_at: new Date().toISOString() }, { count: 'exact' }).eq('jid', jid).eq('status', 'active');
  if (error) { logErr('closeLivechatSession', error); return false; }
  return (count || 0) > 0;
};

export const closeLivechatSessionById = async (sessionId) => {
  const { error, count } = await supabase.from('livechat_sessions').update({ status: 'closed', closed_at: new Date().toISOString() }, { count: 'exact' }).eq('id', sessionId);
  if (error) { logErr('closeLivechatSessionById', error); return false; }
  return (count || 0) > 0;
};

export const markLivechatRead = async (sessionId) => {
  const { error } = await supabase.from('livechat_sessions').update({ unread: 0 }).eq('id', sessionId);
  if (error) logErr('markLivechatRead', error);
};

export const queueLivechatReply = async (item) => {
  const { error } = await supabase.from('livechat_replies').insert({ id: `lcr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, status: 'pending', data: item });
  if (error) logErr('queueLivechatReply', error);
};

export const getPendingLivechatReplies = async () => {
  const { data, error } = await supabase.from('livechat_replies').select('*').eq('status', 'pending');
  if (error) { logErr('getPendingLivechatReplies', error); return []; }
  return (data || []).map(r => ({ id: r.id, status: r.status, createdAt: r.created_at, sentAt: r.sent_at, ...r.data }));
};

export const markLivechatReplyDone = async (id, status = 'sent') => {
  const { error } = await supabase.from('livechat_replies').update({ status, sent_at: new Date().toISOString() }).eq('id', id);
  if (error) logErr('markLivechatReplyDone', error);
};

// ══════════════════════════════════════════════════════════
//   GROUP ROUTING
// ══════════════════════════════════════════════════════════

export const getGroupRouting = async () => {
  const { data, error } = await supabase.from('group_routing').select('routing').eq('id', 1).single();
  if (error) { logErr('getGroupRouting', error); return {}; }
  return data?.routing || {};
};

export const setGroupRouting = async (routing) => {
  const { error } = await supabase.from('group_routing').upsert({ id: 1, routing });
  if (error) logErr('setGroupRouting', error);
};

// ══════════════════════════════════════════════════════════
//   KEGIATAN KECAMATAN
// ══════════════════════════════════════════════════════════

export const getKegiatan = async () => {
  const { data, error } = await supabase.from('kegiatan').select('*').order('created_at', { ascending: false });
  if (error) { logErr('getKegiatan', error); return []; }
  return (data || []).map(r => ({ id: r.id, createdAt: r.created_at, nama: r.nama, deskripsi: r.deskripsi, tempat: r.tempat, tanggal: r.tanggal }));
};

export const addKegiatan = async (item) => {
  const entry = { id: `kg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, nama: item.nama || '', deskripsi: item.deskripsi || '', tempat: item.tempat || '', tanggal: item.tanggal || '' };
  const { error } = await supabase.from('kegiatan').insert(entry);
  if (error) { logErr('addKegiatan', error); return null; }
  return { ...entry, createdAt: new Date().toISOString() };
};

export const deleteKegiatan = async (id) => {
  const { error, count } = await supabase.from('kegiatan').delete({ count: 'exact' }).eq('id', id);
  if (error) { logErr('deleteKegiatan', error); return false; }
  return (count || 0) > 0;
};

export const buildKegiatanMenu = async () => {
  const list = await getKegiatan();
  let text = `🎪 *INFORMASI KEGIATAN KECAMATAN*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  if (!list.length) {
    text += `📭 *Saat ini tidak ada informasi kegiatan yang tersedia.*\n\nPantau terus layanan Hallo Johor untuk info kegiatan terbaru dari Kecamatan Medan Johor!\n`;
  } else {
    text += `Kegiatan yang sedang/akan dilaksanakan:\n\n`;
    list.forEach((k, i) => {
      text += `${i + 1}. 📌 *${k.nama}*\n`;
      if (k.tanggal)   text += `   📅 ${k.tanggal}\n`;
      if (k.tempat)    text += `   📍 ${k.tempat}\n`;
      if (k.deskripsi) text += `   📝 ${k.deskripsi}\n`;
      text += `\n`;
    });
  }
  text += `━━━━━━━━━━━━━━━━━━━━━━━\n📞 Info lebih lanjut:\n*Kantor Kecamatan Medan Johor*\n📱 0813-6777-2047\n\n🏙️ *#MEDANUNTUKSEMUA*\nKetik *0* untuk kembali ke menu`;
  return text;
};

// ══════════════════════════════════════════════════════════
//   BROADCAST
// ══════════════════════════════════════════════════════════

export const getBroadcastChannels = async () => {
  const { data, error } = await supabase.from('broadcast_channels').select('*').order('added_at', { ascending: true });
  if (error) { logErr('getBroadcastChannels', error); return []; }
  return (data || []).map(r => ({ jid: r.jid, name: r.name, addedAt: r.added_at }));
};

export const addBroadcastChannel = async (channelJid, channelName) => {
  const { error } = await supabase.from('broadcast_channels').insert({ jid: channelJid, name: channelName || channelJid });
  if (error) { if (error.code === '23505') return false; logErr('addBroadcastChannel', error); return false; }
  return true;
};

export const removeBroadcastChannel = async (channelJid) => {
  const { error, count } = await supabase.from('broadcast_channels').delete({ count: 'exact' }).eq('jid', channelJid);
  if (error) { logErr('removeBroadcastChannel', error); return false; }
  return (count || 0) > 0;
};

export const queueBroadcast = async (item) => {
  const entry = { id: `bc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, status: 'pending', data: item };
  const { error } = await supabase.from('broadcast_queue').insert(entry);
  if (error) { logErr('queueBroadcast', error); return null; }
  return { ...entry, createdAt: new Date().toISOString() };
};

export const getPendingBroadcasts = async () => {
  const { data, error } = await supabase.from('broadcast_queue').select('*').eq('status', 'pending');
  if (error) { logErr('getPendingBroadcasts', error); return []; }
  return (data || []).map(r => ({ id: r.id, status: r.status, createdAt: r.created_at, sentAt: r.sent_at, error: r.error, ...r.data }));
};

export const markBroadcastDone = async (id, status = 'sent', error = null) => {
  const { error: dbErr } = await supabase.from('broadcast_queue').update({ status, sent_at: new Date().toISOString(), error: error || null }).eq('id', id);
  if (dbErr) logErr('markBroadcastDone', dbErr);
};

export const getBroadcastHistory = async (limit = 30) => {
  const { data, error } = await supabase.from('broadcast_queue').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) { logErr('getBroadcastHistory', error); return []; }
  return (data || []).map(r => ({ id: r.id, status: r.status, createdAt: r.created_at, sentAt: r.sent_at, error: r.error, ...r.data }));
};

// ══════════════════════════════════════════════════════════
//   WEATHER BROADCAST SCHEDULE
// ══════════════════════════════════════════════════════════

export const getWeatherBroadcastConfig = async () => {
  const { data, error } = await supabase.from('weather_broadcast_schedule').select('*').eq('id', 1).single();
  if (error) return { enabled: false, channelJid: '', lastSentDate: null };
  return { enabled: !!data.enabled, channelJid: (data.channel_jid || '').trim(), lastSentDate: data.last_sent_date || null };
};

export const setWeatherBroadcastConfig = async ({ enabled, channelJid }) => {
  const { error } = await supabase.from('weather_broadcast_schedule').upsert({ id: 1, enabled: Boolean(enabled), channel_jid: (channelJid || '').trim() });
  if (error) logErr('setWeatherBroadcastConfig', error);
};

export const markWeatherBroadcastSent = async (wibYmd) => {
  const { error } = await supabase.from('weather_broadcast_schedule').update({ last_sent_date: wibYmd }).eq('id', 1);
  if (error) logErr('markWeatherBroadcastSent', error);
};

// ══════════════════════════════════════════════════════════
//   UMKM BINAAN
// ══════════════════════════════════════════════════════════

export const getUmkm = async () => {
  const { data, error } = await supabase.from('umkm_binaan').select('*').order('nama', { ascending: true });
  if (error) { logErr('getUmkm', error); return []; }
  return (data || []).map(r => ({ id: r.id, createdAt: r.created_at, updatedAt: r.updated_at, nama: r.nama, kategori: r.kategori, alamat: r.alamat, mapsUrl: r.maps_url, kontak: r.kontak }));
};

export const addUmkm = async (item) => {
  const entry = { id: `umkm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, nama: (item.nama || '').trim(), kategori: (item.kategori || '').trim(), alamat: (item.alamat || '').trim(), maps_url: (item.mapsUrl || '').trim(), kontak: (item.kontak || '').trim() };
  const { error } = await supabase.from('umkm_binaan').insert(entry);
  if (error) { logErr('addUmkm', error); return null; }
  return { ...entry, mapsUrl: entry.maps_url, createdAt: new Date().toISOString() };
};

export const updateUmkm = async (id, item) => {
  const updates = { updated_at: new Date().toISOString() };
  if (item.nama     !== undefined) updates.nama     = (item.nama     || '').trim();
  if (item.kategori !== undefined) updates.kategori = (item.kategori || '').trim();
  if (item.alamat   !== undefined) updates.alamat   = (item.alamat   || '').trim();
  if (item.mapsUrl  !== undefined) updates.maps_url = (item.mapsUrl  || '').trim();
  if (item.kontak   !== undefined) updates.kontak   = (item.kontak   || '').trim();
  const { data, error } = await supabase.from('umkm_binaan').update(updates).eq('id', id).select().single();
  if (error) { logErr('updateUmkm', error); return false; }
  return data;
};

export const deleteUmkm = async (id) => {
  const { error, count } = await supabase.from('umkm_binaan').delete({ count: 'exact' }).eq('id', id);
  if (error) { logErr('deleteUmkm', error); return false; }
  return (count || 0) > 0;
};

// ══════════════════════════════════════════════════════════
//   IVA TEST SKRINING
// ══════════════════════════════════════════════════════════

export const saveIvaResult = async (item) => {
  const entry = {
    id:           `iva_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    wa_number:    item.waNumber   || '',
    nama_panggil: item.nama       || '',
    skor:         item.skor       || 0,
    risiko:       item.risiko     || 'rendah',
    jawaban:      JSON.stringify(item.jawaban || {}),
    created_at:   new Date().toISOString(),
  };
  const { error } = await supabase.from('iva_skrining').insert(entry);
  if (error) { logErr('saveIvaResult', error); return null; }
  return entry;
};

export const getIvaResults = async (limit = 100) => {
  const { data, error } = await supabase
    .from('iva_skrining')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { logErr('getIvaResults', error); return []; }
  return (data || []).map(r => ({
    id:        r.id,
    waNumber:  r.wa_number,
    nama:      r.nama_panggil,
    skor:      r.skor,
    risiko:    r.risiko,
    jawaban:   r.jawaban,
    createdAt: r.created_at,
  }));
};

export const getIvaStats = async () => {
  const { data, error } = await supabase.from('iva_skrining').select('risiko');
  if (error) { logErr('getIvaStats', error); return { total: 0, rendah: 0, sedang: 0, tinggi: 0 }; }
  const total  = data.length;
  const rendah = data.filter(r => r.risiko === 'rendah').length;
  const sedang = data.filter(r => r.risiko === 'sedang').length;
  const tinggi = data.filter(r => r.risiko === 'tinggi').length;
  return { total, rendah, sedang, tinggi };
};

// ══════════════════════════════════════════════════════════
//   FILE UPLOAD - Supabase Storage
// ══════════════════════════════════════════════════════════

export const uploadLaporanFoto = async (laporanId, buffer, mimeType = 'image/jpeg') => {
  try {
    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
    const filename = `laporan_${String(laporanId).padStart(4, '0')}_${Date.now()}.${ext}`;
    const bucketName = 'laporan-fotos';
    
    const { data, error } = await supabase.storage
      .from(bucketName)
      .upload(`laporan/${filename}`, buffer, {
        contentType: mimeType,
        cacheControl: '3600',
        upsert: false
      });
    
    if (error) {
      logErr('uploadLaporanFoto', error);
      return null;
    }
    
    // Return public URL
    const { data: { publicUrl } } = supabase.storage
      .from(bucketName)
      .getPublicUrl(`laporan/${filename}`);
    
    return publicUrl;
  } catch (err) {
    logErr('uploadLaporanFoto', err);
    return null;
  }
};
