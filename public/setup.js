const $ = id => document.getElementById(id);

const questions = [
  {
    key:"goal", icon:"1", title:"どこまで試したいですか？",
    help:"まずは無料で公開画面だけ試すことも、本番用のAI会話まで設定することもできます。",
    choices:[
      {value:"demo",label:"まず無料で公開して試したい",detail:"用意済みのデモ返答で、外部リンクを確認します"},
      {value:"ai",label:"JACKとAIで自由に会話したい",detail:"OpenAIのAPIキーを使います"}
    ]
  },
  {
    key:"github", icon:"2", title:"GitHubのアカウントを持っていますか？",
    help:"GitHubは、アプリのファイルをRenderへ渡すための保管場所です。無料で作れます。",
    choices:[
      {value:"yes",label:"持っている",detail:"すでにログインできる状態です"},
      {value:"no",label:"持っていない／分からない",detail:"アカウント作成から案内します"}
    ]
  },
  {
    key:"uploaded", icon:"3", title:"jack-webフォルダをGitHubへ置きましたか？",
    help:"まだなら問題ありません。結果画面に、ファイルを置く手順を表示します。",
    choices:[
      {value:"yes",label:"置いてある",detail:"GitHub上でjack-webフォルダを確認できます"},
      {value:"no",label:"まだ置いていない",detail:"これからアップロードします"},
      {value:"unknown",label:"よく分からない",detail:"まだ置いていないものとして案内します"}
    ]
  },
  {
    key:"api", icon:"4", title:"OpenAIのAPIキーを持っていますか？",
    help:"APIキーはAIを利用するための秘密の合言葉です。ChatGPTのログインとは別に取得します。",
    show:a=>a.goal==="ai",
    choices:[
      {value:"yes",label:"持っている",detail:"sk- などで始まる秘密の文字列です"},
      {value:"no",label:"持っていない／分からない",detail:"取得方法を案内します"}
    ]
  },
  {
    key:"history", icon:"5", title:"会話履歴を再起動後も残したいですか？",
    help:"無料の簡易公開では、サーバーの再起動時に履歴が消えることがあります。",
    choices:[
      {value:"keep",label:"残したい",detail:"有料の永続保存を使う手順を表示します"},
      {value:"temporary",label:"試作なので消えてもよい",detail:"まず費用をかけずに公開します"}
    ]
  }
];

let answers = {}, visible = [], position = 0;

function refreshVisible(){ visible=questions.filter(q=>!q.show||q.show(answers)); }
function showQuestion(){
  refreshVisible();
  const q=visible[position];
  $("step-label").textContent=`質問 ${position+1} / ${visible.length}`;
  $("progress-bar").style.width=`${((position+1)/visible.length)*100}%`;
  $("question-icon").textContent=q.icon;
  $("question").textContent=q.title;
  $("question-help").textContent=q.help;
  $("previous").hidden=position===0;
  $("choices").replaceChildren(...q.choices.map(choice=>{
    const button=document.createElement("button");button.type="button";button.className="choice";
    button.innerHTML=`<strong>${choice.label}</strong><span>${choice.detail}</span>`;
    button.addEventListener("click",()=>{answers[q.key]=choice.value;refreshVisible();if(position<visible.length-1){position++;showQuestion();}else showResult();});
    return button;
  }));
}

function addAction(list,title,text,code=""){
  const li=document.createElement("li");li.className="action";
  const h=document.createElement("h3");h.textContent=title;
  const p=document.createElement("p");p.innerHTML=text;
  li.append(h,p);
  if(code){const c=document.createElement("code");c.className="code";c.textContent=code;li.append(c);}
  list.append(li);
}

function showResult(){
  $("wizard").classList.add("hidden");$("result").classList.remove("hidden");
  const summary=$("summary");summary.replaceChildren();
  [answers.goal==="ai"?"AI会話":"デモ公開",answers.history==="keep"?"履歴を保存":"無料で試作",answers.github==="yes"?"GitHubあり":"GitHub作成から"].forEach(t=>{const s=document.createElement("span");s.className="tag";s.textContent=t;summary.append(s);});
  const list=$("action-list");list.replaceChildren();
  if(answers.github!=="yes") addAction(list,"GitHubの無料アカウントを作る",`<a href="https://github.com/signup" target="_blank" rel="noopener">GitHubの登録画面</a>を開き、画面の案内に沿って登録します。`);
  if(answers.uploaded!=="yes") addAction(list,"アプリの保管場所を作る",`GitHubで「New repository」を押し、名前を <b>jack-npc-chat</b> にします。その中へ、このパソコンの <b>jack-web</b> フォルダ内のファイルをアップロードします。`);
  if(answers.goal==="ai"&&answers.api!=="yes") addAction(list,"AI用のAPIキーを用意する",`<a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">OpenAIのAPIキー画面</a>でキーを作ります。表示された文字は一度しか確認できないため、安全な場所へ保存します。`);
  addAction(list,"Renderにログインする",`<a href="https://dashboard.render.com/" target="_blank" rel="noopener">Render</a>を開き、「GitHubでログイン」を選びます。`);
  addAction(list,"Web Serviceを作る",`Renderで <b>New ＋</b> → <b>Web Service</b> を押し、先ほどの <b>jack-npc-chat</b> を選びます。`);
  addAction(list,"起動方法を入力する",`Root Directoryには何も入れません。Build CommandとStart Commandへ、次の値を入れます。`,`Build Command: npm install\nStart Command: npm start\nHealth Check Path: /health`);
  if(answers.goal==="ai") addAction(list,"秘密のAPIキーをRenderへ登録する",`RenderのEnvironmentで <b>Add Environment Variable</b> を押します。ブラウザのURLやGitHubにはAPIキーを貼らないでください。`,`OPENAI_API_KEY = 取得した秘密のキー\nOPENAI_MODEL = gpt-5.4-mini`);
  if(answers.history==="keep") addAction(list,"会話履歴の保存場所を追加する",`RenderのDisksで永続ディスクを追加し、Environmentにも保存先を登録します。この機能は有料サービスで利用します。`,`Mount Path: /var/data\nDATA_DIR = /var/data`);
  else addAction(list,"無料のまま公開する",`永続ディスクは追加せず、そのまま <b>Create Web Service</b> を押します。再起動時に会話履歴が消える可能性がありますが、試作には使えます。`);
  addAction(list,"完成したリンクを使う",`Renderに <b>Live</b> と表示されたら、発行されたURLの末尾へ次を付けます。`, `/chat/jack?session=table-001`);
  window.scrollTo({top:0,behavior:"smooth"});
}

$("start").addEventListener("click",()=>{$("intro").classList.add("hidden");$("wizard").classList.remove("hidden");position=0;showQuestion();});
$("previous").addEventListener("click",()=>{if(position>0){position--;showQuestion();}});
$("restart").addEventListener("click",()=>{answers={};position=0;$("result").classList.add("hidden");$("wizard").classList.remove("hidden");showQuestion();});
$("copy").addEventListener("click",async()=>{const text=[...document.querySelectorAll(".action")].map((e,i)=>`${i+1}. ${e.innerText}`).join("\n\n");await navigator.clipboard.writeText(text);$("copy").textContent="コピーしました";setTimeout(()=>$("copy").textContent="手順をコピー",1800);});
