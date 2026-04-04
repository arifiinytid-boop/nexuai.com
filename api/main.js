export default function handler(req, res) {
  res.status(200).json({
    gemini: process.env.GEMINI_API_KEY,
    claude: process.env.CLAUDE_API_KEY,
    openai: process.env.OPENAI_API_KEY
  });
}
