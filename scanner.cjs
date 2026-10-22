'use strict';
// يشغّل نفس index.html في متصفح بدون شاشة داخل GitHub Actions.
// الأسرار (ALPACA_KEY, ALPACA_SECRET, FINNHUB_KEY, NTFY_TOPIC) تجي من Secrets ولا تنكتب بأي ملف.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), cp = require('child_process');
const E = process.env;
const ROOT = __dirname;
const DATA = path.resolve(E.DATA_DIR || path.join(ROOT, 'dbranch'));
const STATE = path.join(DATA, 'state.json');
const MAX_MS = (+E.MAX_MIN || 330) * 60000;
const UNTIL = (E.UNTIL_NY || '').trim();
const APP_URL = E.APP_URL || 'https://claude-saee.vercel.app';
const MOCK = E.SCANNER_MOCK ? require(path.resolve(E.SCANNER_MOCK)) : null;
const SPEED = +E.FAKE_SPEED || 1, R0 = Date.now(), FK0 = E.FAKE_START ? Date.parse(E.FAKE_START) : 0;
const nowMs = () => FK0 ? FK0 + (Date.now() - R0) * SPEED : Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const STARTED = nowMs();

const nyFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
function ny(ms) { const o = {}; for (const p of nyFmt.formatToParts(ms)) o[p.type] = p.value; return { day: o.year + '-' + o.month + '-' + o.day, mins: +o.hour * 60 + +o.minute, wd: o.weekday }; }
const hm = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

async function tell(title, message, priority, tags) {
  if (!E.NTFY_TOPIC) return;
  try {
    if (MOCK) { MOCK.ntfy.push({ title, message }); return; }
    await fetch('https://ntfy.sh/' + encodeURIComponent(E.NTFY_TOPIC) + '/publish?' + new URLSearchParams({ title, message, priority: String(priority || 3), tags: tags || 'robot', click: APP_URL }).toString());
  } catch (e) { log('ntfy failed:', e.message); }
}

// ===== سيرفر محلي: يقدّم index.html ويعمل نفس بروكسي api/alp.js =====
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/' || u.pathname === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(ROOT, 'index.html'))); }
  if (u.pathname === '/api/alp') {
    const p = u.searchParams.get('p') || '';
    if (!/^\/(v2\/stocks|v1beta1\/screener)\//.test(p)) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{}'); }
    try {
      if (MOCK) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(MOCK.api(p, nowMs()))); }
      const r = await fetch('https://data.alpaca.markets' + p, { headers: { 'APCA-API-KEY-ID': E.ALPACA_KEY || '', 'APCA-API-SECRET-KEY': E.ALPACA_SECRET || '', accept: 'application/json' } });
      const body = await r.text(); res.writeHead(r.status, { 'content-type': 'application/json' }); return res.end(body);
    } catch (e) { res.writeHead(502, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ message: e.message })); }
  }
  res.writeHead(404); res.end();
});

// ===== حفظ الحالة =====
let page = null;
function sh(args) { return cp.execFileSync('git', args, { cwd: DATA, stdio: 'pipe' }).toString(); }
function push(why) {
  try {
    sh(['add', 'state.json']);
    if (!sh(['status', '--porcelain']).trim()) return;
    const msg = 'state ' + why + ' [skip ci] [vercel skip]', id = ['-c', 'user.name=scanner-bot', '-c', 'user.email=scanner-bot@users.noreply.github.com'];
    let has = true; try { sh(['rev-parse', 'HEAD']); } catch (e) { has = false; }
    sh([...id, 'commit', ...(has ? ['--amend'] : []), '-m', msg]);   // نفس الكوميت يتحدّث: ما يكبر الريبو
    sh(['push', '--force', 'origin', 'HEAD:data']);
  } catch (e) { log('push failed:', String((e.stderr && e.stderr.toString()) || e.message).slice(0, 300)); }
}
async function save(why) {
  if (!page) return;
  let s; try { s = await page.evaluate(() => { const g = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }; const v = document.getElementById('ver'); return { recs: g('sa3.recs') || [], near: g('sa3.near') || [], scanlog: g('sa3.scanlog') || [], gaps: g('sa3.gaps') || [], tick: g('sa3.tick') || 0, st: { msg: SA.S.status.msg, cyc: SA.S.status.cyc }, app: v ? v.textContent : '' }; }); } catch (e) { log('snapshot failed:', e.message); return; }
  const out = { v: 1, server: { at: nowMs(), started: STARTED, runner: 'github-actions', cyc: s.st.cyc, msg: s.st.msg, app: s.app }, recs: s.recs, near: s.near, gaps: s.gaps, scanlog: s.scanlog, tick: s.tick };
  fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(STATE + '.tmp', JSON.stringify(out)); fs.renameSync(STATE + '.tmp', STATE);
  if (E.PUSH === '1') push(why);
}
const auditPending = day => page.evaluate(d => SA.S.auditing || SA.S.recs.some(r => r.day === d && !r.audit) || SA.S.near.some(x => x.day === d && !x.fwd), day).catch(() => false);

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const prev = readJ(STATE, {});
  const cfg = Object.assign({}, (() => { try { return JSON.parse(E.SCANNER_CFG || '{}'); } catch (e) { return {}; } })(), { alpKey: E.ALPACA_KEY || '', alpSecret: E.ALPACA_SECRET || '', fhKey: E.FINNHUB_KEY || '', ntfy: E.NTFY_TOPIC || '', appUrl: APP_URL, scanOn: true, sound: false });
  const boot = { 'sa3.cfg': cfg, 'sa3.recs': prev.recs || [], 'sa3.near': prev.near || [], 'sa3.scanlog': prev.scanlog || [], 'sa3.gaps': prev.gaps || [], 'sa3.tick': prev.tick || 0 };
  log('state restored:', (prev.recs || []).length, 'recs,', (prev.near || []).length, 'near');
  const br = await chromium.launch(E.CHROMIUM_PATH ? { executablePath: E.CHROMIUM_PATH, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
  const ctx = await br.newContext({ viewport: { width: 420, height: 900 }, locale: 'ar', serviceWorkers: 'block' });
  page = await ctx.newPage();
  page.on('pageerror', e => log('PAGEERR', e.message));
  await page.addInitScript(([b, fk0, r0, sp]) => {
    if (!localStorage.getItem('sa3.boot')) { for (const k in b) localStorage.setItem(k, JSON.stringify(b[k])); localStorage.setItem('sa3.boot', '1'); }
    if (fk0) Object.defineProperty(window, '__fakeNow', { get() { return fk0 + (Date.now() - r0) * sp; } });
  }, [boot, FK0, R0, SPEED]);
  await ctx.route(/^https:\/\/(finnhub\.io|ntfy\.sh)\//, async r => {
    const url = r.request().url(), cors = { 'access-control-allow-origin': '*' };
    if (MOCK) {
      if (url.includes('ntfy.sh')) { const q = new URL(url).searchParams; MOCK.ntfy.push({ title: q.get('title'), message: q.get('message') }); return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{}' }); }
      return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(MOCK.finnhub(new URL(url).searchParams.get('symbol'))) });
    }
    try { const resp = await r.fetch(); await r.fulfill({ response: resp, headers: Object.assign({}, resp.headers(), cors) }); } catch (e) { await r.abort(); }
  });
  await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load' });
  const n0 = ny(nowMs());
  log('started; NY', n0.day, Math.floor(n0.mins / 60) + ':' + String(n0.mins % 60).padStart(2, '0'), n0.wd);
  await tell('☁️ بدأ الماسح السيرفري', 'يعمل الحين على GitHub. توصياتك توصلك هنا حتى لو جوالك مقفل.', 2, 'cloud');

  let lastSave = Date.now(), lastReload = 0, stale = false, noSnap = 0, reason = 'max';
  const reload = async why => { log('reload:', why); lastReload = Date.now(); try { await page.reload({ waitUntil: 'load' }); } catch (e) { log('reload failed', e.message); } };
  for (;;) {
    await sleep(15000);
    const t = nowMs(), n = ny(t), wk = n.wd !== 'Sat' && n.wd !== 'Sun', open = wk && n.mins >= 570 && n.mins < 960;
    let st = null; try { st = await page.evaluate(() => ({ at: SA.S.status.at, msg: SA.S.status.msg, snaps: SA.S.status.snaps, cyc: SA.S.status.cyc })); } catch (e) { st = null; }
    if (!st) { await reload('page error'); continue; }
    if (/المفاتيح مرفوضة/.test(st.msg)) { await tell('🔑 مفاتيح Alpaca مرفوضة', 'السيرفر توقف. راجع الأسرار ALPACA_KEY و ALPACA_SECRET في إعدادات GitHub.', 5, 'warning'); reason = 'keys'; break; }
    if (open && st.at && t - st.at > 150000) {
      if (!stale) { stale = true; await tell('⚠ الماسح السيرفري متوقف', 'ما في دورة مسح من أكثر من دقيقتين. يحاول يعيد التشغيل.', 4, 'warning'); }
      if (Date.now() - lastReload > 180000) await reload('stale');
    } else if (stale && st.at && t - st.at < 60000) { stale = false; await tell('🟢 رجع الماسح السيرفري', 'المسح شغّال مرة ثانية.', 3, 'white_check_mark'); }
    if (open && n.mins >= 600 && /🔭/.test(st.msg) && st.snaps === 0) noSnap++; else noSnap = 0;
    if (noSnap >= 6) { reason = 'holiday'; break; }
    if (Date.now() - lastSave > 300000) { await save('tick'); lastSave = Date.now(); }
    if (UNTIL && wk && n.mins >= hm(UNTIL)) { reason = 'close'; break; }
    if (Date.now() - R0 >= MAX_MS) { reason = 'max'; break; }
  }
  if (reason === 'close') { for (let i = 0; i < 40 && await auditPending(ny(nowMs()).day); i++) await sleep(15000); }
  await save('final');
  let sum = ''; try { sum = await page.evaluate(d => { const r = SA.S.recs.filter(x => x.day === d); return r.filter(x => !x.shadow).length + ' توصية (+' + r.filter(x => x.shadow).length + ' ظل) · ' + SA.S.near.filter(x => x.day === d).length + ' فرصة قريبة · ' + SA.S.gaps.filter(g => g.day === d).length + ' فترة توقف'; }, ny(nowMs()).day); } catch (e) {}
  const why = { max: 'انتهت مدة الجلسة (تكمل الجلسة التالية)', close: 'انتهى يوم التداول وتم التدقيق', holiday: 'السوق مغلق اليوم (عطلة)', keys: 'مفاتيح مرفوضة' }[reason];
  await tell('🏁 السيرفر: ' + why, sum || 'تم الحفظ', 2, 'checkered_flag');
  log('done:', reason, sum);
  if (MOCK) console.log('MOCK_NTFY', JSON.stringify(MOCK.ntfy));
  await br.close(); srv.close(); process.exit(reason === 'keys' ? 1 : 0);
})().catch(async e => { console.error(e); try { await save('crash'); await tell('🔴 السيرفر وقف بخطأ', String(e.message).slice(0, 120), 4, 'rotating_light'); } catch (x) {} process.exit(1); });
