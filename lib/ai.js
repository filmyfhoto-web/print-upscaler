// ฟังก์ชันเรียกผู้ให้บริการ AI (ใช้ร่วมกันทุก API)
// key อ่านจากตัวแปรสภาพแวดล้อมของ Vercel หรือเครื่องของคุณ ห้ามใส่ในโค้ด

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-image';

async function editWithGemini(prompt, dataUrl) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error('ยังไม่ได้ตั้งค่า GEMINI_API_KEY'), { status: 503 });
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) throw Object.assign(new Error('รูปแบบรูปภาพไม่ถูกต้อง'), { status: 400 });
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: m[1], data: m[2] } }] }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || `Gemini ตอบกลับ ${res.status}`);
  for (const cand of data.candidates || []) {
    for (const part of (cand.content && cand.content.parts) || []) {
      const inl = part.inline_data || part.inlineData;
      if (inl && inl.data) return { type: inl.mime_type || inl.mimeType || 'image/png', buf: Buffer.from(inl.data, 'base64') };
    }
  }
  throw new Error('AI ไม่ได้ส่งรูปกลับมา');
}

async function recraftCall(path, buf, mime) {
  const key = process.env.RECRAFT_API_KEY;
  if (!key) throw Object.assign(new Error('ยังไม่ได้ตั้งค่า RECRAFT_API_KEY'), { status: 503 });
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime }), 'input.png');
  const res = await fetch(`https://external.api.recraft.ai/v1/images/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Recraft ตอบกลับ ${res.status}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.startsWith('image/') || ct.includes('svg')) return { type: ct, buf: Buffer.from(await res.arrayBuffer()) };
  const j = await res.json();
  const url = (j.image && j.image.url) || j.url || (j.data && j.data[0] && j.data[0].url);
  if (!url) throw new Error('Recraft ไม่ได้ส่งผลลัพธ์กลับมา');
  const r2 = await fetch(url);
  return { type: r2.headers.get('content-type') || 'image/png', buf: Buffer.from(await r2.arrayBuffer()) };
}

// เส้นทาง crispUpscale ยังไม่ได้ยืนยันจากเอกสารทางการ
const vectorizeWithRecraft = (buf, mime) => recraftCall('vectorize', buf, mime);
const upscaleWithRecraft = (buf, mime) => recraftCall('crispUpscale', buf, mime);

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 25 * 1024 * 1024) { reject(Object.assign(new Error('ไฟล์ใหญ่เกินไป'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function fail(res, e) {
  res.status(e.status || 502).json({ error: e.message });
}

module.exports = { editWithGemini, vectorizeWithRecraft, upscaleWithRecraft, readRaw, fail };
