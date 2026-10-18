// وسيط (proxy) بسيط لـ Alpaca Market Data: يمرّر الطلب مع مفاتيحك من الجهاز، ولا يخزّن شيء.
// المسارات المسموحة فقط: /v2/stocks/* و /v1beta1/screener/*
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ message: 'GET only' });
  const key = req.headers['x-alp-key'], secret = req.headers['x-alp-secret'];
  const p = String(req.query.p || '');
  if (!key || !secret) return res.status(401).json({ message: 'مفاتيح Alpaca ناقصة' });
  if (!/^\/(v2\/stocks|v1beta1\/screener)\//.test(p) || p.includes('..') || p.includes('//')) return res.status(400).json({ message: 'path not allowed' });
  try {
    const r = await fetch('https://data.alpaca.markets' + p, { headers: { 'APCA-API-KEY-ID': String(key), 'APCA-API-SECRET-KEY': String(secret), accept: 'application/json' } });
    const body = await r.text();
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
    return res.status(r.status).send(body);
  } catch (e) {
    return res.status(502).json({ message: 'upstream error: ' + e.message });
  }
}
