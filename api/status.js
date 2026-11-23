module.exports = (req, res) => {
  const gemini = Boolean(process.env.GEMINI_API_KEY);
  const recraft = Boolean(process.env.RECRAFT_API_KEY);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ai: gemini, gemini, recraft });
};
