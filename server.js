// ============================================================
//  דירוג קייטנות – בית ספר הגפן
//  שרת בלי שום התקנה: רק Node.js. אין npm install, אין חבילות.
//  הרצה:  node server.js    ואז פותחים http://localhost:3000
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_CODE = process.env.ADMIN_CODE || '1108'; // קוד להפיכת משתמש למנהל
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- הקייטנות של בית עמנואל רמת גן ----------
// הרשימה נטענת מהקובץ camps.json שנמצא בתיקייה, כדי שיהיה קל לערוך אותה.
// אפשר גם להוסיף, למחוק ולערוך קייטנות ישירות באתר, במסך "ניהול קייטנות".
function loadSeedCamps() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'camps.json'), 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

// כל השדות שקיימים לקייטנה
const CAMP_FIELDS = ['name','emoji','category','description','organizer','ages','grades',
                     'dates','hours','place','address','price','includes','bring',
                     'phone','link','notes'];
const blankCamp = () => Object.fromEntries(CAMP_FIELDS.map(f => [f, '']));

// ---------- מסד נתונים פשוט: קובץ JSON אחד ----------
// במחשב בבית – נשמר בקובץ data.json.
// באינטרנט – אם קיים משתנה DATABASE_URL, הכול נשמר במסד נתונים אמיתי (Postgres),
// כדי שהדירוגים לא יימחקו כשהשרת נכבה ונדלק.
const PG_URL = process.env.DATABASE_URL || '';
let pg = null, db;

const emptyDb = () => ({ users: [], camps: [], messages: [], reviews: [], sessions: {}, nextId: 1 });

async function load() {
  if (PG_URL) {
    try {
      const { Client } = require('pg');
      pg = new Client({ connectionString: PG_URL,
                        ssl: PG_URL.includes('localhost') ? false : { rejectUnauthorized: false } });
      await pg.connect();
      await pg.query('CREATE TABLE IF NOT EXISTS app_state (id int PRIMARY KEY, data jsonb NOT NULL)');
      const r = await pg.query('SELECT data FROM app_state WHERE id = 1');
      db = r.rows[0] ? r.rows[0].data : emptyDb();
      console.log('  [DB] Connected to database - ratings are saved permanently.');
    } catch (e) {
      // מסד הנתונים לא זמין (למשל פג תוקף) – ממשיכים לעבוד עם קובץ מקומי
      pg = null; db = null;
      console.log('  [!] Could not connect to the database:', e.message);
      console.log('  [!] The site keeps working, but ratings may reset when the server restarts.');
    }
  }
  if (!db) {
    try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { db = emptyDb(); }
  }
  for (const k of ['users', 'camps', 'messages', 'reviews']) if (!Array.isArray(db[k])) db[k] = [];
  if (!db.sessions) db.sessions = {};
  if (!db.nextId) db.nextId = 1;
  db.camps = db.camps.map(c => ({ ...blankCamp(), ...c }));
  syncCamps();
  await saveNow();
}

// ---------- סנכרון רשימת הקייטנות עם camps.json ----------
// מוסיף קייטנות חדשות, משלים פרטים חסרים, ומנקה קייטנות ישנות שכבר לא ברשימה
// (רק אם אף אחד לא דירג או כתב עליהן, ורק אם המנהל לא הוסיף אותן ידנית).
function syncCamps() {
  const seed = loadSeedCamps();
  if (!seed.length) return;
  const seedNames = new Set(seed.map(c => c.name));
  let added = 0, filled = 0, removed = 0;

  for (const s of seed) {
    const existing = db.camps.find(c => c.name === s.name);
    if (!existing) {
      db.camps.push({ ...blankCamp(), ...s, id: db.nextId++, seeded: true, created_at: now() });
      added++;
    } else {
      let changed = false;
      for (const k of CAMP_FIELDS)
        if (!String(existing[k] || '').trim() && String(s[k] || '').trim()) { existing[k] = s[k]; changed = true; }
      existing.seeded = true;
      if (changed) filled++;
    }
  }

  const before = db.camps.length;
  db.camps = db.camps.filter(c => {
    if (seedNames.has(c.name) || c.custom) return true;          // ברשימה, או נוספה ידנית
    const used = db.reviews.some(r => r.camp_id === c.id) ||
                 db.messages.some(m => m.camp_id === c.id);
    return used;                                                  // יש עליה דירוגים/הודעות – משאירים
  });
  removed = before - db.camps.length;

  if (added || filled || removed)
    console.log(`  [i] Camp list synced: ${added} added, ${filled} updated, ${removed} old removed.`);
  console.log(`  [i] ${db.camps.length} camps loaded.`);
}

async function saveNow() {
  try {
    if (pg) {
      await pg.query(`INSERT INTO app_state (id, data) VALUES (1, $1)
                      ON CONFLICT (id) DO UPDATE SET data = $1`, [JSON.stringify(db)]);
    } else {
      fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(db, null, 1));
      fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
    }
  } catch (e) { console.log('  [!] Could not save data:', e.message); }
}
let saveTimer = null;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 60); }
const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

// ---------- סיסמאות (מוצפנות, לא נשמרות בטקסט גלוי) ----------
const hashPass = (pass, salt = crypto.randomBytes(16).toString('hex')) =>
  salt + ':' + crypto.pbkdf2Sync(pass, salt, 60000, 32, 'sha256').toString('hex');
function checkPass(pass, stored) {
  const [salt] = String(stored).split(':');
  const a = Buffer.from(hashPass(pass, salt)), b = Buffer.from(stored);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- עזרים ----------
// מפתח שם אחיד – כדי שלא יהיו שני משתמשים עם אותו שם פרטי + שם משפחה
// (מתעלם מרווחים כפולים, מגרשיים ומאותיות גדולות/קטנות באנגלית)
const norm = s => String(s || '').trim().replace(/\s+/g, ' ').replace(/["'׳״]/g, '').toLowerCase();
const nameKey = (first, last) => norm(first) + '|' + norm(last);
const userKey = u => u.first_name !== undefined
  ? nameKey(u.first_name, u.last_name)
  : nameKey((u.name || '').split(' ')[0], (u.name || '').split(' ').slice(1).join(' '));

const userById = id => db.users.find(u => u.id === id);
const campById = id => db.camps.find(c => c.id === id);
function campView(c) {
  const rs = db.reviews.filter(r => r.camp_id === c.id);
  const avg = rs.length ? Math.round((rs.reduce((s, r) => s + r.score, 0) / rs.length) * 10) / 10 : null;
  return { ...c, avg_score: avg, review_count: rs.length,
           message_count: db.messages.filter(m => m.camp_id === c.id).length };
}
function newSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = user.id; save();
  return { token, user: { id: user.id, name: user.name, is_admin: user.is_admin } };
}

// ---------- שרת ----------
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg',
  '.svg':'image/svg+xml', '.ico':'image/x-icon', '.json':'application/json; charset=utf-8' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };
  const err = (code, message) => send(code, { error: message });

  // מי המשתמש ששלח את הבקשה
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const me = token && db.sessions[token] ? userById(db.sessions[token]) : null;

  if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);

  let body = '';
  req.on('data', ch => { body += ch; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => {
    let B = {};
    try { B = body ? JSON.parse(body) : {}; } catch { return err(400, 'בקשה לא תקינה'); }
    const p = url.pathname, m = req.method;
    const idIn = s => Number(String(s).replace(/\D/g, ''));
    try {
      // ---- כניסה: שם חדש נפתח לבד, שם קיים נכנס עם הסיסמה שלו ----
      // ---- הרשמה: משתמש חדש בלבד ----
      if (p === '/api/register' && m === 'POST') {
        const first = String(B.firstName || '').trim();
        const last  = String(B.lastName  || '').trim();
        const pass  = String(B.password  || '');
        const adminCode = String(B.adminCode || '');
        if (first.length < 2) return err(400, 'צריך לכתוב שם פרטי (לפחות 2 אותיות)');
        if (last.length  < 2) return err(400, 'צריך לכתוב שם משפחה (לפחות 2 אותיות)');
        if (pass.length  < 4) return err(400, 'הסיסמה חייבת להיות לפחות 4 תווים');
        const key = nameKey(first, last);
        if (db.users.some(u => userKey(u) === key))
          return err(409, `כבר קיים משתמש בשם ${first} ${last}. אם זה אתה – לחצו על "כבר יש לי משתמש". אם זה מישהו אחר עם אותו שם – הוסיפו אות לשם המשפחה, למשל "${last} ב׳".`);
        const u = { id: db.nextId++, first_name: first, last_name: last,
                    name: `${first} ${last}`, pass_hash: hashPass(pass),
                    is_admin: adminCode && adminCode === ADMIN_CODE ? 1 : 0, created_at: now() };
        db.users.push(u); save();
        return send(200, { ...newSession(u), isNew: true });
      }

      // ---- כניסה: משתמש קיים בלבד ----
      if (p === '/api/login' && m === 'POST') {
        const first = String(B.firstName || '').trim();
        const last  = String(B.lastName  || '').trim();
        const pass  = String(B.password  || '');
        const adminCode = String(B.adminCode || '');
        if (!first || !last) return err(400, 'צריך למלא שם פרטי ושם משפחה');
        const key = nameKey(first, last);
        const u = db.users.find(x => userKey(x) === key);
        if (!u) return err(404, `לא נמצא משתמש בשם ${first} ${last}. אולי אתם חדשים כאן? לחצו על "אני חדש כאן".`);
        if (!checkPass(pass, u.pass_hash))
          return err(401, 'הסיסמה לא נכונה. נסו שוב.');
        if (adminCode && adminCode === ADMIN_CODE) { u.is_admin = 1; save(); }
        return send(200, { ...newSession(u), isNew: false });
      }

      if (p === '/api/logout' && m === 'POST') { delete db.sessions[token]; save(); return send(200, { ok: true }); }
      if (p === '/api/me'  && m === 'GET') {
        if (!me) return err(401, 'צריך להתחבר');
        return send(200, { id: me.id, name: me.name, is_admin: me.is_admin });
      }

      // ---- רשימת הקייטנות (דף הבית) ----
      if (p === '/api/camps' && m === 'GET') {
        const list = db.camps.map(campView).sort((a, b) =>
          (a.avg_score === null) - (b.avg_score === null) ||
          (b.avg_score ?? 0) - (a.avg_score ?? 0) || a.name.localeCompare(b.name, 'he'));
        return send(200, list);
      }

      // ---- קייטנה אחת: כל ההודעות וכל הציונים ----
      const one = p.match(/^\/api\/camps\/(\d+)$/);
      if (one && m === 'GET') {
        const c = campById(Number(one[1]));
        if (!c) return err(404, 'הקייטנה לא נמצאה');
        const withUser = arr => arr.map(x => {
          const u = userById(x.user_id) || { name: 'משתמש שנמחק' };
          return { ...x, user_name: u.name };
        });
        return send(200, { ...campView(c),
          reviews: withUser(db.reviews.filter(r => r.camp_id === c.id)).sort((a,b)=>b.id-a.id),
          messages: withUser(db.messages.filter(x => x.camp_id === c.id)).sort((a,b)=>b.id-a.id)
                     .map(x => ({ ...x, score: (db.reviews.find(r => r.camp_id === x.camp_id && r.user_id === x.user_id) || {}).score ?? null })) });
      }

      if (!me) return err(401, 'צריך להתחבר');

      // ---- ציון לקייטנה (אחד לכל אדם, אפשר לעדכן) ----
      const rev = p.match(/^\/api\/camps\/(\d+)\/reviews$/);
      if (rev && m === 'POST') {
        const score = Number(B.score);
        if (!Number.isInteger(score) || score < 0 || score > 10)
          return err(400, 'הציון צריך להיות מספר שלם בין 0 ל-10');
        const c = campById(Number(rev[1]));
        if (!c) return err(404, 'הקייטנה לא נמצאה');
        const existing = db.reviews.find(r => r.camp_id === c.id && r.user_id === me.id);
        if (existing) { existing.score = score; existing.created_at = now(); }
        else db.reviews.push({ id: db.nextId++, camp_id: c.id, user_id: me.id, score, created_at: now() });
        save(); return send(200, { ok: true });
      }
      const revDel = p.match(/^\/api\/reviews\/(\d+)$/);
      if (revDel && m === 'DELETE') {
        const r = db.reviews.find(x => x.id === Number(revDel[1]));
        if (!r) return err(404, 'לא נמצא');
        if (r.user_id !== me.id && !me.is_admin) return err(403, 'אפשר למחוק רק ציון שלך');
        db.reviews = db.reviews.filter(x => x !== r); save(); return send(200, { ok: true });
      }

      // ---- הודעות (כמה שרוצים לכל קייטנה) ----
      const msg = p.match(/^\/api\/camps\/(\d+)\/messages$/);
      if (msg && m === 'POST') {
        const text = String(B.text || '').trim().slice(0, 2000);
        if (!text) return err(400, 'צריך לכתוב משהו');
        const c = campById(Number(msg[1]));
        if (!c) return err(404, 'הקייטנה לא נמצאה');
        db.messages.push({ id: db.nextId++, camp_id: c.id, user_id: me.id, text, created_at: now() });
        save(); return send(200, { ok: true });
      }
      const msgDel = p.match(/^\/api\/messages\/(\d+)$/);
      if (msgDel && m === 'DELETE') {
        const x = db.messages.find(y => y.id === Number(msgDel[1]));
        if (!x) return err(404, 'לא נמצאה');
        if (x.user_id !== me.id && !me.is_admin) return err(403, 'אפשר למחוק רק הודעה שלך');
        db.messages = db.messages.filter(y => y !== x); save(); return send(200, { ok: true });
      }

      // ---- ניהול (מנהל בלבד) ----
      if (!me.is_admin) return err(403, 'רק מנהל יכול לעשות את זה');

      // כל ההודעות והציונים במקום אחד, כדי שהמנהל יוכל למחוק מה שלא בסדר
      if (p === '/api/admin/feed' && m === 'GET') {
        const nameOf = id => (userById(id) || {}).name || 'משתמש שנמחק';
        const campOf = id => (campById(id) || {}).name || 'קייטנה שנמחקה';
        return send(200, {
          messages: db.messages.slice().sort((a, b) => b.id - a.id).slice(0, 100)
            .map(x => ({ ...x, user_name: nameOf(x.user_id), camp_name: campOf(x.camp_id) })),
          reviews: db.reviews.slice().sort((a, b) => b.id - a.id).slice(0, 100)
            .map(x => ({ ...x, user_name: nameOf(x.user_id), camp_name: campOf(x.camp_id) })),
          users: db.users.length
        });
      }
      if (p === '/api/camps' && m === 'POST') {
        const name = String(B.name || '').trim();
        if (!name) return err(400, 'צריך שם לקייטנה');
        if (db.camps.some(c => c.name === name)) return err(400, 'כבר קיימת קייטנה בשם הזה');
        const c = { ...blankCamp(), id: db.nextId++, custom: true, created_at: now() };
        for (const k of CAMP_FIELDS) if (B[k] !== undefined) c[k] = String(B[k]).slice(0, 500);
        c.name = name; c.emoji = c.emoji || '🏕️';
        db.camps.push(c); save(); return send(200, { id: c.id });
      }
      if (one && m === 'PUT') {
        const c = campById(Number(one[1]));
        if (!c) return err(404, 'לא נמצאה');
        for (const k of CAMP_FIELDS) if (B[k] !== undefined) c[k] = String(B[k]).slice(0, 500);
        save(); return send(200, { ok: true });
      }
      if (one && m === 'DELETE') {
        const id = Number(one[1]);
        db.camps = db.camps.filter(c => c.id !== id);
        db.messages = db.messages.filter(x => x.camp_id !== id);
        db.reviews = db.reviews.filter(x => x.camp_id !== id);
        save(); return send(200, { ok: true });
      }
      return err(404, 'לא נמצא');
    } catch (e) {
      console.log('  [!] Error:', e.message);
      return err(500, 'שגיאה בשרת');
    }
  });
});

function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (e, data) => {
    if (e) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('לא נמצא'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

load().then(startServer).catch(e => {
  console.log('');
  console.log('  [X] Could not connect to the database:', e.message);
  console.log('      Check DATABASE_URL, or remove it to save to a local file.');
  process.exit(1);
});

function startServer() {
  server.listen(PORT, () => {
    console.log('');
    console.log('  [OK] The camps website is running!');
    console.log(`  ==> Open in your browser:  http://localhost:${PORT}`);
    console.log('  [!] Keep this window open while using the website.');
    console.log('');
  });
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      console.log('');
      console.log(`  [!] Port ${PORT} is busy - the server is probably already running.`);
      console.log(`  ==> Just open in your browser: http://localhost:${PORT}`);
      console.log('');
    } else console.log('  [X] Server failed to start:', e.message);
    process.exit(1);
  });
}
