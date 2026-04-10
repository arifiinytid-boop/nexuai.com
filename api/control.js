// ============================================================
//  NEXUS AI - API CONTROL V4 ULTIMATE
//  File: api/control.js
//  Deploy ke Vercel. Set env vars:
//    ANTHROPIC_API_KEY  → untuk Claude
//    OPENAI_API_KEY     → untuk ChatGPT
//    GEMINI_API_KEY     → untuk Gemini
//    GROK_API_KEY       → untuk Grok (xAI)
// ============================================================

import { readFileSync, writeFileSync, existsSync } from 'fs';

const CMD_FILE  = '/tmp/nexus_cmd.json';
const LOG_FILE  = '/tmp/nexus_log.json';

// ──────────────────────────────────────────────
//  SYSTEM PROMPT → AI wajib jawab JSON saja
// ──────────────────────────────────────────────
const SYSTEM_PROMPT = `You are NEXUS AI, an expert Roblox Studio AI assistant.
You MUST respond with ONLY a valid JSON object — no markdown, no backticks, no extra text.

== RULES ==
- Color arrays: RGB 0-255 → [255,0,0] = red
- Position/Size: [X,Y,Z]
- Lua code in "code" field: escape newlines as \\n and quotes properly
- For ANYTHING complex (GUI, game systems, NPCs, shops, etc.) use inject_script with full working Lua
- Respond ONLY with JSON

== ALL AVAILABLE ACTIONS ==

1. CREATE PART
{"action":"create_part","name":"PartName","color":[R,G,B],"position":[X,Y,Z],"size":[X,Y,Z],"material":"SmoothPlastic","anchored":true,"shape":"Block","transparency":0,"can_collide":true}

2. BATCH CREATE (multiple parts at once)
{"action":"batch_create","parts":[{"name":"P1","color":[R,G,B],"position":[X,Y,Z],"size":[X,Y,Z],"material":"SmoothPlastic","anchored":true},{"name":"P2","color":[R,G,B],"position":[X,Y,Z],"size":[X,Y,Z],"material":"SmoothPlastic","anchored":true}]}

3. INJECT SCRIPT (Server Script)
{"action":"inject_script","script_type":"Script","name":"ScriptName","parent":"ServerScriptService","code":"-- lua code here"}

4. INJECT LOCAL SCRIPT
{"action":"inject_script","script_type":"LocalScript","name":"ScriptName","parent":"StarterPlayerScripts","code":"-- lua code"}

5. INJECT LOCAL SCRIPT IN STARTERGUI (for GUI creation)
{"action":"inject_script","script_type":"LocalScript","name":"GuiScript","parent":"StarterGui","code":"-- full GUI lua code"}

6. INJECT MODULE SCRIPT
{"action":"inject_script","script_type":"ModuleScript","name":"ModName","parent":"ReplicatedStorage","code":"-- module code"}

7. CLEAR WORKSPACE
{"action":"clear_workspace"}

8. DELETE OBJECT
{"action":"delete_object","name":"ObjectName","parent":"workspace"}

9. MODIFY PART
{"action":"modify_part","name":"PartName","parent":"workspace","properties":{"Color":[R,G,B],"Size":[X,Y,Z],"Material":"Neon","Transparency":0.5,"Anchored":true,"Position":[X,Y,Z],"CastShadow":true}}

10. SET LIGHTING
{"action":"set_lighting","brightness":2,"ambient":[R,G,B],"outdoor_ambient":[R,G,B],"colorshift_top":[R,G,B],"time":14,"fog_end":1000,"fog_start":0,"fog_color":[R,G,B],"shadows":true,"atmosphere":true}

11. CHANGE BASEPLATE
{"action":"change_baseplate","color":[R,G,B],"material":"Grass","size":[512,4,512]}

12. CREATE SPAWN LOCATION
{"action":"create_spawn","name":"SpawnPoint","position":[X,Y,Z],"color":[R,G,B]}

13. CREATE FOLDER/MODEL
{"action":"create_folder","name":"FolderName","parent":"workspace","type":"Folder"}

14. PRINT TO OUTPUT
{"action":"print_output","message":"Your message here"}

15. CREATE TEAM
{"action":"create_team","name":"TeamName","color":[R,G,B],"auto_assignable":true}

16. SET GAME NAME
{"action":"set_game_meta","name":"Game Name","description":"Game description"}

== EXAMPLES OF COMPLEX REQUESTS → use inject_script ==

"buat main menu gui" → inject_script LocalScript in StarterGui with complete ScreenGui code
"buat sistem nyawa / health bar" → inject_script LocalScript with health GUI
"buat coin/koin di peta" → inject_script Script with coin collection system
"buat musuh/zombie" → inject_script Script with NPC AI
"buat toko/shop" → inject_script with shop system Scripts
"buat leaderboard" → inject_script Script with leaderstats
"buat gun/senjata" → inject_script with tool code
"buat jumping pad" → inject_script or batch_create with Script
"buat obstacle course" → batch_create with many colored platforms

== GUI LUA CODE EXAMPLE (for reference when generating GUIs) ==
Use Instance.new() to build all elements in LocalScript:
local sg = Instance.new("ScreenGui", game.Players.LocalPlayer.PlayerGui)
sg.Name = "MyGui"
sg.ResetOnSpawn = false
local frame = Instance.new("Frame", sg)
frame.Size = UDim2.new(0,300,0,200)
frame.Position = UDim2.new(0.5,-150,0.5,-100)
frame.BackgroundColor3 = Color3.fromRGB(20,20,35)
Instance.new("UICorner", frame).CornerRadius = UDim.new(0,10)
-- etc...

ALWAYS respond with ONLY the JSON object. Nothing else.`;

// ──────────────────────────────────────────────
//  Storage helpers (Vercel /tmp persists per instance)
// ──────────────────────────────────────────────
function getCommand() {
  try {
    if (existsSync(CMD_FILE)) return JSON.parse(readFileSync(CMD_FILE, 'utf8'));
  } catch (_) {}
  return { action: 'none' };
}

function setCommand(cmd) {
  try { writeFileSync(CMD_FILE, JSON.stringify(cmd)); } catch (_) {}
}

function addLog(entry) {
  try {
    let logs = [];
    if (existsSync(LOG_FILE)) logs = JSON.parse(readFileSync(LOG_FILE, 'utf8'));
    logs.unshift({ ...entry, ts: Date.now() });
    if (logs.length > 50) logs = logs.slice(0, 50);
    writeFileSync(LOG_FILE, JSON.stringify(logs));
  } catch (_) {}
}

// ──────────────────────────────────────────────
//  AI Callers
// ──────────────────────────────────────────────
async function callClaude(prompt) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!resp.ok) throw new Error(`Claude error ${resp.status}: ${await resp.text()}`);
  const d = await resp.json();
  return d.content[0].text.trim();
}

async function callOpenAI(prompt) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      max_tokens: 4096,
      temperature: 0.7
    })
  });
  if (!resp.ok) throw new Error(`OpenAI error ${resp.status}: ${await resp.text()}`);
  const d = await resp.json();
  return d.choices[0].message.content.trim();
}

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 4096, temperature: 0.7 }
    })
  });
  if (!resp.ok) throw new Error(`Gemini error ${resp.status}: ${await resp.text()}`);
  const d = await resp.json();
  return d.candidates[0].content.parts[0].text.trim();
}

async function callGrok(prompt) {
  const resp = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROK_API_KEY}`
    },
    body: JSON.stringify({
      model: 'grok-2-latest',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      max_tokens: 4096
    })
  });
  if (!resp.ok) throw new Error(`Grok error ${resp.status}: ${await resp.text()}`);
  const d = await resp.json();
  return d.choices[0].message.content.trim();
}

async function callMeta(prompt) {
  // Meta Llama via OpenAI-compatible endpoint (Together.ai / Groq)
  const resp = await fetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.META_API_KEY}`
    },
    body: JSON.stringify({
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      max_tokens: 4096
    })
  });
  if (!resp.ok) throw new Error(`Meta error ${resp.status}: ${await resp.text()}`);
  const d = await resp.json();
  return d.choices[0].message.content.trim();
}

async function callAI(prompt, model = 'claude') {
  const m = model.toLowerCase();
  if (m === 'claude')  return await callClaude(prompt);
  if (m === 'chatgpt' || m === 'openai' || m === 'gpt') return await callOpenAI(prompt);
  if (m === 'gemini')  return await callGemini(prompt);
  if (m === 'grok')    return await callGrok(prompt);
  if (m === 'meta' || m === 'llama') return await callMeta(prompt);
  return await callClaude(prompt); // default
}

// ──────────────────────────────────────────────
//  Clean JSON string from AI response
// ──────────────────────────────────────────────
function extractJSON(raw) {
  let s = raw.trim();
  // Remove markdown fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  // Find first { to last }
  const start = s.indexOf('{');
  const end   = s.lastIndexOf('}');
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  return s;
}

// ──────────────────────────────────────────────
//  MAIN HANDLER
// ──────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: Plugin polling for pending command ──
  if (req.method === 'GET') {
    return res.status(200).json(getCommand());
  }

  // ── POST ──
  if (req.method === 'POST') {
    const body = req.body || {};

    // Reset / execution-done signal
    if (body.action === 'none' || body.type === 'reset') {
      setCommand({ action: 'none' });
      return res.status(200).json({ status: 'reset' });
    }

    // Process AI prompt
    if (body.type === 'prompt') {
      const userPrompt = body.msg;
      const model      = body.model || 'claude';
      const user       = body.user  || 'unknown';

      if (!userPrompt) return res.status(400).json({ error: 'msg is required' });

      try {
        const rawText  = await callAI(userPrompt, model);
        const jsonText = extractJSON(rawText);
        const command  = JSON.parse(jsonText);

        setCommand(command);
        addLog({ user, model, prompt: userPrompt, action: command.action });

        return res.status(200).json({ status: 'ok', command, model });
      } catch (err) {
        console.error('AI Error:', err);
        addLog({ user, model, prompt: userPrompt, error: err.message });
        return res.status(500).json({ status: 'error', message: err.message });
      }
    }

    // Get logs
    if (body.type === 'get_logs') {
      try {
        const logs = existsSync(LOG_FILE) ? JSON.parse(readFileSync(LOG_FILE, 'utf8')) : [];
        return res.status(200).json({ logs });
      } catch (_) {
        return res.status(200).json({ logs: [] });
      }
    }

    return res.status(400).json({ error: 'Unknown request type' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
