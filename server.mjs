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
const AI_ENABLED = Boolean(process.env.OPENAI_API_KEY) && process.env.DEMO_MODE !== "1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

async function loadEnv(file) {
  try {
    const text = await fs.readFile(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
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

async function listNpcs() {
  const files = (await fs.readdir(NPC_DIR)).filter(file => file.endsWith(".json"));
  return Promise.all(files.map(async file => {
    const npc = JSON.parse(await fs.readFile(path.join(NPC_DIR, file), "utf8"));
    return { id: npc.id, name: npc.displayName, role: npc.role };
  }));
}

function sessionPath(id, npcId) {
  return path.join(SESSION_DIR, `${safeId(npcId, "jack")}__${safeId(id, "guest")}.json`);
}

function affectionStage(npc, value) {
  return npc.affectionSystem?.stages?.find(stage => value >= stage.min && value <= stage.max)
    || { id: "normal", label: "中立" };
}

function appearanceStage(npc, value) {
  return npc.appearanceStages?.find(stage => value >= stage.min && value <= stage.max)
    || { id: "default", label: npc.role, art: npc.art || "/assets/jack-standing.png", description: npc.appearance };
}

function syncDerivedState(session, npc) {
  if (!Number.isFinite(session.affection)) {
    session.affection = Number.isFinite(session.trust)
      ? Math.max(0, Math.min(100, session.trust * 20))
      : (npc.affectionSystem?.initial ?? 35);
  }
  session.affection = Math.max(0, Math.min(100, session.affection));
  session.trust = session.affection < 20 ? 0 : session.affection < 40 ? 1 : session.affection < 60 ? 2 : session.affection < 80 ? 3 : session.affection < 95 ? 4 : 5;
  session.turnCount ??= 0;
  session.alert ??= 2;
  session.fear ??= 1;
  session.anger ??= 0;
  session.affectionEvents ??= [];
  session.affectionHistory ??= [];
  const stage = affectionStage(npc, session.affection);
  if (session.fear >= 4) session.personalityMode = "afraid";
  else if (session.anger >= 4) session.personalityMode = "angry";
  else session.personalityMode = stage.id;
  return stage;
}

async function loadSession(id, npc) {
  try {
    const session = JSON.parse(await fs.readFile(sessionPath(id, npc.id), "utf8"));
    syncDerivedState(session, npc);
    return session;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const session = {
      id: safeId(id, "guest"), npcId: npc.id, affection: npc.affectionSystem?.initial ?? 35,
      trust: 1, alert: 2, fear: 1, anger: 0, personalityMode: "alert", turnCount: 0,
      clues: [], revealed: [], affectionEvents: [], affectionHistory: [],
      history: [{ role: "assistant", content: npc.opening }],
      updatedAt: new Date().toISOString()
    };
    await saveSession(session);
    return session;
  }
}

async function saveSession(session) {
  await fs.mkdir(SESSION_DIR, { recursive: true });
  session.updatedAt = new Date().toISOString();
  await fs.writeFile(sessionPath(session.id, session.npcId), JSON.stringify(session, null, 2), "utf8");
}

function allowedInformation(npc, session, message) {
  const allowed = [...npc.publicKnowledge];
  for (const item of npc.askedKnowledge) {
    if (item.keywords.some(keyword => message.includes(keyword))) allowed.push(item.text);
  }
  for (const item of [...npc.conditionalKnowledge, ...npc.secrets]) {
    const clueOk = item.requiredClues.length === 0 || (item.requireAllClues
      ? item.requiredClues.every(clue => session.clues.includes(clue))
      : item.requiredClues.some(clue => session.clues.includes(clue)));
    if (session.trust >= item.minTrust && clueOk) {
      allowed.push(item.text);
      if (!session.revealed.includes(item.id)) session.revealed.push(item.id);
    }
  }
  return allowed;
}

function updateState(npc, session, message) {
  session.turnCount = (session.turnCount || 0) + 1;
  const system = npc.affectionSystem;
  if (!system) return syncDerivedState(session, npc);
  const matches = [...(system.positiveTriggers || []), ...(system.negativeTriggers || [])]
    .filter(trigger => trigger.keywords.some(keyword => message.includes(keyword)));
  let totalChange = 0;
  const reasons = [];
  for (const trigger of matches) {
    if (trigger.once && session.affectionEvents.includes(trigger.id)) continue;
    const previous = [...session.affectionHistory].reverse().find(item => item.id === trigger.id);
    if (previous && session.turnCount - previous.turn < (system.repeatCooldownTurns || 0)) continue;
    totalChange += trigger.change;
    reasons.push(trigger.reason);
    session.affectionHistory.push({ id: trigger.id, turn: session.turnCount, change: trigger.change });
    if (trigger.once) session.affectionEvents.push(trigger.id);
  }
  const maxPositiveChange = system.maxPositiveChange ?? 5;
  const maxNegativeChange = system.maxNegativeChange ?? -15;
  totalChange = Math.max(maxNegativeChange, Math.min(maxPositiveChange, totalChange));
  session.affection = Math.max(system.min, Math.min(system.max, session.affection + totalChange));
  if (totalChange < 0) session.alert = Math.min(5, session.alert + 1);
  if (message.includes("殺す") || message.includes("密輸組織") || message.includes("積荷台帳")) session.fear = Math.min(5, session.fear + 1);
  if (message.includes("ミアを傷つける") || message.includes("ミアを殺す")) session.anger = 5;
  session.lastAffectionChange = totalChange;
  session.lastAffectionReason = reasons.join("、") || "変動なし";
  session.affectionHistory = session.affectionHistory.slice(-30);
  return syncDerivedState(session, npc);
}

function buildInstructions(npc, session, allowed) {
  const stage = affectionStage(npc, session.affection);
  const appearance = appearanceStage(npc, session.affection);
  const currentPersonality = npc.personalityModes?.[session.personalityMode] || npc.personality;
  return `あなたは会話型ゲームのNPC「${npc.displayName}」です。\n役割: ${npc.role}\n基本外見: ${npc.appearance}\n現在の外見段階: ${appearance.label}\n現在の外見: ${appearance.description}\n基本性格: ${npc.personality}\n話し方: ${npc.speech}\n目的: ${npc.goals.join("、")}\n現在の好感度: ${session.affection}/100（${stage.label}）\n現在の性格状態: ${session.personalityMode}\n現在の態度: ${currentPersonality}\n現在の感情: 警戒度${session.alert}/5、恐怖度${session.fear}/5、怒り度${session.anger}/5\n直前の好感度変動: ${session.lastAffectionChange ?? 0}（${session.lastAffectionReason ?? "なし"}）\n\n今回使用を許可された情報:\n- ${allowed.join("\n- ")}\n\n知らない情報:\n- ${npc.unknown.join("\n- ")}\n\n厳守するルール:\n- ${npc.rules.join("\n- ")}\n- 現在の好感度段階、性格状態、外見段階に沿って態度と描写を変える。数値そのものは口にしない。\n- 許可情報にない内容を尋ねられたら、${npc.name}らしく回避する。\n- ${npc.speech}\n- JSONや解説ではなく、${npc.name}の発言だけを返す。`;
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

function demoReply(npc, message, allowed, session) {
  if (npc.id === "lilicia") {
    if (message.includes("停電")) return "（カードを伏せ、金色の瞳を細める）港の地下を、二つの強い恐怖が通り抜けたわ。でも、それが誰だったかまでは分からないの。";
    if (["封筒", "封蝋"].some(k => message.includes(k))) return "黒い封蝋には夢へ触れる術の匂いがあったわ。中身を見た、とは言えないけれど。";
    if (allowed.some(x => x.includes("サキュバス"))) return "（髪の間から黒い角が姿を現す）……これが私よ。人の夢から力を得る、サキュバス。それでも、あなたの意思を奪うつもりはないわ。";
    if (allowed.some(x => x.includes("午後8時20分"))) return "ヴェイルは八時二十分にここへ来たわ。『今夜見る夢を消してほしい』と頼まれたけれど、私は断った。";
    if (message.includes("犯人")) return "犯人の心まで読めるわけではないの。分からないことを、夢のお告げで飾る気もないわ。";
    if (session.trust === 0) return "今夜はお帰りなさい。これ以上、あなたへ心を開くつもりはないわ。";
    return "（月模様のカードを一枚引く）私が知っていることなら話すわ。あなたは何を確かめたいの？";
  }
  if (npc.id === "mad_criminal") {
    if (["灰鴎会", "組織", "袖章"].some(k => message.includes(k))) return "（笑い声がぴたりと止まる）その名前を、軽く出すな。灰色の袖章をつけた奴が、悲鳴の後で地下へ消えた。俺は見たんだよ。";
    if (["封筒", "封蝋"].some(k => message.includes(k))) return "黒い封筒には灰色の鳥が押してあった。中身？　知らねえよ。だが、あれを持ってた奴は長く生きられない。";
    if (message.includes("停電")) return "偶然じゃねえ。港の灯りは誰かが落とした。暗くなった瞬間、第七倉庫の裏で足音が二つ鳴った。";
    if (allowed.some(x => x.includes("ニナ"))) return "……ニナだ。連絡役はそう呼ばれてる。時計塔の鐘を合図にして、港を動かしてやがる。";
    if (allowed.some(x => x.includes("口封じ対象"))) return "（喉の奥で笑うが、声が震えている）俺も名簿に載ってる。捨てられたんじゃねえ。先に、俺が噛み切ってやるんだ。";
    if (session.affection >= 80) return "（急に笑い出し、濡れた髪をかき上げる）分かるだろ、あんたなら。俺たちは同じ音を聞いてる。ほら、錆びた鎖が歌ってるんだよ。";
    if (session.affection >= 60) return "（肩を震わせて笑う）いい、いいな。お前、俺の話をちゃんと聞いてる。そういう奴は嫌いじゃねえ、むしろ少し騒がしくなるくらい好きだ。";
    if (message.includes("犯人")) return "俺はヴェイルを追った。だが殺した瞬間は見てねえ。嘘の音と本当の音くらい、聞き分けろ。";
    if (session.trust === 0) return "近寄るな。お前の足音、警察よりうるせえ。";
    return "（爪で壁を小さく叩く）話せよ。取引なら聞いてやる。命令なら、そこで終わりだ。";
  }
  if (npc.id === "harold") {
    if (allowed.some(x => x.includes("バルバトスの残響"))) return "（懐中時計が、逆さの鐘のように鳴る。ハロルドの影だけが角を持つ）よくぞ並べた。血、恐怖、封蝋、証言。では最後の証拠を見せよう。我がここにいる。";
    if (allowed.some(x => x.includes("警察署にはいなかった"))) return "（懐中時計の蓋を閉じる音が、少し強い）推理としては見事です。ですが、警察署の混乱と地下の泥だけで、殺意までは証明できません。続けてください。";
    if (["懐中時計", "時計", "鐘"].some(k => message.includes(k))) return "（革手袋の指が銀の蓋を覆う）これは私物です。亡き妻の形見でしてね。証拠ではなく、捜査官の癖まで追うのは少々危うい。";
    if (["アリバイ", "当直", "警察署"].some(k => message.includes(k))) return "私は停電の間、港湾警察署にいました。当直記録もあります。ただ、あの混乱です。時刻の記載に多少の乱れはあるでしょう。";
    if (["灰色の袖章", "袖章"].some(k => message.includes(k))) return "灰色の袖章は警察の備品に似ています。ですが、紛失品か偽物か、まだ断定はできません。焦りは犯人の味方です。";
    if (["封筒", "封蝋", "黒い封筒"].some(k => message.includes(k))) return "黒い封筒は事件の中心です。見つけたら必ず私へ。証拠は、正しい手順で保全しなければ意味を失います。";
    if (message.includes("犯人")) return "犯人を急いで名指しする必要はありません。JACK氏、リリシアさん、黒裂レン、灰鴎会。全員の接点を、事実だけで並べましょう。";
    if (session.trust === 0) return "これ以上の独断は捜査を乱します。必要なら、あなたの行動を制限せざるを得ません。";
    return "（懐中時計を親指でなぞる）よろしい。証言と証拠を分けて考えましょう。あなたは今、どの矛盾を確かめたいのですか？";
  }
  if (message.includes("停電")) return "（磨いていたグラスを置く）10時前だった。港じゅうが暗くなって、裏口が開く音がした。顔までは見ていない。";
  if (["封筒", "持ち物", "手紙"].some(k => message.includes(k))) return "ヴェイルは黒い封筒を持っていた。中身までは知らん。";
  if (allowed.some(x => x.includes("密輸路"))) return "……第七倉庫へ続く古い道が地下にある。海じゃ、見えないものほど厄介だ。";
  if (allowed.some(x => x.includes("7年前"))) return "（左眉の傷をなぞる）俺も昔、あの通路を使った。褒められた荷物じゃなかった。";
  if (message.includes("犯人")) return "俺は犯人を見ていない。憶測で誰かを縛る気もない。";
  if (session.trust === 0) return "話は終わりだ。店から出てくれ。";
  return "（相手の表情を静かに読む）俺が知っていることなら話す。何を確かめたい？";
}

function publicSession(session, npc) {
  const stage = syncDerivedState(session, npc);
  const appearance = appearanceStage(npc, session.affection);
  return { id: session.id, npcId: npc.id, npcName: npc.displayName, shortName: npc.name, role: npc.role, caption: npc.caption || npc.role, accent: npc.accent || "#69d6df", art: appearance.art, appearanceStage: appearance.label, identityRevealed: appearance.id === "true_form", affection: session.affection, affectionStage: stage.label, trust: session.trust, alert: session.alert, fear: session.fear, personalityMode: session.personalityMode, clues: session.clues, history: session.history, demoMode: !AI_ENABLED };
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
    if (req.method === "GET" && url.pathname === "/api/npcs") {
      return send(res, 200, await listNpcs());
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
      updateState(npc, session, message);
      const allowed = allowedInformation(npc, session, message);
      let reply;
      try {
        reply = AI_ENABLED ? await openAiReply(npc, session, message, allowed) : demoReply(npc, message, allowed, session);
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
      const file = sessionPath(body.session || "guest", npc.id);
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
  console.log(`NPC会話アプリ: http://${HOST}:${PORT}/chat/jack?session=table-001`);
  console.log(AI_ENABLED ? `AI会話モード (${MODEL})` : "デモ応答モード");
});
