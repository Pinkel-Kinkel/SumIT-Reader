(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let db;
  function openDb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('sumit-reader', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('items', { keyPath: 'id' }); r.result.createObjectStore('files'); };
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
  }
  const done = tx => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
  const all = store => new Promise((resolve, reject) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
  const getFile = key => new Promise((resolve, reject) => { const q = db.transaction('files').objectStore('files').get(key); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });

  function say(text, err) { const s = $('status'); s.textContent = text || ''; s.classList.toggle('err', !!err); }
  const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const unzip = data => new Promise((resolve, reject) => fflate.unzip(data, (err, out) => err ? reject(err) : resolve(out)));
  const text = u8 => fflate.strFromU8(u8);

  async function addZip(file) {
    const entries = await unzip(new Uint8Array(await file.arrayBuffer()));
    const manifestRaw = entries['sumit-share.json'];
    if (!manifestRaw) throw new Error('זה לא קובץ סיכום של SumIT (חסר sumit-share.json)');
    const manifest = JSON.parse(text(manifestRaw));
    const entry = String(manifest.entry || '');
    if (!entry || !entries[entry]) throw new Error('הסיכום עצמו חסר בקובץ');
    const names = Object.keys(entries).filter(n => n.startsWith('files/') && !n.endsWith('/'));
    for (const n of names) if (n.split('/').includes('..') || n.includes('\\')) throw new Error('הקובץ מכיל נתיב לא בטוח');
    const html = text(entries[entry]);
    const title = ((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || file.name.replace(/\.zip$/i, '')).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    const lecture = (/הרצאה\s*\d+/.exec(decodeURIComponent(entry)) || [''])[0];
    const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
    const pdfs = names.filter(n => /\.pdf$/i.test(n)).map(n => n.slice(0)); // keys are stored with the "files/" prefix removed below
    // Adding the same summary again replaces the old copy.
    const old = (await all('items')).filter(x => x.entry === entry.slice('files/'.length) && x.title === title);
    const tx = db.transaction(['files', 'items'], 'readwrite'); const files = tx.objectStore('files'); let size = 0;
    for (const n of names) { const rel = n.slice('files/'.length); files.put(entries[n].slice().buffer, id + '/' + rel); size += entries[n].length; }
    tx.objectStore('items').put({ id, title, lecture, entry: entry.slice('files/'.length), pdfs: pdfs.map(p => p.slice('files/'.length)), size, added: Date.now() });
    await done(tx);
    for (const o of old) await remove(o.id, true);
    return title;
  }

  async function remove(id, quiet) {
    const keys = await new Promise((resolve, reject) => { const q = db.transaction('files').objectStore('files').getAllKeys(); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
    const tx = db.transaction(['files', 'items'], 'readwrite');
    keys.filter(k => String(k).startsWith(id + '/')).forEach(k => tx.objectStore('files').delete(k));
    tx.objectStore('items').delete(id);
    await done(tx); if (!quiet) render();
  }

  async function render() {
    const items = (await all('items')).sort((a, b) => b.added - a.added), list = $('list');
    list.textContent = ''; $('empty').hidden = items.length > 0;
    items.forEach(it => {
      const row = document.createElement('div'); row.className = 'item';
      const info = document.createElement('div'); info.className = 'info';
      const b = document.createElement('b'); b.textContent = it.title; const s = document.createElement('small');
      s.textContent = [it.lecture, fmtSize(it.size)].filter(Boolean).join(' · ');
      info.append(b, s);
      const open = document.createElement('button'); open.className = 'open'; open.textContent = 'פתח'; open.onclick = () => openItem(it);
      const del = document.createElement('button'); del.className = 'del'; del.title = 'מחק'; del.textContent = '✕'; del.setAttribute('aria-label', 'מחק');
      del.onclick = () => { if (confirm('למחוק את הסיכום מהמכשיר? הקובץ ב-OneDrive לא ייפגע.')) remove(it.id); };
      row.append(info, open, del); list.append(row);
    });
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => { $('storage').textContent = 'שימוש באחסון: \u2066' + fmtSize(e.usage || 0) + '\u2069' + (e.quota ? ' מתוך \u2066' + fmtSize(e.quota) + '\u2069' : ''); });
  }

  async function ready() {
    if (!('serviceWorker' in navigator)) throw new Error('הדפדפן הזה לא תומך בפתיחת סיכומים (נדרש Service Worker)');
    const reg = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(r => { navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }); setTimeout(r, 1500); });
    return reg;
  }

  async function openItem(it) {
    try { await ready(); } catch (e) { say(e.message, true); return; }
    $('vtitle').textContent = it.title; $('library').hidden = true; $('viewer').hidden = false;
    const url = 'v/' + it.id + '/' + it.entry.split('/').map(encodeURIComponent).join('/');
    $('frame').src = url;
    const pdf = it.pdfs && it.pdfs[0]; $('pdf').hidden = !pdf;
    $('pdf').onclick = async () => {
      const rec = await getFile(it.id + '/' + pdf); if (!rec) return;
      window.open(URL.createObjectURL(new Blob([rec], { type: 'application/pdf' })), '_blank');
    };
    history.pushState({ v: 1 }, '');
  }
  function closeViewer() { $('viewer').hidden = true; $('library').hidden = false; $('frame').src = 'about:blank'; }
  $('back').onclick = () => { if (history.state && history.state.v) history.back(); else closeViewer(); };
  addEventListener('popstate', () => { if (!$('viewer').hidden) closeViewer(); });

  $('file').onchange = async e => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    for (const f of files) {
      say('טוען: ' + f.name + '...');
      try { const t = await addZip(f); say('נוסף: ' + t); }
      catch (err) { say(f.name + ': ' + (err && err.message || err), true); break; }
    }
    render();
  };

  (async function start() {
    db = await openDb();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => say('לא ניתן להפעיל מצב לא מקוון בדפדפן הזה', true));
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
    render();
  })();
})();