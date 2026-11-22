// Print Upscaler server
// - เสิร์ฟหน้าเว็บ index.html
// - /api/ai/edit และ /api/ai/retouch ใช้ Google Gemini (แก้ภาพตามข้อความ)
// - /api/ai/vectorize ใช้ Recraft (แปลงภาพเป็น SVG)
// key ทั้งหมดอ่านจากตัวแปรสภาพแวดล้อม ห้ามใส่ในโค้ดหรือหน้าเว็บ
//
// ตัวแปรสภาพแวดล้อม:
//   GEMINI_API_KEY   key ของ Google Gemini
//   GEMINI_MODEL     ชื่อโมเดลรูปภาพ (ค่าเริ่มต้น gemini-2.5-flash-image)
//   RECRAFT_API_KEY  key ของ Recraft
//   PORT             พอร์ต (ค่าเริ่มต้น 8080)

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8080;
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-image';
const RECRAFT_KEY = process.env.RECRAFT_API_KEY || '';
const MAX_BODY = 25 * 1024 * 1024;
const INDEX = path.join(__dirname, 'index.html');

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// แก้ภาพตามข้อความด้วย Gemini: ส่งข้อความกับรูปเดิม แล้วรับรูปใหม่กลับมา
async function editWithGemini(prompt, dataUrl) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) throw new Error('รูปแบบรูปภาพไม่ถูกต้อง');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: m[1], data: m[2] } }] }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || `Gemini ตอบกลับ ${res.status}`);
  for (const cand of data.candidates || []) {
    for (const part of (cand.content && cand.content.parts) || []) {
      const inl = part.inline_data || part.inlineData;
      if (inl && inl.data) {
        return { type: inl.mime_type || inl.mimeType || 'image/png', buf: Buffer.from(inl.data, 'base64') };
      }
    }
  }
  const text = ((data.candidates && data.candidates[0] && data.candidates[0].content.parts) || [])
    .map(p => p.text).filter(Boolean).join(' ');
  throw new Error('AI ไม่ได้ส่งรูปกลับมา' + (text ? ': ' + text.slice(0, 200) : ''));
}

// แปลงภาพเป็น SVG ด้วย Recraft
async function vectorizeWithRecraft(buf, mime) {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime }), 'input.png');
  const res = await fetch('https://external.api.recraft.ai/v1/images/vectorize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RECRAFT_KEY}` },
    body: form,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Recraft ตอบกลับ ${res.status}`);
  }
  if ((res.headers.get('content-type') || '').includes('svg')) return Buffer.from(await res.arrayBuffer());
  const j = await res.json();
  const url = (j.image && j.image.url) || j.url || (j.data && j.data[0] && j.data[0].url);
  if (!url) throw new Error('Recraft ไม่ได้ส่ง SVG กลับมา');
  const r2 = await fetch(url);
  return Buffer.from(await r2.arrayBuffer());
}

// ทำให้ภาพคมชัดด้วย Recraft Crisp Upscale (เส้นทางตามผลค้นหา ยังไม่ได้ยืนยันจากเอกสารทางการ)
async function crispUpscaleWithRecraft(buf, mime) {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime }), 'input.png');
  const res = await fetch('https://external.api.recraft.ai/v1/images/crispUpscale', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RECRAFT_KEY}` },
    body: form,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Recraft ตอบกลับ ${res.status}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.startsWith('image/')) return { type: ct, buf: Buffer.from(await res.arrayBuffer()) };
  const j = await res.json();
  const url = (j.image && j.image.url) || j.url || (j.data && j.data[0] && j.data[0].url);
  if (!url) throw new Error('Recraft ไม่ได้ส่งรูปกลับมา');
  const r2 = await fetch(url);
  return { type: r2.headers.get('content-type') || 'image/png', buf: Buffer.from(await r2.arrayBuffer()) };
}

async function handleUpscale(req, res) {
  if (!RECRAFT_KEY) return send(res, 503, { error: 'ยังไม่ได้ตั้งค่า RECRAFT_API_KEY บนเซิร์ฟเวอร์', configured: false });
  if (req.method !== 'POST') return send(res, 405, { error: 'ใช้ POST เท่านั้น' });
  let buf;
  try { buf = await readBody(req); }
  catch { return send(res, 413, { error: 'ไฟล์ใหญ่เกินไป' }); }
  const mime = (req.headers['content-type'] || 'image/png').split(';')[0];
  if (!/^image\//.test(mime)) return send(res, 400, { error: 'ต้องส่งเป็นไฟล์รูปภาพ' });
  try {
    const out = await crispUpscaleWithRecraft(buf, mime);
    send(res, 200, out.buf, out.type);
  } catch (e) {
    send(res, 502, { error: e.message });
  }
}

async function handleEdit(req, res) {
  if (!GEMINI_KEY) return send(res, 503, { error: 'ยังไม่ได้ตั้งค่า GEMINI_API_KEY บนเซิร์ฟเวอร์', configured: false });
  if (req.method !== 'POST') return send(res, 405, { error: 'ใช้ POST เท่านั้น' });
  let body;
  try { body = JSON.parse((await readBody(req)).toString('utf8')); }
  catch { return send(res, 400, { error: 'ข้อมูลที่ส่งมาไม่ถูกต้อง' }); }
  const prompt = String(body.prompt || '').trim();
  if (!prompt) return send(res, 400, { error: 'ยังไม่ได้ใส่คำสั่ง' });
  try {
    const out = await editWithGemini(prompt, body.image);
    send(res, 200, out.buf, out.type);
  } catch (e) {
    send(res, 502, { error: e.message });
  }
}

async function handleVectorize(req, res) {
  if (!RECRAFT_KEY) return send(res, 503, { error: 'ยังไม่ได้ตั้งค่า RECRAFT_API_KEY บนเซิร์ฟเวอร์', configured: false });
  if (req.method !== 'POST') return send(res, 405, { error: 'ใช้ POST เท่านั้น' });
  let buf;
  try { buf = await readBody(req); }
  catch { return send(res, 413, { error: 'ไฟล์ใหญ่เกินไป' }); }
  const mime = (req.headers['content-type'] || 'image/png').split(';')[0];
  if (!/^image\//.test(mime)) return send(res, 400, { error: 'ต้องส่งเป็นไฟล์รูปภาพ' });
  try {
    const svg = await vectorizeWithRecraft(buf, mime);
    send(res, 200, svg, 'image/svg+xml');
  } catch (e) {
    send(res, 502, { error: e.message });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/status') {
    return send(res, 200, { ai: Boolean(GEMINI_KEY), gemini: Boolean(GEMINI_KEY), recraft: Boolean(RECRAFT_KEY) });
  }
  if (url.pathname === '/api/ai/edit' || url.pathname === '/api/ai/retouch') {
    return handleEdit(req, res);
  }
  if (url.pathname === '/api/ai/vectorize') {
    return handleVectorize(req, res);
  }
  if (url.pathname === '/api/ai/upscale') {
    return handleUpscale(req, res);
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return fs.readFile(INDEX, (err, data) => {
      if (err) return send(res, 500, { error: 'อ่านหน้าเว็บไม่ได้' });
      send(res, 200, data, 'text/html; charset=utf-8');
    });
  }
  send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`Print Upscaler พร้อมที่ http://localhost:${PORT}`);
  console.log(`Gemini: ${GEMINI_KEY ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้งค่า'} · Recraft: ${RECRAFT_KEY ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้งค่า'}`);
});
