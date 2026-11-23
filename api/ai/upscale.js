const { upscaleWithRecraft, readRaw, fail } = require('../../lib/ai.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'ใช้ POST เท่านั้น' });
  try {
    const buf = await readRaw(req);
    const mime = (req.headers['content-type'] || 'image/png').split(';')[0];
    if (!/^image\//.test(mime)) return res.status(400).json({ error: 'ต้องส่งเป็นไฟล์รูปภาพ' });
    const out = await upscaleWithRecraft(buf, mime);
    res.setHeader('Content-Type', out.type);
    res.status(200).send(out.buf);
  } catch (e) {
    fail(res, e);
  }
};

module.exports.config = { api: { bodyParser: false } };
