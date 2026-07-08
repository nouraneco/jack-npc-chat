const params = new URLSearchParams(location.search);
let npc = location.pathname.split("/").filter(Boolean)[1] || params.get("npc") || "jack";
const session = (params.get("session") || "guest").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "guest";
const $ = id => document.getElementById(id);
let currentNpcName = "NPC";

function renderMessage(item) {
  const div = document.createElement("div");
  div.className = `message ${item.role}`;
  const speaker = document.createElement("span");
  speaker.className = "speaker";
  speaker.textContent = item.role === "assistant" ? currentNpcName : "YOU";
  const content = document.createElement("span");
  content.textContent = item.content;
  div.append(speaker, content);
  $("messages").append(div);
}

function render(data) {
  currentNpcName = data.shortName;
  document.title = `${data.shortName}との会話`;
  document.documentElement.style.setProperty("--accent", data.accent);
  document.body.dataset.npc = data.npcId;
  $("npc-name").textContent = data.npcName;
  $("npc-role").textContent = data.role;
  $("portrait").textContent = data.shortName.slice(0, 1);
  $("character-name").textContent = data.shortName;
  $("character-caption").textContent = data.caption;
  $("character-art").src = data.art;
  $("character-art").alt = `${data.npcName}の立ち絵（${data.appearanceStage}）`;
  $("character-stage").setAttribute("aria-label", `${data.npcName}の立ち絵`);
  $("session-id").textContent = data.id;
  $("affection").textContent = `${data.affection}/100`;
  $("affection-stage").textContent = data.affectionStage;
  $("appearance-stage").textContent = data.appearanceStage;
  $("alert").textContent = `${data.alert}/5`;
  $("fear").textContent = `${data.fear}/5`;
  $("mode").textContent = data.demoMode ? "デモ応答モード" : "AI会話モード";
  $("message").placeholder = `${data.shortName}に話しかける…`;
  $("npc-picker").value = data.npcId;
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

async function loadNpcChoices() {
  const npcs = await request("/api/npcs");
  $("npc-picker").replaceChildren(...npcs.map(item => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${item.name} — ${item.role}`;
    return option;
  }));
}

async function load() {
  try {
    await loadNpcChoices();
    render(await request(`/api/session?npc=${encodeURIComponent(npc)}&session=${encodeURIComponent(session)}`));
  } catch (error) {
    alert(error.message);
  }
}

$("npc-picker").addEventListener("change", async event => {
  npc = event.target.value;
  history.pushState({ npc }, "", `/chat/${encodeURIComponent(npc)}?session=${encodeURIComponent(session)}`);
  $("messages").replaceChildren();
  try {
    render(await request(`/api/session?npc=${encodeURIComponent(npc)}&session=${encodeURIComponent(session)}`));
    $("message").focus();
  } catch (error) {
    alert(error.message);
  }
});

window.addEventListener("popstate", async () => {
  npc = location.pathname.split("/").filter(Boolean)[1] || "jack";
  try { render(await request(`/api/session?npc=${encodeURIComponent(npc)}&session=${encodeURIComponent(session)}`)); }
  catch (error) { alert(error.message); }
});

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
  } finally {
    $("send").disabled = false;
    $("message").focus();
  }
});

$("message").addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("chat-form").requestSubmit();
  }
});

$("reset").addEventListener("click", async () => {
  if (!confirm(`${currentNpcName}との会話履歴を最初からやり直しますか？`)) return;
  try {
    render(await request("/api/reset", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({npc,session}) }));
  } catch (error) {
    alert(error.message);
  }
});

load();
