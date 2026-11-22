// Print Upscaler server
// - เสิร์ฟหน้าเว็บ index.html
// - /api/ai/:task ส่งต่อคำขอไปยังผู้ให้บริการ AI โดยใช้ key จาก environment variable
//   ไม่มี key ไม่มีการเรียกภายนอก และคืนสถานะ 503 พร้อมข้อความชัดเจน
//
// ตัวแปรสภาพแวดล้อม:
//   AI_API_KEY   key ของผู้ให้บริการ (ห้ามใส่ในโค้ด)
//   AI_API_URL   endpoint ของผู้ให้บริการ เช่น https://api.example.com/v1/images/edit
//   PORT         พอร์ต (ค่าเริ่มต้น 8080)

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8080;
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_API_URL = process.env.AI_API_URL || '';
const TASKS = new Set(['retouch', 'edit', 'vectorize']);
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

async function handleAI(req, res, task) {
  if (!TASKS.has(task)) return send(res, 404, { error: 'ไม่รู้จักงานนี้' });
  if (!AI_API_KEY || !AI_API_URL) {
    return send(res, 503, {
      error: 'ยังไม่ได้ตั้งค่า AI_API_KEY หรือ AI_API_URL บนเซิร์ฟเวอร์',
      configured: false,
    });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'ใช้ POST เท่านั้น' });

  let body;
  try { body = await readBody(req); }
  catch { return send(res, 413, { error: 'ไฟล์ใหญ่เกินไป' }); }

  try {
    const upstream = await fetch(AI_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AI_API_KEY}`,
        'Content-Type': req.headers['content-type'] || 'application/json',
        'X-Task': task,
      },
      body,
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    send(res, upstream.status, buf, upstream.headers.get('content-type') || 'application/octet-stream');
  } catch (e) {
    send(res, 502, { error: 'เรียกผู้ให้บริการ AI ไม่สำเร็จ: ' + e.message });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/status') {
    return send(res, 200, { ai: Boolean(AI_API_KEY && AI_API_URL) });
  }
  if (url.pathname.startsWith('/api/ai/')) {
    return handleAI(req, res, url.pathname.slice('/api/ai/'.length));
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
  console.log(AI_API_KEY && AI_API_URL ? 'AI: ตั้งค่าแล้ว' : 'AI: ยังไม่ได้ตั้งค่า (ฟีเจอร์ AI จะไม่ทำงาน)');
});
