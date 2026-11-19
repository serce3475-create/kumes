/* Kümes Defteri - çevrimdışı çalışan, çoklu kümeli güvercin yönetim uygulaması
   Veri: tarayıcı IndexedDB (sadece bu telefonda). Yedek: dosya + Google Drive (otomatik). */
(() => {
  'use strict';

  /* ============ YARDIMCILAR ============ */
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => ymd(new Date());
  const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return ymd(d); };
  const diffDays = (a, b) => Math.round((parseD(a) - parseD(b)) / 864e5);
  const fmt = s => (s ? s.split('-').reverse().join('.') : '');
  const fmtTime = t => (t ? new Date(t).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : 'hiç');
  const money = n => (n || n === 0 ? Number(n).toLocaleString('tr-TR') + ' ₺' : '');

  /* ============ VERİ KATMANI (IndexedDB) ============ */
  const DATA_STORES = ['lofts', 'birds', 'pairs', 'incubations', 'health', 'races', 'sales', 'notes'];
  const ALL_STORES = [...DATA_STORES, 'meta', 'snaps'];
  let db;
  const D = {}; DATA_STORES.forEach(s => (D[s] = []));
  let ST = {
    id: 'settings', loftId: null, autoDrive: false, clientId: '', wifiOnly: true, driveConsent: false,
    lastChange: 0, backedUpChange: 0, lastBackup: 0, lastFileBackup: 0, lastLocalSnap: 0, lastAttempt: 0, lastError: ''
  };

  function openDB() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('kumes-defteri', 1);
      r.onupgradeneeded = () => ALL_STORES.forEach(s => r.result.createObjectStore(s, { keyPath: 'id' }));
      r.onsuccess = () => { db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  }
  function tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const out = fn(t.objectStore(store));
      t.oncomplete = () => res(out && out.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  const rawAll = s => tx(s, 'readonly', o => o.getAll());
  async function loadAll() { for (const s of DATA_STORES) D[s] = await rawAll(s); }

  let backupTimer;
  function touch() {
    ST.lastChange = Date.now();
    saveST();
    clearTimeout(backupTimer);
    backupTimer = setTimeout(() => autoBackup(false), 120000); // son değişiklikten 2 dk sonra
  }
  function saveST() { return tx('meta', 'readwrite', o => o.put(ST)); }

  async function put(store, obj) {
    await tx(store, 'readwrite', o => o.put(obj));
    const i = D[store].findIndex(x => x.id === obj.id);
    if (i >= 0) D[store][i] = obj; else D[store].push(obj);
    touch();
  }
  async function del(store, id) {
    await tx(store, 'readwrite', o => o.delete(id));
    D[store] = D[store].filter(x => x.id !== id);
    touch();
  }

  /* ============ ŞEMALAR ============ */
  const OPT = {
    gender: ['ERKEK', 'DİŞİ', 'BİLİNMİYOR'],
    breed: ['POSTA', 'FİLO', 'OYUN', 'KOSTÜM', 'DİĞER'],
    btype: ['DAMIZLIK', 'YARIŞÇI'],
    bstatus: ['AKTİF', 'PASİF', 'SATILDI', 'KAYIP', 'ÖLEN'],
    pstatus: ['aktif', 'tamamlandı', 'ayrıldı', 'pasif'],
    istatus: ['devam ediyor', 'başarılı', 'başarısız', 'iptal'],
    hkind: ['Aşı', 'İlaç', 'Vitamin', 'Muayene', 'Diğer'],
    skind: ['SATIŞ', 'ALIŞ']
  };
  const SCHEMA = {
    lofts: {
      title: 'Kümes', fields: [
        { k: 'name', l: 'Kümes adı', t: 'text', req: 1 },
        { k: 'place', l: 'Yer / not', t: 'text' }
      ]
    },
    birds: {
      title: 'Kuş', fields: [
        { k: 'name', l: 'İsim', t: 'text', req: 1 },
        { k: 'ring', l: 'Künye (halka) no', t: 'text', req: 1 },
        { k: 'gender', l: 'Cinsiyet', t: 'sel', o: OPT.gender },
        { k: 'birthDate', l: 'Doğum tarihi', t: 'date' },
        { k: 'breed', l: 'Irk / uzmanlık', t: 'sel', o: OPT.breed },
        { k: 'type', l: 'Tür', t: 'sel', o: OPT.btype },
        { k: 'status', l: 'Durum', t: 'sel', o: OPT.bstatus },
        { k: 'color', l: 'Renk', t: 'text' },
        { k: 'lineage', l: 'Soy / hat', t: 'text' },
        { k: 'notes', l: 'Notlar', t: 'area' }
      ], def: { gender: 'BİLİNMİYOR', breed: 'POSTA', type: 'DAMIZLIK', status: 'AKTİF' }
    },
    pairs: {
      title: 'Eşleşme', fields: [
        { k: 'maleId', l: 'Erkek', t: 'bird', f: 'ERKEK' },
        { k: 'femaleId', l: 'Dişi', t: 'bird', f: 'DİŞİ' },
        { k: 'date', l: 'Eşleşme tarihi', t: 'date', today: 1 },
        { k: 'status', l: 'Durum', t: 'sel', o: OPT.pstatus },
        { k: 'notes', l: 'Notlar', t: 'area' }
      ], def: { status: 'aktif' }
    },
    incubations: {
      title: 'Kuluçka', fields: [
        { k: 'pairId', l: 'Eşleşme', t: 'pair' },
        { k: 'layDate', l: 'Yumurtlama tarihi', t: 'date', req: 1, today: 1 },
        { k: 'status', l: 'Durum', t: 'sel', o: OPT.istatus },
        { k: 'hatchDate', l: 'Gerçek çıkış tarihi', t: 'date' },
        { k: 'successful', l: 'Başarılı yavru sayısı', t: 'num' },
        { k: 'failed', l: 'Başarısız sayısı', t: 'num' },
        { k: 'notes', l: 'Notlar', t: 'area' }
      ], def: { status: 'devam ediyor' }
    },
    health: {
      title: 'Sağlık kaydı', fields: [
        { k: 'kind', l: 'Tür', t: 'sel', o: OPT.hkind },
        { k: 'name', l: 'Ad (ör. Paramiksovirüs)', t: 'text', req: 1 },
        { k: 'birdId', l: 'Kuş (boşsa tüm kümes)', t: 'bird' },
        { k: 'date', l: 'Tarih', t: 'date', req: 1, today: 1 },
        { k: 'nextDate', l: 'Sonraki tarih (tekrar)', t: 'date' },
        { k: 'notes', l: 'Notlar', t: 'area' }
      ], def: { kind: 'Aşı' }
    },
    races: {
      title: 'Yarış', fields: [
        { k: 'name', l: 'Yarış adı', t: 'text', req: 1 },
        { k: 'birdId', l: 'Kuş', t: 'bird' },
        { k: 'date', l: 'Tarih', t: 'date', today: 1 },
        { k: 'distance', l: 'Mesafe (km)', t: 'num' },
        { k: 'rank', l: 'Derece', t: 'num' },
        { k: 'total', l: 'Katılan kuş sayısı', t: 'num' },
        { k: 'notes', l: 'Notlar', t: 'area' }
      ]
    },
    sales: {
      title: 'Alış / Satış', fields: [
        { k: 'kind', l: 'İşlem', t: 'sel', o: OPT.skind },
        { k: 'birdId', l: 'Kuş', t: 'bird' },
        { k: 'date', l: 'Tarih', t: 'date', today: 1 },
        { k: 'person', l: 'Kişi', t: 'text' },
        { k: 'price', l: 'Tutar (₺)', t: 'num' },
        { k: 'notes', l: 'Notlar', t: 'area' }
      ], def: { kind: 'SATIŞ' }
    },
    notes: {
      title: 'Not', fields: [
        { k: 'title', l: 'Başlık', t: 'text', req: 1 },
        { k: 'date', l: 'Tarih', t: 'date', today: 1 },
        { k: 'text', l: 'Not', t: 'area' }
      ]
    }
  };

  /* ============ DURUM ============ */
  let loftId = null;
  let page = 'today';
  let breedTab = 'pairs';
  let bf = { q: '', g: '', all: false };
  const cur = s => D[s].filter(x => x.loftId === loftId);
  const bird = id => D.birds.find(b => b.id === id);
  const birdName = id => (id ? (bird(id) ? `${bird(id).name} (${bird(id).ring})` : '(silinmiş kuş)') : '');
  const pairLabel = id => {
    const p = D.pairs.find(x => x.id === id);
    if (!p) return '';
    return `${bird(p.maleId)?.name || '?'} ♂ × ${bird(p.femaleId)?.name || '?'} ♀`;
  };

  /* ============ GENEL UI ============ */
  function toast(msg) {
    const el = document.createElement('div');
    el.textContent = msg;
    $('#toast').appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }
  function closeModal() { $('#modal').innerHTML = ''; }
  function openModal(title, html) {
    $('#modal').innerHTML = `<div class="back" data-a="backdrop"><div class="sheet">
    <div class="head"><h2>${esc(title)}</h2><button class="x" data-a="close">✕</button></div>${html}</div></div>`;
  }

  const NAV = [
    ['today', '🏠', 'Bugün'], ['birds', '🕊', 'Kuşlar'], ['breed', '🥚', 'Üreme'], ['health', '💉', 'Sağlık'], ['more', '☰', 'Daha']
  ];

  function render() {
    const lofts = D.lofts;
    const pend = needsBackup();
    $('#app').innerHTML = `
  <header>
    <select id="loftSel">${lofts.map(l => `<option value="${l.id}" ${l.id === loftId ? 'selected' : ''}>🏠 ${esc(l.name)}</option>`).join('')}
      <option value="__new">＋ Yeni kümes…</option></select>
    <button class="btn sm ${pend ? '' : 'sec'}" data-a="goto" data-p="backup">${pend ? '⚠ Yedek' : '✓ Yedek'}</button>
  </header>
  <main>${pageHTML()}</main>
  <nav>${NAV.map(([k, ic, lb]) => `<button class="${isNav(k) ? 'on' : ''}" data-a="goto" data-p="${k}"><span>${ic}</span>${lb}</button>`).join('')}</nav>`;
    const fab = fabFor();
    if (fab) $('#app').insertAdjacentHTML('beforeend', `<button class="fab" data-a="add" data-s="${fab}">＋</button>`);
  }
  function isNav(k) {
    if (k === 'more') return ['more', 'races', 'sales', 'notes', 'lofts', 'backup'].includes(page);
    return page === k;
  }
  function fabFor() {
    if (page === 'birds') return 'birds';
    if (page === 'breed') return breedTab;
    if (['health', 'races', 'sales', 'notes'].includes(page)) return page;
    return null;
  }

  /* ============ SAYFALAR ============ */
  function pageHTML() {
    switch (page) {
      case 'today': return todayHTML();
      case 'birds': return birdsHTML();
      case 'breed': return breedHTML();
      case 'health': return listPage('health', 'Sağlık');
      case 'races': return listPage('races', 'Yarışlar', true);
      case 'sales': return listPage('sales', 'Alış / Satış', true);
      case 'notes': return listPage('notes', 'Notlar', true);
      case 'lofts': return loftsHTML();
      case 'backup': return backupHTML();
      default: return moreHTML();
    }
  }

  /* ---- Bugün ---- */
  function healthDue() {
    const t = today();
    return cur('health').filter(r => r.nextDate && r.nextDate <= addDays(t, 14) &&
      !cur('health').some(o => o.id !== r.id && o.name === r.name && (o.birdId || '') === (r.birdId || '') && o.date > r.date))
      .sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  }
  function todayHTML() {
    const t = today();
    const birds = cur('birds');
    const active = birds.filter(b => b.status === 'AKTİF');
    const inc = cur('incubations').filter(i => i.status === 'devam ediyor');
    const pairs = cur('pairs').filter(p => p.status === 'aktif');
    let h = `<h2>Bugün · ${fmt(t)}</h2>
    <div class="tiles">
      <div class="tile"><b>${active.length}</b><span>Aktif kuş</span></div>
      <div class="tile"><b>${pairs.length}</b><span>Aktif çift</span></div>
      <div class="tile"><b>${inc.length}</b><span>Kuluçka</span></div>
    </div>`;
    if (needsBackup() && (!ST.backedUpChange || Date.now() - Math.max(ST.lastBackup, ST.lastFileBackup) > 7 * 864e5)) {
      h += `<div class="banner" data-a="goto" data-p="backup">⚠ Yedeğin güncel değil. Son yedek: ${fmtTime(Math.max(ST.lastBackup, ST.lastFileBackup))}. Yedek ekranına git →</div>`;
    }
    h += `<h3>Kuluçka takibi</h3>`;
    if (!inc.length) h += `<div class="empty">Devam eden kuluçka yok.</div>`;
    inc.sort((a, b) => a.layDate.localeCompare(b.layDate)).forEach(i => {
      const day = diffDays(t, i.layDate) + 1;
      const s = addDays(i.layDate, 18), e = addDays(i.layDate, 21);
      const cls = day > 21 ? 'bad' : day >= 18 ? 'warn' : '';
      const msg = day > 21 ? `${day - 21} gün gecikti!` : day >= 18 ? 'Çıkım penceresi!' : `${18 - day} gün sonra çıkım başlar`;
      h += `<div class="card ${cls}" data-a="edit" data-s="incubations" data-id="${i.id}">
      <div class="row"><b class="grow">${esc(pairLabel(i.pairId) || 'Yumurta')}</b><span class="badge gold">${day}. gün</span></div>
      <div class="sub">Çıkış: ${fmt(s)} – ${fmt(e)} · ${msg}</div>
      <div class="bar"><i style="width:${Math.min(100, day / 21 * 100)}%"></i></div></div>`;
    });
    h += `<h3>Yaklaşan sağlık işlemleri</h3>`;
    const due = healthDue();
    if (!due.length) h += `<div class="empty">14 gün içinde yaklaşan işlem yok.</div>`;
    due.forEach(r => {
      const d = diffDays(r.nextDate, t);
      const cls = d < 0 ? 'bad' : d <= 3 ? 'warn' : '';
      h += `<div class="card ${cls}" data-a="edit" data-s="health" data-id="${r.id}">
      <div class="row"><b class="grow">${esc(r.kind)}: ${esc(r.name)}</b>
      <span class="badge ${d < 0 ? 'red' : 'gold'}">${d < 0 ? `${-d} gün geçti` : d === 0 ? 'Bugün' : `${d} gün`}</span></div>
      <div class="sub">${esc(r.birdId ? birdName(r.birdId) : 'Tüm kümes')} · ${fmt(r.nextDate)}</div></div>`;
    });
    h += `<div class="btns">
    <button class="btn sec sm" data-a="add" data-s="birds">＋ Kuş</button>
    <button class="btn sec sm" data-a="add" data-s="health">＋ Sağlık</button>
    <button class="btn sec sm" data-a="add" data-s="pairs">＋ Eşleşme</button></div>`;
    return h;
  }

  /* ---- Kuşlar ---- */
  function birdCard(b) {
    const th = b.photos && b.photos[0];
    const g = b.gender === 'ERKEK' ? '♂' : b.gender === 'DİŞİ' ? '♀' : '?';
    return `<div class="card row" data-a="bird" data-id="${b.id}">
    ${th ? `<img class="th" src="${th}" alt="">` : `<div class="th ph">🕊</div>`}
    <div class="grow"><b>${esc(b.name)}</b><div class="sub">${esc(b.ring)} · ${esc(b.breed || '')} · ${g}</div></div>
    <span class="badge ${b.status !== 'AKTİF' ? 'dim' : ''}">${esc(b.status || '')}</span></div>`;
  }
  function birdsFiltered() {
    const q = bf.q.trim().toLocaleLowerCase('tr');
    return cur('birds').filter(b =>
      (bf.all || b.status === 'AKTİF') && (!bf.g || b.gender === bf.g) &&
      (!q || `${b.name} ${b.ring} ${b.lineage || ''} ${b.color || ''}`.toLocaleLowerCase('tr').includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }
  function birdsHTML() {
    return `<h2>Kuşlar</h2>
  <div class="search">
    <input id="bq" placeholder="İsim, künye, renk ara…" value="${esc(bf.q)}">
    <select id="bg"><option value="">Hepsi</option>${OPT.gender.map(g => `<option ${bf.g === g ? 'selected' : ''}>${g}</option>`).join('')}</select>
  </div>
  <label class="chk"><input type="checkbox" id="ball" ${bf.all ? 'checked' : ''}> Aktif olmayanları da göster</label>
  <div id="blist" style="margin-top:10px">${birdListHTML()}</div>`;
  }
  function birdListHTML() {
    const l = birdsFiltered();
    return l.length ? l.map(birdCard).join('') : `<div class="empty">Kuş bulunamadı.<br>Sağ alttaki ＋ ile ekle.</div>`;
  }

  /* ---- Üreme (eşleşme + kuluçka) ---- */
  function breedHTML() {
    return `<h2>Üreme</h2><div class="seg">
    <button class="${breedTab === 'pairs' ? 'on' : ''}" data-a="btab" data-t="pairs">Eşleşmeler</button>
    <button class="${breedTab === 'incubations' ? 'on' : ''}" data-a="btab" data-t="incubations">Kuluçka</button></div>
    ${listBody(breedTab)}`;
  }

  /* ---- Genel liste ---- */
  function summary(s, r) {
    switch (s) {
      case 'pairs': {
        const n = cur('incubations').filter(i => i.pairId === r.id).length;
        return [`${bird(r.maleId)?.name || '?'} ♂ × ${bird(r.femaleId)?.name || '?'} ♀`, `${fmt(r.date)} · ${n} kuluçka`, r.status, r.status === 'aktif' ? '' : 'dim'];
      }
      case 'incubations': {
        const day = diffDays(today(), r.layDate) + 1;
        return [pairLabel(r.pairId) || 'Yumurta',
        `Yumurtlama ${fmt(r.layDate)} · Çıkış ${fmt(addDays(r.layDate, 18))}–${fmt(addDays(r.layDate, 21))}` +
        (r.successful || r.failed ? ` · ${r.successful || 0} başarılı/${r.failed || 0} başarısız` : ''),
        r.status === 'devam ediyor' ? `${day}. gün` : r.status, r.status === 'devam ediyor' ? 'gold' : 'dim'];
      }
      case 'health': return [`${r.kind}: ${r.name}`, `${r.birdId ? birdName(r.birdId) : 'Tüm kümes'} · ${fmt(r.date)}${r.nextDate ? ' → ' + fmt(r.nextDate) : ''}`, '', ''];
      case 'races': return [r.name, `${birdName(r.birdId)} · ${fmt(r.date)}${r.distance ? ' · ' + r.distance + ' km' : ''}`,
      r.rank ? `${r.rank}${r.total ? '/' + r.total : ''}.` : '', 'gold'];
      case 'sales': return [`${r.kind}: ${birdName(r.birdId) || '—'}`, `${r.person || ''} · ${fmt(r.date)}`, money(r.price), 'gold'];
      case 'notes': return [r.title, fmt(r.date), '', ''];
      default: return [r.name || r.id, '', '', ''];
    }
  }
  function listBody(s) {
    const l = cur(s).sort((a, b) => (b.date || b.layDate || '').localeCompare(a.date || a.layDate || ''));
    if (!l.length) return `<div class="empty">Kayıt yok. Sağ alttaki ＋ ile ekle.</div>`;
    return l.map(r => {
      const [t, sub, badge, cls] = summary(s, r);
      return `<div class="card row" data-a="edit" data-s="${s}" data-id="${r.id}">
      <div class="grow"><b>${esc(t)}</b><div class="sub">${esc(sub)}</div></div>
      ${badge ? `<span class="badge ${cls}">${esc(badge)}</span>` : ''}</div>`;
    }).join('');
  }
  function listPage(s, title, back) {
    return `<h2>${back ? `<button class="btn sec sm" data-a="goto" data-p="more">‹</button> ` : ''}${title}</h2>${listBody(s)}`;
  }

  /* ---- Daha ---- */
  function moreHTML() {
    const item = (p, ic, t, s) => `<div class="card row" data-a="goto" data-p="${p}"><span style="font-size:24px">${ic}</span>
    <div class="grow"><b>${t}</b><div class="sub">${s}</div></div><span>›</span></div>`;
    return `<h2>Daha fazla</h2>
    ${item('races', '🏁', 'Yarış sonuçları', `${cur('races').length} kayıt`)}
    ${item('sales', '💰', 'Alış / Satış', `${cur('sales').length} kayıt`)}
    ${item('notes', '📝', 'Notlar', `${cur('notes').length} kayıt`)}
    ${item('lofts', '🏠', 'Kümesler', `${D.lofts.length} kümes`)}
    ${item('backup', '☁️', 'Yedekleme ve ayarlar', needsBackup() ? '⚠ Yedek bekliyor' : '✓ Güncel')}`;
  }

  /* ---- Kümesler ---- */
  function loftsHTML() {
    return `<h2><button class="btn sec sm" data-a="goto" data-p="more">‹</button> Kümesler</h2>
  ${D.lofts.map(l => `<div class="card">
    <div class="row"><b class="grow">${esc(l.name)} ${l.id === loftId ? '<span class="badge">seçili</span>' : ''}</b></div>
    <div class="sub">${esc(l.place || '')} · ${D.birds.filter(b => b.loftId === l.id).length} kuş</div>
    <div class="btns">
      ${l.id !== loftId ? `<button class="btn sm" data-a="useLoft" data-id="${l.id}">Seç</button>` : ''}
      <button class="btn sec sm" data-a="edit" data-s="lofts" data-id="${l.id}">Düzenle</button>
      <button class="btn bad sm" data-a="delLoft" data-id="${l.id}">Sil</button></div></div>`).join('')}
  <button class="btn block" data-a="add" data-s="lofts">＋ Yeni kümes ekle</button>`;
  }

  /* ============ FORMLAR ============ */
  let formPhotos = [];
  function fieldHTML(f, v, schemaKey) {
    const val = v ?? '';
    const id = `f_${f.k}`;
    let inp = '';
    if (f.t === 'text') inp = `<input id="${id}" value="${esc(val)}">`;
    else if (f.t === 'num') inp = `<input id="${id}" type="number" inputmode="decimal" value="${esc(val)}">`;
    else if (f.t === 'date') inp = `<input id="${id}" type="date" value="${esc(val)}">`;
    else if (f.t === 'area') inp = `<textarea id="${id}">${esc(val)}</textarea>`;
    else if (f.t === 'sel') inp = `<select id="${id}">${f.o.map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else if (f.t === 'bird') {
      const l = cur('birds').filter(b => !f.f || b.gender === f.f || b.gender === 'BİLİNMİYOR' || b.id === val)
        .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
      inp = `<select id="${id}"><option value="">—</option>${l.map(b => `<option value="${b.id}" ${b.id === val ? 'selected' : ''}>${esc(b.name)} (${esc(b.ring)})</option>`).join('')}</select>`;
    } else if (f.t === 'pair') {
      inp = `<select id="${id}"><option value="">—</option>${cur('pairs').map(p => `<option value="${p.id}" ${p.id === val ? 'selected' : ''}>${esc(pairLabel(p.id))}</option>`).join('')}</select>`;
    }
    return `<label for="${id}">${esc(f.l)}${f.req ? ' *' : ''}</label>${inp}`;
  }
  function photosHTML() {
    return `<label>Fotoğraflar (en fazla 4)</label><div class="pthumbs" id="pthumbs">
    ${formPhotos.map((p, i) => `<div><img src="${p}" alt=""><button type="button" data-a="rmPhoto" data-i="${i}">✕</button></div>`).join('')}
  </div>${formPhotos.length < 4 ? `<input type="file" id="photoIn" accept="image/*" multiple style="margin-top:8px">` : ''}`;
  }
  function openForm(store, id, prefill) {
    const sc = SCHEMA[store];
    const ex = id ? D[store].find(x => x.id === id) : null;
    const v = ex || { ...(sc.def || {}), ...(prefill || {}) };
    if (!ex) sc.fields.forEach(f => { if (f.today && !v[f.k]) v[f.k] = today(); });
    if (store === 'birds') formPhotos = [...(ex?.photos || [])];
    const html = `<form id="form" data-s="${store}" data-id="${id || ''}" onsubmit="return false">
    ${sc.fields.map(f => fieldHTML(f, v[f.k], store)).join('')}
    ${store === 'birds' ? `<div id="photoBox">${photosHTML()}</div>` : ''}
    <div class="btns">
      <button type="button" class="btn" data-a="save">Kaydet</button>
      ${ex ? `<button type="button" class="btn bad" data-a="remove">Sil</button>` : ''}
      <button type="button" class="btn sec" data-a="close">Vazgeç</button></div></form>`;
    openModal(`${sc.title} ${ex ? 'düzenle' : 'ekle'}`, html);
  }
  async function saveForm() {
    const form = $('#form'); if (!form) return;
    const store = form.dataset.s, id = form.dataset.id;
    const sc = SCHEMA[store];
    const ex = id ? D[store].find(x => x.id === id) : null;
    const obj = { ...(ex || {}), id: id || uid() };
    if (store !== 'lofts') obj.loftId = loftId;
    for (const f of sc.fields) {
      let v = $('#f_' + f.k).value;
      if (f.t === 'num') v = v === '' ? '' : Number(v);
      if (f.t === 'text') v = v.trim();
      if (f.req && (v === '' || v == null)) { toast(`“${f.l}” gerekli`); return; }
      obj[f.k] = v;
    }
    if (store === 'birds') {
      obj.photos = formPhotos;
      const dup = cur('birds').find(b => b.ring.toLowerCase() === obj.ring.toLowerCase() && b.id !== obj.id);
      if (dup && !confirm(`Bu künye zaten kayıtlı: ${dup.name}. Yine de kaydedilsin mi?`)) return;
    }
    if (store === 'incubations' && obj.status === 'başarılı' && !obj.hatchDate) obj.hatchDate = today();
    if (store === 'sales' && obj.kind === 'SATIŞ' && obj.birdId) {
      const b = bird(obj.birdId);
      if (b && b.status !== 'SATILDI' && confirm(`${b.name} “SATILDI” olarak işaretlensin mi?`)) {
        await put('birds', { ...b, status: 'SATILDI', soldDate: obj.date });
      }
    }
    await put(store, obj);
    if (store === 'lofts' && !ex) { loftId = obj.id; ST.loftId = loftId; await saveST(); }
    closeModal(); render(); toast('Kaydedildi');
  }

  /* ---- Fotoğraf küçültme ---- */
  function shrink(file, max = 900, q = 0.72) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        res(c.toDataURL('image/jpeg', q));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Görsel okunamadı')); };
      img.src = url;
    });
  }

  /* ---- Kuş detayı ---- */
  function birdDetail(id) {
    const b = bird(id); if (!b) return;
    const rel = (s, key = 'birdId') => cur(s).filter(r => r[key] === id);
    const hl = rel('health').sort((a, c) => c.date.localeCompare(a.date)).slice(0, 5);
    const rl = rel('races').sort((a, c) => (c.date || '').localeCompare(a.date || '')).slice(0, 5);
    const kids = cur('birds').filter(k => k.pedigree && (k.pedigree.f?.ring === b.ring || k.pedigree.m?.ring === b.ring) && b.ring);
    openModal(b.name, `
    ${b.photos?.length ? `<div class="photos">${b.photos.map(p => `<img src="${p}" alt="">`).join('')}</div>` : ''}
    <dl class="kv">
      <dt>Künye</dt><dd><b>${esc(b.ring)}</b></dd>
      <dt>Cinsiyet</dt><dd>${esc(b.gender)}</dd>
      <dt>Doğum</dt><dd>${fmt(b.birthDate) || '—'}</dd>
      <dt>Irk / tür</dt><dd>${esc(b.breed || '')} · ${esc(b.type || '')}</dd>
      <dt>Durum</dt><dd>${esc(b.status)}${b.soldDate ? ' · ' + fmt(b.soldDate) : ''}</dd>
      <dt>Renk</dt><dd>${esc(b.color || '—')}</dd>
      <dt>Soy / hat</dt><dd>${esc(b.lineage || '—')}</dd>
      ${b.notes ? `<dt>Notlar</dt><dd>${esc(b.notes)}</dd>` : ''}
    </dl>
    ${hl.length ? `<h3>Son sağlık kayıtları</h3>${hl.map(r => `<div class="sub">• ${fmt(r.date)} ${esc(r.kind)}: ${esc(r.name)}</div>`).join('')}` : ''}
    ${rl.length ? `<h3>Yarışlar</h3>${rl.map(r => `<div class="sub">• ${fmt(r.date)} ${esc(r.name)} ${r.rank ? '→ ' + r.rank + (r.total ? '/' + r.total : '') + '.' : ''}</div>`).join('')}` : ''}
    ${kids.length ? `<h3>Pedigresinde ebeveyn olarak geçtiği kuşlar</h3>${kids.map(k => `<div class="sub">• ${esc(k.name)} (${esc(k.ring)})</div>`).join('')}` : ''}
    <div class="btns">
      <button class="btn" data-a="pedView" data-id="${id}">Pedigre</button>
      <button class="btn sec" data-a="pedEdit" data-id="${id}">Pedigre düzenle</button>
      <button class="btn sec" data-a="edit" data-s="birds" data-id="${id}">Düzenle</button>
      <button class="btn sec" data-a="addFor" data-s="health" data-id="${id}">＋ Sağlık</button>
      <button class="btn sec" data-a="addFor" data-s="races" data-id="${id}">＋ Yarış</button>
    </div>`);
  }

  /* ---- Pedigre ---- */
  const PKEYS = ['f', 'm', 'ff', 'fm', 'mf', 'mm', 'fff', 'ffm', 'fmf', 'fmm', 'mff', 'mfm', 'mmf', 'mmm'];
  const pLabel = k => [...k].map(c => (c === 'f' ? 'Baba' : 'Anne')).join(' › ');
  function pedEdit(id) {
    const b = bird(id); const p = b.pedigree || {};
    const grp = (title, keys) => `<h3>${title}</h3>${keys.map(k => `<div class="pgrp"><b>${pLabel(k)}</b>
    <div class="g3"><input data-pk="${k}" data-pf="ring" placeholder="Künye" value="${esc(p[k]?.ring || '')}">
    <input data-pk="${k}" data-pf="name" placeholder="İsim / hat" value="${esc(p[k]?.name || '')}">
    <textarea data-pk="${k}" data-pf="notes" placeholder="Başarılar, notlar">${esc(p[k]?.notes || '')}</textarea></div></div>`).join('')}`;
    openModal(`${b.name} · pedigre`, `<form id="pform" data-id="${id}" onsubmit="return false">
    ${grp('1. nesil · ebeveynler', ['f', 'm'])}${grp('2. nesil · dedeler', ['ff', 'fm', 'mf', 'mm'])}
    ${grp('3. nesil · büyük dedeler', ['fff', 'ffm', 'fmf', 'fmm', 'mff', 'mfm', 'mmf', 'mmm'])}
    <div class="btns"><button type="button" class="btn" data-a="pedSave">Kaydet</button>
    <button type="button" class="btn sec" data-a="close">Vazgeç</button></div></form>`);
  }
  async function pedSave() {
    const id = $('#pform').dataset.id; const b = bird(id); const p = {};
    document.querySelectorAll('#pform [data-pk]').forEach(el => {
      const k = el.dataset.pk; p[k] = p[k] || {}; p[k][el.dataset.pf] = el.value.trim();
    });
    await put('birds', { ...b, pedigree: p });
    toast('Pedigre kaydedildi'); pedView(id);
  }
  function pedView(id) {
    const b = bird(id); const p = b.pedigree || {};
    const cell = (k, r, c, span) => {
      const n = p[k] || {};
      return `<div class="c" style="grid-column:${c};grid-row:${r}/span ${span}"><span class="r">${esc(n.ring || '—')}</span><span class="n">${esc(n.name || '')}</span><span class="t">${esc(n.notes || '')}</span></div>`;
    };
    let g = `<div class="c root" style="grid-column:1;grid-row:1/span 8"><span class="r">${esc(b.ring)}</span><span class="n">${esc(b.name)}</span>
    <span class="t">${esc([b.breed, b.color, b.birthDate ? 'D: ' + fmt(b.birthDate) : ''].filter(Boolean).join(' · '))}</span></div>`;
    g += cell('f', 1, 2, 4) + cell('m', 5, 2, 4);
    ['ff', 'fm', 'mf', 'mm'].forEach((k, i) => (g += cell(k, i * 2 + 1, 3, 2)));
    ['fff', 'ffm', 'fmf', 'fmm', 'mff', 'mfm', 'mmf', 'mmm'].forEach((k, i) => (g += cell(k, i + 1, 4, 1)));
    openModal(`${b.name} · pedigre`, `<div class="print-area"><h2 style="color:#111">KÜMES DEFTERİ · PEDİGRE</h2><div class="ped">${g}</div></div>
    <div class="btns"><button class="btn" data-a="pedShare" data-id="${id}" data-t="png">Görsel olarak paylaş</button>
    <button class="btn" data-a="pedShare" data-id="${id}" data-t="pdf">PDF olarak paylaş</button>
    <button class="btn sec" data-a="pedEdit" data-id="${id}">Düzenle</button>
    <button class="btn sec" data-a="bird" data-id="${id}">‹ Kuşa dön</button></div>`);
  }


  /* ---- Pedigre: görsel / PDF paylaş ---- */
  function pedCanvas(b) {
    const p = b.pedigree || {};
    const W = 1754, H = 1240, M = 50, top = 130, bot = H - 50;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#111'; x.font = 'bold 40px sans-serif'; x.textBaseline = 'alphabetic';
    x.fillText('PEDİGRE', M, 70);
    x.font = '24px sans-serif'; x.fillStyle = '#555';
    x.fillText(`${b.name} · ${b.ring}`, M, 105);
    const colW = (W - 2 * M - 3 * 20) / 4, rowH = (bot - top) / 8;
    const fit = (t, w) => { let s = String(t || ''); while (s && x.measureText(s).width > w) s = s.slice(0, -1); return s; };
    const box = (col, r, span, ring, name, notes, root) => {
      const bx = M + col * (colW + 20), by = top + r * rowH + 4, bw = colW, bh = span * rowH - 8;
      x.fillStyle = root ? '#fef3c7' : '#f8fafc'; x.fillRect(bx, by, bw, bh);
      x.strokeStyle = '#334155'; x.lineWidth = 2; x.strokeRect(bx, by, bw, bh);
      const mid = by + bh / 2;
      const lines = [[ring || '—', 'bold 26px sans-serif', '#111'], [name, '22px sans-serif', '#222'], [notes, '18px sans-serif', '#555']].filter(l => l[0]);
      const lh = bh < 100 ? 24 : 30; let y = mid - (lines.length - 1) * lh / 2 + 8;
      if (bh < 100) { lines.length = Math.min(lines.length, 2); y = mid - (lines.length - 1) * lh / 2 + 8; }
      lines.forEach(([t, f, col2]) => { x.font = f; x.fillStyle = col2; x.fillText(fit(t, bw - 24), bx + 12, y); y += lh; });
    };
    box(0, 0, 8, b.ring, b.name, [b.breed, b.color, b.birthDate ? 'D: ' + fmt(b.birthDate) : ''].filter(Boolean).join(' · '), true);
    const g = k => p[k] || {};
    box(1, 0, 4, g('f').ring, g('f').name, g('f').notes); box(1, 4, 4, g('m').ring, g('m').name, g('m').notes);
    ['ff', 'fm', 'mf', 'mm'].forEach((k, i) => box(2, i * 2, 2, g(k).ring, g(k).name, g(k).notes));
    ['fff', 'ffm', 'fmf', 'fmm', 'mff', 'mfm', 'mmf', 'mmm'].forEach((k, i) => box(3, i, 1, g(k).ring, g(k).name, g(k).notes));
    x.font = '18px sans-serif'; x.fillStyle = '#888'; x.textAlign = 'right';
    x.fillText('Kümes Defteri · ' + fmt(today()), W - M, H - 18);
    return c;
  }
  function makePdf(jpegBytes, iw, ih) {
    const enc = s => new TextEncoder().encode(s);
    const pw = 842, ph = 595, k = Math.min(pw / iw, ph / ih), w = iw * k, h = ih * k;
    const content = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${((pw - w) / 2).toFixed(2)} ${((ph - h) / 2).toFixed(2)} cm /Im0 Do Q`;
    const parts = []; const offs = []; let len = 0;
    const add = u => { parts.push(u); len += u.length; };
    add(enc('%PDF-1.4\n'));
    const obj = (n, head, stream) => {
      offs[n] = len;
      add(enc(`${n} 0 obj\n${head}\n`));
      if (stream) { add(enc('stream\n')); add(stream); add(enc('\nendstream\n')); }
      add(enc('endobj\n'));
    };
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
    obj(4, `<< /Type /XObject /Subtype /Image /Width ${iw} /Height ${ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>`, jpegBytes);
    obj(5, `<< /Length ${content.length} >>`, enc(content));
    const xref = len;
    let t = `xref\n0 6\n0000000000 65535 f \n`;
    for (let i = 1; i <= 5; i++) t += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
    add(enc(t + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`));
    const out = new Uint8Array(len); let p = 0;
    parts.forEach(u => { out.set(u, p); p += u.length; });
    return out;
  }
  async function pedShare(id, type) {
    const b = bird(id); if (!b) return;
    const cv = pedCanvas(b);
    const base = `pedigre-${(b.ring || b.name).replace(/[^\w\-]+/g, '_')}`;
    let file;
    if (type === 'pdf') {
      const du = cv.toDataURL('image/jpeg', 0.92);
      const bin = atob(du.split(',')[1]); const jb = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) jb[i] = bin.charCodeAt(i);
      file = new File([makePdf(jb, cv.width, cv.height)], base + '.pdf', { type: 'application/pdf' });
    } else {
      const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
      file = new File([blob], base + '.png', { type: 'image/png' });
    }
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Pedigre · ' + b.name }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast('Dosya indirildi');
  }

  /* ============ YEDEKLEME ============ */
  const APP_ID = 'kumes-defteri';
  function buildBackup() {
    const data = {}; DATA_STORES.forEach(s => (data[s] = D[s]));
    return JSON.stringify({ app: APP_ID, v: 1, at: new Date().toISOString(), data });
  }
  function validateBackup(o) {
    if (!o || o.app !== APP_ID || typeof o.data !== 'object') throw new Error('Bu dosya bir Kümes Defteri yedeği değil.');
    for (const s of DATA_STORES) {
      const a = o.data[s];
      if (a === undefined) continue;
      if (!Array.isArray(a) || a.some(x => !x || typeof x.id !== 'string')) throw new Error(`Yedek bozuk (${s}).`);
    }
    return o;
  }
  function needsBackup() { return ST.lastChange > (ST.backedUpChange || 0); }

  async function restoreData(data, mode) {
    await takeSnapshot('geri yükleme öncesi');
    for (const s of DATA_STORES) {
      const arr = data[s] || [];
      await tx(s, 'readwrite', o => { if (mode === 'replace') o.clear(); arr.forEach(x => o.put(x)); });
    }
    await loadAll();
    if (!D.lofts.length) await ensureLoft();
    if (!D.lofts.find(l => l.id === loftId)) loftId = D.lofts[0].id;
    ST.loftId = loftId; touch(); render();
  }

  /* ---- Yerel anlık görüntü (hatalara karşı, telefon kaybına karşı değil) ---- */
  async function takeSnapshot(reason) {
    const snaps = await rawAll('snaps');
    await tx('snaps', 'readwrite', o => o.put({ id: 's' + Date.now(), at: Date.now(), reason, json: buildBackup() }));
    const all = (await rawAll('snaps')).sort((a, b) => b.at - a.at);
    for (const s of all.slice(3)) await tx('snaps', 'readwrite', o => o.delete(s.id));
    ST.lastLocalSnap = Date.now(); await saveST();
    return snaps.length;
  }

  /* ---- Dosya ile yedek ---- */
  async function exportFile() {
    const json = buildBackup();
    const name = `kumes-yedek-${today()}.json`;
    const file = new File([json], name, { type: 'application/json' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Kümes yedeği' });
        markFileBackup(); return;
      }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    markFileBackup();
  }
  function markFileBackup() { ST.lastFileBackup = Date.now(); ST.backedUpChange = ST.lastChange; saveST(); render(); backupRefresh(); toast('Yedek dosyası hazır'); }

  function importPicked(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const o = validateBackup(JSON.parse(r.result));
        pendingImport = o.data;
        const c = s => (o.data[s] || []).length;
        openModal('Yedekten yükle', `<div class="card"><b>Yedek tarihi:</b> ${fmtTime(o.at)}<br>
        ${c('lofts')} kümes · ${c('birds')} kuş · ${c('pairs')} eşleşme · ${c('incubations')} kuluçka · ${c('health')} sağlık</div>
        <p class="sub"><b>Birleştir:</b> yedekteki kayıtlar eklenir/güncellenir, mevcutlar silinmez.<br>
        <b>Tamamen değiştir:</b> şu anki tüm veri silinip yedek yüklenir (öncesinde otomatik yerel kopya alınır).</p>
        <div class="btns"><button class="btn" data-a="doImport" data-m="merge">Birleştir</button>
        <button class="btn bad" data-a="doImport" data-m="replace">Tamamen değiştir</button>
        <button class="btn sec" data-a="close">Vazgeç</button></div>`);
      } catch (e) { toast(e.message || 'Dosya okunamadı'); }
    };
    r.readAsText(file);
  }
  let pendingImport = null;

  /* ---- Google Drive ---- */
  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  let token = null, tokenExp = 0, busy = false;
  function loadGIS() {
    return new Promise((res, rej) => {
      if (window.google && google.accounts && google.accounts.oauth2) return res();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = res; s.onerror = () => rej(new Error('Google bağlantısı kurulamadı (internet?)'));
      document.head.appendChild(s);
    });
  }
  function getToken() {
    if (token && Date.now() < tokenExp - 60000) return Promise.resolve(token);
    if (!ST.clientId) return Promise.reject(new Error('Google istemci kimliği (Client ID) girilmemiş'));
    return loadGIS().then(() => new Promise((res, rej) => {
      const tc = google.accounts.oauth2.initTokenClient({
        client_id: ST.clientId, scope: SCOPE,
        callback: r => {
          if (r.error) return rej(new Error(r.error));
          token = r.access_token; tokenExp = Date.now() + (r.expires_in || 3600) * 1000;
          ST.driveConsent = true; saveST(); res(token);
        },
        error_callback: e => rej(new Error((e && e.type) || 'popup_failed'))
      });
      tc.requestAccessToken({ prompt: ST.driveConsent ? '' : 'consent' });
    }));
  }
  async function gapi(path, opts, tok) {
    const r = await fetch('https://www.googleapis.com' + path, { ...opts, headers: { Authorization: 'Bearer ' + tok, ...(opts && opts.headers) } });
    if (r.status === 401) { token = null; throw new Error('Yetki süresi doldu, tekrar dene'); }
    if (!r.ok) throw new Error('Drive hatası ' + r.status);
    return r;
  }
  async function driveList(tok) {
    const q = new URLSearchParams({ spaces: 'appDataFolder', fields: 'files(id,name,modifiedTime,size)', orderBy: 'modifiedTime desc', pageSize: '100' });
    return (await (await gapi('/drive/v3/files?' + q, {}, tok)).json()).files || [];
  }
  async function driveUpload(tok, name, text, existingId) {
    const meta = existingId ? { name } : { name, parents: ['appDataFolder'] };
    const b = 'kb' + Math.random().toString(36).slice(2);
    const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${b}--`;
    return gapi(`/upload/drive/v3/files${existingId ? '/' + existingId : ''}?uploadType=multipart`,
      { method: existingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body }, tok);
  }
  function wifiOk() {
    if (!ST.wifiOnly) return true;
    const c = navigator.connection;
    if (c && c.type && !['wifi', 'ethernet', 'unknown', 'other'].includes(c.type)) return false; // hücresel
    if (c && c.saveData) return false;
    return true; // iPhone'da bağlantı türü okunamaz: çevrimiçi ise devam
  }
  async function runDriveBackup() {
    const tok = await getToken();
    const stamp = ST.lastChange;
    const json = buildBackup();
    const name = `kumes-yedek-${today()}.json`;
    const files = await driveList(tok);
    const same = files.find(f => f.name === name);
    await driveUpload(tok, name, json, same && same.id);
    const olds = files.filter(f => f.name.startsWith('kumes-yedek-') && f.name !== name).sort((a, b) => b.name.localeCompare(a.name)).slice(6);
    for (const f of olds) { try { await gapi('/drive/v3/files/' + f.id, { method: 'DELETE' }, tok); } catch (_) { } }
    ST.lastBackup = Date.now(); ST.backedUpChange = Math.max(ST.backedUpChange, stamp); ST.lastError = ''; await saveST();
  }
  async function autoBackup(force) {
    if (busy || !ST.autoDrive || !ST.clientId) return;
    if (!force) {
      if (!needsBackup() || !navigator.onLine || !wifiOk()) return;
      if (Date.now() - ST.lastAttempt < 15 * 60000) return;
    }
    busy = true; ST.lastAttempt = Date.now();
    try { await runDriveBackup(); if (!force) toast('Drive yedeği alındı'); }
    catch (e) { ST.lastError = e.message || String(e); await saveST(); }
    finally { busy = false; render(); backupRefresh(); }
  }
  async function driveNow() {
    if (!ST.clientId) { toast('Önce Client ID gir'); return; }
    if (!navigator.onLine) { toast('İnternet yok'); return; }
    busy = false; ST.autoDrive = ST.autoDrive; await autoBackup(true);
    toast(ST.lastError ? 'Yedek alınamadı' : 'Drive yedeği alındı');
  }
  async function driveRestorePick() {
    try {
      if (!navigator.onLine) throw new Error('İnternet yok');
      const tok = await getToken();
      const files = (await driveList(tok)).filter(f => f.name.startsWith('kumes-yedek-'));
      if (!files.length) return toast('Drive’da yedek bulunamadı');
      openModal('Drive yedekleri', files.map(f => `<div class="card row" data-a="driveGet" data-id="${f.id}">
      <div class="grow"><b>${esc(f.name)}</b><div class="sub">${fmtTime(f.modifiedTime)} · ${Math.round((f.size || 0) / 1024)} KB</div></div><span>›</span></div>`).join(''));
    } catch (e) { toast(e.message); }
  }
  async function driveGet(id) {
    try {
      const tok = await getToken();
      const txt = await (await gapi(`/drive/v3/files/${id}?alt=media`, {}, tok)).text();
      const o = validateBackup(JSON.parse(txt));
      importPicked(new File([JSON.stringify(o)], 'x.json'));
    } catch (e) { toast(e.message); }
  }

  /* ---- Yedek sayfası ---- */
  async function storageInfo() {
    try {
      const e = await navigator.storage.estimate();
      const p = navigator.storage.persisted ? await navigator.storage.persisted() : null;
      return `${((e.usage || 0) / 1048576).toFixed(1)} MB kullanılıyor · kalıcı depolama: ${p ? 'evet' : 'hayır'}`;
    } catch (_) { return ''; }
  }
  function backupHTML() {
    const last = Math.max(ST.lastBackup, ST.lastFileBackup);
    return `<h2><button class="btn sec sm" data-a="goto" data-p="more">‹</button> Yedekleme</h2>
  <div class="card ${needsBackup() ? 'warn' : 'good'}">
    <b>${needsBackup() ? '⚠ Yedeklenmemiş değişiklik var' : '✓ Her şey yedekte'}</b>
    <div class="sub">Son yedek: ${fmtTime(last)} (Drive: ${fmtTime(ST.lastBackup)} · dosya: ${fmtTime(ST.lastFileBackup)})</div>
    ${ST.lastError ? `<div class="sub" style="color:#fca5a5">Son hata: ${esc(ST.lastError)}</div>` : ''}
  </div>

  <h3>1 · Dosya olarak yedek (her zaman çalışır)</h3>
  <div class="card"><div class="sub">Tüm kümeler, fotoğraflar dahil tek dosya. Paylaş menüsünden iCloud Drive / Google Drive / WhatsApp / Dosyalar’a kaydet.</div>
    <button class="btn block" data-a="exportFile">Yedek dosyası oluştur ve paylaş</button>
    <button class="btn sec block" data-a="pickFile">Yedek dosyasından yükle</button>
    <input type="file" id="fileIn" accept=".json,application/json" style="display:none"></div>

  <h3>2 · Otomatik yedek (Google Drive)</h3>
  <div class="card">
    <label class="chk"><input type="checkbox" data-c="autoDrive" ${ST.autoDrive ? 'checked' : ''}> İnternet/Wi‑Fi olunca otomatik yedek al</label>
    <label class="chk"><input type="checkbox" data-c="wifiOnly" ${ST.wifiOnly ? 'checked' : ''}> Sadece Wi‑Fi’de (Android’de çalışır; iPhone’da bağlantı türü okunamaz, internet varsa alır)</label>
    <label for="cid">Google Client ID (kurulum kılavuzuna bak)</label>
    <input id="cid" data-c="clientId" value="${esc(ST.clientId)}" placeholder="xxxx.apps.googleusercontent.com">
    <div class="btns"><button class="btn sm" data-a="driveNow">Şimdi yedekle</button>
    <button class="btn sec sm" data-a="driveRestore">Drive’dan geri yükle</button></div>
    <div class="sub" style="margin-top:8px">Yedekler Google Drive’ında, sadece bu uygulamanın görebildiği gizli klasörde tutulur. Son 7 gün saklanır.</div>
  </div>

  <h3>3 · Yerel kopyalar (hataya karşı)</h3>
  <div class="card"><div class="sub">Telefonda tutulan son 3 kopya. Yanlışlıkla silme/değiştirmeye karşıdır; telefon kaybolursa işe yaramaz.</div>
    <div id="snapList"><div class="sub">Yükleniyor…</div></div>
    <button class="btn sec block" data-a="snapNow">Şimdi yerel kopya al</button></div>
  <div class="sub" id="stInfo"></div>`;
  }
  async function backupRefresh() {
    if (page !== 'backup') return;
    const sl = $('#snapList'); if (!sl) return;
    const snaps = (await rawAll('snaps')).sort((a, b) => b.at - a.at);
    sl.innerHTML = snaps.length ? snaps.map(s => `<div class="row" style="margin-top:8px"><div class="grow sub">${fmtTime(s.at)} · ${esc(s.reason || 'otomatik')}</div>
    <button class="btn sec sm" data-a="snapRestore" data-id="${s.id}">Geri yükle</button></div>`).join('') : '<div class="sub">Henüz yok.</div>';
    const si = $('#stInfo'); if (si) si.textContent = await storageInfo();
  }

  /* ============ KÜMES İŞLEMLERİ ============ */
  async function ensureLoft() {
    if (D.lofts.length) return;
    const l = { id: uid(), name: 'Kümesim', place: '' };
    await put('lofts', l); loftId = l.id; ST.loftId = l.id; await saveST();
  }
  async function deleteLoft(id) {
    const l = D.lofts.find(x => x.id === id); if (!l) return;
    if (D.lofts.length < 2) return toast('Son kümes silinemez');
    if (!confirm(`“${l.name}” ve içindeki TÜM kayıtlar silinsin mi? (Öncesinde yerel kopya alınır)`)) return;
    await takeSnapshot(`“${l.name}” silinmeden önce`);
    for (const s of DATA_STORES) {
      if (s === 'lofts') continue;
      for (const r of D[s].filter(x => x.loftId === id)) await del(s, r.id);
    }
    await del('lofts', id);
    if (loftId === id) { loftId = D.lofts[0].id; ST.loftId = loftId; await saveST(); }
    render(); toast('Kümes silindi');
  }

  /* ============ OLAYLAR ============ */
  const actions = {
    backdrop(d, e) { if (e.target.classList.contains('back')) closeModal(); },
    close: closeModal,
    goto(d) { page = d.p; closeModal(); render(); if (page === 'backup') backupRefresh(); window.scrollTo(0, 0); },
    btab(d) { breedTab = d.t; render(); },
    add(d) { openForm(d.s, null); },
    addFor(d) { openForm(d.s, null, { birdId: d.id }); },
    edit(d) { openForm(d.s, d.id); },
    bird(d) { birdDetail(d.id); },
    save: saveForm,
    async remove() {
      const f = $('#form'); const s = f.dataset.s, id = f.dataset.id;
      if (s === 'lofts') return actions.delLoft({ id });
      if (!confirm('Bu kayıt silinsin mi?')) return;
      await del(s, id); closeModal(); render(); toast('Silindi');
    },
    rmPhoto(d) { formPhotos.splice(+d.i, 1); $('#photoBox').innerHTML = photosHTML(); },
    pedView(d) { pedView(d.id); }, pedEdit(d) { pedEdit(d.id); }, pedSave,
    pedShare(d) { pedShare(d.id, d.t); },
    useLoft(d) { loftId = d.id; ST.loftId = d.id; saveST(); render(); },
    delLoft(d) { closeModal(); deleteLoft(d.id); },
    exportFile,
    pickFile() { $('#fileIn').click(); },
    async doImport(d) { if (!pendingImport) return; const x = pendingImport; pendingImport = null; closeModal(); await restoreData(x, d.m); toast('Yedek yüklendi'); },
    driveNow, driveRestore: driveRestorePick, driveGet(d) { closeModal(); driveGet(d.id); },
    async snapNow() { await takeSnapshot('elle'); backupRefresh(); toast('Yerel kopya alındı'); },
    async snapRestore(d) {
      const s = (await rawAll('snaps')).find(x => x.id === d.id); if (!s) return;
      if (!confirm('Bu kopya yüklensin mi? Mevcut veri değiştirilecek.')) return;
      await restoreData(JSON.parse(s.json).data, 'replace'); toast('Kopya yüklendi');
    }
  };
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-a]');
    if (!el) return;
    const fn = actions[el.dataset.a];
    if (fn) fn(el.dataset, e);
  });
  document.addEventListener('change', async e => {
    const t = e.target;
    if (t.id === 'loftSel') {
      if (t.value === '__new') { t.value = loftId; openForm('lofts', null); return; }
      loftId = t.value; ST.loftId = loftId; await saveST(); render(); return;
    }
    if (t.id === 'bg') { bf.g = t.value; $('#blist').innerHTML = birdListHTML(); return; }
    if (t.id === 'ball') { bf.all = t.checked; $('#blist').innerHTML = birdListHTML(); return; }
    if (t.id === 'fileIn' && t.files[0]) { importPicked(t.files[0]); t.value = ''; return; }
    if (t.id === 'photoIn') {
      for (const f of [...t.files].slice(0, 4 - formPhotos.length)) {
        try { formPhotos.push(await shrink(f)); } catch (_) { toast('Görsel okunamadı'); }
      }
      $('#photoBox').innerHTML = photosHTML(); return;
    }
    if (t.dataset.c === 'autoDrive') { ST.autoDrive = t.checked; await saveST(); if (t.checked) autoBackup(false); }
    if (t.dataset.c === 'wifiOnly') { ST.wifiOnly = t.checked; await saveST(); }
    if (t.dataset.c === 'clientId') { ST.clientId = t.value.trim(); ST.driveConsent = false; token = null; await saveST(); }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'bq') { bf.q = e.target.value; $('#blist').innerHTML = birdListHTML(); }
  });
  window.addEventListener('online', () => autoBackup(false));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoBackup(false); });

  /* ============ BAŞLAT ============ */
  async function init() {
    await openDB();
    const saved = (await rawAll('meta')).find(m => m.id === 'settings');
    if (saved) ST = { ...ST, ...saved };
    await loadAll();
    await ensureLoft();
    loftId = D.lofts.find(l => l.id === ST.loftId) ? ST.loftId : D.lofts[0].id;
    ST.loftId = loftId; await saveST();
    render();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
    // günde bir yerel kopya (değişiklik varsa)
    if (ST.lastChange > ST.lastLocalSnap && Date.now() - ST.lastLocalSnap > 864e5) takeSnapshot('otomatik günlük');
    autoBackup(false);
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
  }
  init().catch(e => { document.body.innerHTML = `<pre style="padding:20px;color:#fca5a5">Başlatılamadı: ${esc(e.message || e)}</pre>`; });

  // test için
  window.__kumes = { pedCanvas, makePdf, D, get ST() { return ST; }, buildBackup, restoreData, validateBackup, put, addDays, diffDays };
})();