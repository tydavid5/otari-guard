// Otari Guard - Vercel serverless health endpoint for the hosted demo.
// Reports the mode, the roles and the models, never the API key.

const { loadPrices, loadRoles } = require("../lib/config");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const apiKey = process.env.OTARI_API_KEY || "";
  const baseUrl = String(process.env.OTARI_BASE_URL || "https://api.otari.ai/api").replace(/\/$/, "");
  const prices = loadPrices(process.env);
  const roles = loadRoles(process.env);
  res.status(200).json({
    mode: apiKey ? "live" : "demo",
    baseUrl,
    hasKey: Boolean(apiKey),
    roles,
    models: Object.keys(prices),
    prices,
  });
};
