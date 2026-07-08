JACK 会話Webアプリ
===================

■ すぐに試す方法（APIキー不要）

1. このフォルダでPowerShellを開きます。
2. 次のコマンドを実行します。

   npm start

3. ブラウザで次のURLを開きます。

   http://127.0.0.1:3000/chat/jack?session=table-001

公開方法を質問形式で確認したい場合：

   http://127.0.0.1:3000/setup

APIキーが未設定の場合は、用意されたデモ応答で画面とセッションを確認できます。


■ AI会話を有効にする方法

1. .env.example をコピーして、ファイル名を .env にします。
2. .env の OPENAI_API_KEY に自分のAPIキーを設定します。
3. npm start を実行します。

APIキーはブラウザや外部リンクには入れないでください。


■ 外部シナリオに置くリンク

公開後のURLが https://npc.example.com の場合：

https://npc.example.com/chat/jack?session=table-001

sessionの値を卓ごとに変えると、会話履歴と状態が分離されます。


■ 現在の試作仕様

・JACKとの日本語テキスト会話
・卓IDごとの会話履歴、信頼度、警戒度、恐怖度の保存
・公開情報、質問時情報、条件付き情報、秘密のサーバー側判定
・APIキー未設定時のデモ応答
・会話リセット


■ 公開前に追加すべきもの

・卓IDを推測されない署名付き招待リンク
・GM用のログインと手掛かり付与画面
・データベースへのセッション保存
・利用回数制限、入力検査、監視
・HTTPS対応のホスティング


■ Renderへ公開する場合の設定値

Root Directory：jack-web
Build Command：npm install
Start Command：npm start
Health Check Path：/health

環境変数：

OPENAI_API_KEY：自分のAPIキー
OPENAI_MODEL：gpt-5.4-mini
DATA_DIR：/var/data

永続ディスク：

Mount Path：/var/data

公開後のリンク例：

https://サービス名.onrender.com/chat/jack?session=table-001
