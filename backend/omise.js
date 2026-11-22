// การชำระเงินผ่าน Omise (PromptPay)
// ตัวแปรสภาพแวดล้อมที่ต้องตั้ง: OMISE_SECRET_KEY (ห้ามใส่ในโค้ดหรือหน้าเว็บ)

const API = 'https://api.omise.co';

function authHeader() {
  const key = process.env.OMISE_SECRET_KEY;
  if (!key) throw new Error('ยังไม่ได้ตั้งค่า OMISE_SECRET_KEY');
  return 'Basic ' + Buffer.from(key + ':').toString('base64');
}

// สร้างรายการชำระด้วย PromptPay แล้วคืน QR ให้หน้าเว็บแสดง
async function createPromptPayCharge({ amountSatang, userId, packId }) {
  const body = new URLSearchParams({
    amount: String(amountSatang),
    currency: 'thb',
    description: `credit:${packId}`,
    'metadata[user_id]': userId,
    'metadata[pack_id]': packId,
    'source[type]': 'promptpay',
  });
  const res = await fetch(`${API}/charges`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'สร้างรายการชำระไม่สำเร็จ');
  return {
    chargeId: data.id,
    status: data.status,
    qrImageUrl: data.source && data.source.scannable_code && data.source.scannable_code.image
      ? data.source.scannable_code.image.download_uri : null,
    expiresAt: data.expires_at || null,
  };
}

// ตรวจสถานะกับ Omise โดยตรง อย่าเชื่อข้อมูลจาก webhook อย่างเดียว
async function fetchCharge(chargeId) {
  const res = await fetch(`${API}/charges/${encodeURIComponent(chargeId)}`, {
    headers: { Authorization: authHeader() },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'ตรวจสอบรายการไม่สำเร็จ');
  return data;
}

module.exports = { createPromptPayCharge, fetchCharge };
