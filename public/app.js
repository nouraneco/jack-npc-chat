const params = new URLSearchParams(location.search);
const npc = location.pathname.split("/").filter(Boolean)[1] || params.get("npc") || "jack";
const session = (params.get("session") || "guest").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "guest";
const $ = id => document.getElementById(id);

function renderMessage(item) {
  const div = document.createElement("div");
  div.className = `message ${item.role}`;
  const speaker = document.createElement("span");
  speaker.className = "speaker";
  speaker.textContent = item.role === "assistant" ? "JACK" : "YOU";
  const content = document.createElement("span");
  content.textContent = item.content;
  div.append(speaker, content);
  $("messages").append(div);
}

function render(data) {
  $("npc-name").textContent = data.npcName;
  $("npc-role").textContent = data.role;
  $("session-id").textContent = data.id;
  $("affection").textContent = `${data.affection}/100`;
  $("affection-stage").textContent = data.affectionStage;
  $("alert").textContent = `${data.alert}/5`;
  $("fear").textContent = `${data.fear}/5`;
  $("mode").textContent = data.demoMode ? "デモ応答モード" : "AI会話モード";
  $("messages").replaceChildren();
  data.history.forEach(renderMessage);
  $("messages").scrollTop = $("messages").scrollHeight;
}

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "通信に失敗しました");
  return data;
}

async function load() {
  try { render(await request(`/api/session?npc=${encodeURIComponent(npc)}&session=${encodeURIComponent(session)}`)); }
  catch (error) { alert(error.message); }
}

$("chat-form").addEventListener("submit", async event => {
  event.preventDefault();
  const message = $("message").value.trim();
  if (!message) return;
  $("send").disabled = true;
  renderMessage({ role:"user", content:message });
  $("message").value = "";
  try {
    const data = await request("/api/chat", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({npc,session,message}) });
    render(data.session);
  } catch (error) {
    renderMessage({ role:"assistant", content:`（通信エラー）${error.message}` });
  } finally { $("send").disabled = false; $("message").focus(); }
});

$("message").addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); $("chat-form").requestSubmit(); }
});

$("reset").addEventListener("click", async () => {
  if (!confirm("この卓の会話履歴を最初からやり直しますか？")) return;
  try { render(await request("/api/reset", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({npc,session}) })); }
  catch (error) { alert(error.message); }
});

load();
