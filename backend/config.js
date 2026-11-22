// ค่าตั้งของระบบ แก้ที่นี่ที่เดียว
// TODO: ค่าด้านล่างเป็นค่าเริ่มต้นชั่วคราว ต้องยืนยันชื่อแบรนด์ แพ็กเกจ และราคาก่อนเปิดใช้งานจริง

module.exports = {
  brandName: process.env.BRAND_NAME || 'โปรแกรมขยายภาพเพื่องานพิมพ์', // TODO ชื่อแบรนด์
  currency: 'THB',
  // ราคาเป็นสตางค์ (1 บาท = 100 สตางค์) TODO ยืนยันราคาและจำนวนเครดิต
  creditPacks: [
    { id: 'p100', credits: 100, priceSatang: 9900 },
    { id: 'p500', credits: 500, priceSatang: 39900 },
    { id: 'p1500', credits: 1500, priceSatang: 99000 },
  ],
  // จำนวนเครดิตที่ใช้ต่อการทำงานแต่ละประเภท TODO ยืนยัน
  costs: { upscale: 1, vectorize: 5, edit: 10, retouch: 10 },
  signupCredits: 15,
};
