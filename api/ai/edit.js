const { editWithGemini, fail } = require('../../lib/ai.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'ใช้ POST เท่านั้น' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const prompt = String(body.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'ยังไม่ได้ใส่คำสั่ง' });
  try {
    const out = await editWithGemini(prompt, body.image);
    res.setHeader('Content-Type', out.type);
    res.status(200).send(out.buf);
  } catch (e) {
    fail(res, e);
  }
};
