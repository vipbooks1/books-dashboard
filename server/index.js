// server/index.js
// Minimal Express agent with run-history logging and a simple viewer.
// Do NOT commit your OPENAI_API_KEY. Set it in your deploy environment.

const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch'); // or native fetch on newer node
const app = express();
app.use(express.json());

const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
if (!OPENAI_KEY) console.warn("OPENAI_API_KEY not set - set in env variables");

const HISTORY_FILE = path.join(__dirname, 'runs.json'); // created if not exists

function ensureHistoryFile(){
  if (!fs.existsSync(HISTORY_FILE)){
    try { fs.writeFileSync(HISTORY_FILE, '[]', 'utf8'); } catch(e){ console.error("create history err", e); }
  }
}
ensureHistoryFile();

function appendHistory(entry){
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8') || '[]';
    const arr = JSON.parse(raw);
    arr.push(entry);
    // Keep only last 1000 runs to avoid huge files
    if (arr.length > 1000) arr.splice(0, arr.length - 1000);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(arr, null, 2), 'utf8');
  } catch(e){
    console.error("history append error", e);
  }
}

function buildPrompt(row){
  const title = row.title || row.Title || row.Name || '';
  const keywords = row.keywords || row.Keywords || row.Tags || '';
  return `You are a concise marketing copywriter.
Given the product with title: "${title}" and keywords: "${keywords}", produce:
1) Short product description (2-3 sentences)
2) 5 bullet point benefits
3) 3 ad headlines (short, catchy)
4) Suggested tags/keywords (comma separated)
Respond as JSON: {"description":"...","bullets":["..."],"headlines":["..."],"tags":"..."}.
If fields are missing, use best guess.`;
}

app.post('/generate', async (req, res) => {
  const start = Date.now();
  const row = req.body.row || {};
  const prompt = buildPrompt(row);
  const entryStart = {
    timestamp: new Date().toISOString(),
    input: row,
    model: 'openai-chat',
    promptSnippet: (''+prompt).slice(0, 600),
    status: 'started'
  };
  appendHistory(Object.assign({}, entryStart)); // log start

  try {
    // call OpenAI Chat Completions (example). Swap model if needed.
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{role:'system',content:'You are a helpful assistant.'},{role:'user',content:prompt}],
        temperature:0.7,
        max_tokens:600
      })
    });

    const json = await openaiRes.json();
    const text = json.choices && json.choices[0] && (json.choices[0].message?.content || json.choices[0].text) || JSON.stringify(json);
    let output;
    try { output = JSON.parse(text); } catch(e) { output = { raw: text }; }

    const duration = Date.now() - start;
    const finishedEntry = {
      timestamp: new Date().toISOString(),
      duration_ms: duration,
      input: row,
      model: "gpt-4o",
      response_raw: (''+text).slice(0, 10000),
      parsed_output: output,
      status: 'success'
    };
    appendHistory(finishedEntry);

    return res.json({ output });
  } catch (err) {
    console.error(err);
    const errEntry = {
      timestamp: new Date().toISOString(),
      input: row,
      error: (err && err.message) ? err.message : String(err),
      status: 'error'
    };
    appendHistory(errEntry);
    return res.status(500).json({ error: err.message || 'server error' });
  }
});

// Expose raw JSON history
app.get('/history', (req, res) => {
  ensureHistoryFile();
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8') || '[]';
    res.setHeader('Content-Type','application/json');
    res.send(raw);
  } catch(e){
    res.status(500).json({ error: 'cannot read history' });
  }
});

// Simple human-friendly history page
app.get('/history.html', (req, res) => {
  ensureHistoryFile();
  const html = fs.readFileSync(path.join(__dirname, 'history_viewer.html'), 'utf8');
  res.setHeader('Content-Type','text/html');
  res.send(html);
});

const port = process.env.PORT || 3000;
app.listen(port, ()=> console.log('Agent server listening on', port));
