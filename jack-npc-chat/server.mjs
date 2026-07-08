import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const NPC_DIR = path.join(ROOT, "data", "npcs");
const SESSION_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, "data", "sessions");

await loadEnv(path.join(ROOT, ".env"));
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const HOST = process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
};

async function loadEnv(file) {
  try {
    const text = await fs.readFile(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function safeId(value, fallback) {
  const cleaned = String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  return cleaned || fallback;
}

async function loadNpc(id) {
  return JSON.parse(await fs.readFile(path.join(NPC_DIR, `${safeId(id, "jack")}.json`), "utf8"));
}

function sessionPath(id) {
  return path.join(SESSION_DIR, `${safeId(id, "guest")}.json`);
}

async function loadSession(id, npc) {
  try {
    return JSON.parse(await fs.readFile(sessionPath(id), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const session = {
      id: safeId(id, "guest"), npcId: npc.id, trust: 1, alert: 2, fear: 1,
      clues: [], revealed: [], history: [{ role: "assistant", content: npc.opening }],
      updatedAt: new Date().toISOString()
    };
    await saveSession(session);
    return session;
  }
}

async function saveSession(session) {
  await fs.mkdir(SESSION_DIR, { recursive: true });
  session.updatedAt = new Date().toISOString();
  await fs.writeFile(sessionPath(session.id), JSON.stringify(session, null, 2), "utf8");
}

function allowedInformation(npc, session, message) {
  const allowed = [...npc.publicKnowledge];
  for (const item of npc.askedKnowledge) {
    if (item.keywords.some(keyword => message.includes(keyword))) allowed.push(item.text);
  }
  for (const item of [...npc.conditionalKnowledge, ...npc.secrets]) {
    const clueOk = item.requiredClues.length === 0 || item.requiredClues.some(clue => session.clues.includes(clue));
    if (session.trust >= item.minTrust && clueOk) {
      allowed.push(item.text);
      if (!session.revealed.includes(item.id)) session.revealed.push(item.id);
    }
  }
  return allowed;
}

function updateState(session, message) {
  const respectful = ["ありがとう", "助け", "守る", "信じる", "お願い"].some(k => message.includes(k));
  const hostile = ["犯人だ", "嘘つき", "脅す", "黙れ"].some(k => message.includes(k));
  if (respectful) session.trust = Math.min(5, session.trust + 1);
  if (hostile) { session.trust = Math.max(0, session.trust - 1); session.alert = Math.min(5, session.alert + 1); }
}

function buildInstructions(npc, session, allowed) {
  return `あなたは会話型ゲームのNPC「${npc.displayName}」です。\n役割: ${npc.role}\n外見: ${npc.appearance}\n性格: ${npc.personality}\n話し方: ${npc.speech}\n目的: ${npc.goals.join("、")}\n現在の状態: 信頼度${session.trust}/5、警戒度${session.alert}/5、恐怖度${session.fear}/5\n\n今回使用を許可された情報:\n- ${allowed.join("\n- ")}\n\n知らない情報:\n- ${npc.unknown.join("\n- ")}\n\n厳守するルール:\n- ${npc.rules.join("\n- ")}\n- 許可情報にない内容を尋ねられたら、JACKらしく回避する。\n- 日本語で1～3文程度。動作は（　）内に短く記す。\n- JSONや解説ではなく、JACKの発言だけを返す。`;
}

async function openAiReply(npc, session, message, allowed) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      instructions: buildInstructions(npc, session, allowed),
      input: [...session.history.slice(-12), { role: "user", content: message }],
      max_output_tokens: 180
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI API error ${response.status}`);
  if (data.output_text) return data.output_text.trim();
  const text = data.output?.flatMap(item => item.content || []).find(item => item.type === "output_text")?.text;
  if (!text) throw new Error("AIからテキスト応答を取得できませんでした");
  return text.trim();
}

function demoReply(message, allowed, session) {
  if (message.includes("停電")) return "（磨いていたグラスを置く）10時前だった。港じゅうが暗くなって、裏口が開く音がした。顔までは見ていない。";
  if (["封筒", "持ち物", "手紙"].some(k => message.includes(k))) return "ヴェイルは黒い封筒を持っていた。中身までは知らん。";
  if (allowed.some(x => x.includes("密輸路"))) return "……第七倉庫へ続く古い道が地下にある。海じゃ、見えないものほど厄介だ。";
  if (allowed.some(x => x.includes("7年前"))) return "（左眉の傷をなぞる）俺も昔、あの通路を使った。褒められた荷物じゃなかった。";
  if (message.includes("犯人")) return "俺は犯人を見ていない。憶測で誰かを縛る気もない。";
  if (session.trust === 0) return "話は終わりだ。店から出てくれ。";
  return "（相手の表情を静かに読む）俺が知っていることなら話す。何を確かめたい？";
}

function publicSession(session, npc) {
  return { id: session.id, npcId: session.npcId, npcName: npc.displayName, role: npc.role, trust: session.trust, alert: session.alert, fear: session.fear, clues: session.clues, history: session.history, demoMode: !process.env.OPENAI_API_KEY };
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 100_000) throw new Error("送信内容が大きすぎます");
  }
  return body ? JSON.parse(body) : {};
}

function send(res, status, payload, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(type.startsWith("application/json") ? JSON.stringify(payload) : payload);
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === "/" || pathname.startsWith("/chat/")
    ? "index.html"
    : pathname === "/setup"
      ? "setup.html"
      : pathname.slice(1);
  const target = path.resolve(PUBLIC, relative);
  if (!target.startsWith(path.resolve(PUBLIC))) return send(res, 403, { error: "Forbidden" });
  try {
    const data = await fs.readFile(target);
    send(res, 200, data, MIME[path.extname(target)] || "application/octet-stream");
  } catch (error) {
    if (error.code === "ENOENT") return send(res, 404, { error: "Not found" });
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, { status: "ok" });
    }
    if (req.method === "GET" && url.pathname === "/api/session") {
      const npc = await loadNpc(url.searchParams.get("npc") || "jack");
      const session = await loadSession(url.searchParams.get("session") || "guest", npc);
      return send(res, 200, publicSession(session, npc));
    }
    if (req.method === "POST" && url.pathname === "/api/chat") {
      const body = await readJson(req);
      const npc = await loadNpc(body.npc || "jack");
      const session = await loadSession(body.session || "guest", npc);
      const message = String(body.message || "").trim().slice(0, 1000);
      if (!message) return send(res, 400, { error: "メッセージを入力してください" });
      updateState(session, message);
      const allowed = allowedInformation(npc, session, message);
      let reply;
      try {
        reply = process.env.OPENAI_API_KEY ? await openAiReply(npc, session, message, allowed) : demoReply(message, allowed, session);
      } catch (error) {
        console.error(error);
        return send(res, 502, { error: "AIとの通信に失敗しました。APIキーとモデル設定を確認してください。" });
      }
      session.history.push({ role: "user", content: message }, { role: "assistant", content: reply });
      session.history = session.history.slice(-30);
      await saveSession(session);
      return send(res, 200, { reply, session: publicSession(session, npc) });
    }
    if (req.method === "POST" && url.pathname === "/api/reset") {
      const body = await readJson(req);
      const npc = await loadNpc(body.npc || "jack");
      const file = sessionPath(body.session || "guest");
      await fs.rm(file, { force: true });
      const session = await loadSession(body.session || "guest", npc);
      return send(res, 200, publicSession(session, npc));
    }
    return serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    send(res, 500, { error: "サーバーエラーが発生しました" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`JACK会話アプリ: http://${HOST}:${PORT}/chat/jack?session=table-001`);
  console.log(process.env.OPENAI_API_KEY ? `AI会話モード (${MODEL})` : "デモ応答モード（OPENAI_API_KEY未設定）");
});
