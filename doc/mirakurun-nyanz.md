# Windows native fork notes

この文書は、`nyanz00/Mirakurun` の Windows ネイティブ運用向けの変更点をまとめたものです。

このフォークは Mirakurun 4.2.1 をベースに Windows 上で動かすための移植・調整版です。

通常の Linux / Docker 環境で使う場合は、本家 Mirakurun を使ってください。

## 主な変更点

- Windows サービス登録用の `service:install.win32` / `service:uninstall.win32` を追加
- 設定・DB・ログをディレクトリ直下の `data\` に保存する方式に変更
- Windows のパス区切りによる API 404 を避けるため、URL 内のバックスラッシュを補正
- remote Mirakurun で取得した EPG を events に流すように変更（EPGStation で remote Mirakurun の局の EPG が更新されない問題を解決）
- remote Mirakurun で取得した番組・サービスを親 Mirakurun 側でも扱いやすいように調整
- remote Mirakurun の局ロゴを親 Mirakurun 側で取得・キャッシュできるように調整
- 物理チャンネルが同じ局を別のチューナーで扱いたい時のため、`GR-ALT1` から `GR-ALT20` までのチャンネルタイプを追加
- Windows 環境向けにデフォルトの地上波チャンネルスキャン範囲を `0` から `52` に変更
- Web UI の channel scan では、存在するチューナータイプだけを選択肢に表示
- Web UI の tuner status に表示される dropped pkts を TS continuity counter ベースで数えるように調整
- BS/CS の局ロゴ取得で DSM-CC の重複ブロックを二重カウントしないように調整
- web UIのEPGの局タイプを存在するチューナータイプのみ表示されるように変更
- アップデート時などに局ロゴのデータをそのまま移植出来るようにlogo-map機能を追加
- 随時本家版の変更に追従

## インストール

Node.js 22 / 24 / 26 のいずれかを入れた Windows 環境で実行してください。

```powershell
git clone -b nyanz-master https://github.com/nyanz00/Mirakurun.git
cd Mirakurun
npm install
npm run build
```

## ブランチと更新

`nyanz-master` は実機確認済みの安定版で、GitHub のデフォルトブランチです。`develop` は開発版です。通常のインストールや安定版への更新には `nyanz-master` を使用します。

既存の `win32` ブランチを Git clone した環境では、一度だけローカルブランチ名と追跡先を切り替えてください。作業前に `git status --short --branch` で未コミットの変更がないことを確認します。

```powershell
git fetch origin --prune
git branch -m win32 nyanz-master
git branch --set-upstream-to=origin/nyanz-master nyanz-master
git pull --ff-only
```

以後、安定版は `nyanz-master` 上で `git pull --ff-only` できます。更新後は `npm run build` を実行し、Mirakurun を再起動してください。依存関係が変わった場合はビルド前に `npm install` も実行してください。ZIP 展開で導入した環境では Git の履歴がないため、`git pull` は使えません。

GitHub のタグ付きアーカイブをクライアントライブラリとして使えるよう、`lib/client.js` と型定義・ソースマップだけを Git に含めています。サーバーと Web UI のビルド成果物は含めないため、Mirakurun 本体として動かす際は上記のビルドが必要です。

`package.json` のバージョンは本家 Mirakurun の番号を維持します。nyanz 版の番号は「Mirakurun について」の Current 欄と、安定版の Git タグで表します。本家のバージョンが上がった最初の nyanz 安定版は `nyanz1.0` から始め、同じ本家バージョンで nyanz 版の安定版を追加するときに `1.1`、`1.2` と進めます。`develop` の各コミットでは番号を上げません。Git 管理下で `develop` ブランチを実行中は Current 欄にだけ ` +dev` が付き、安定版では外れます。既存の `4.1.3-nyanz.1` タグは過去の形式として残し、次の安定版から画面表示とタグを一致させます。

## Web UI からの更新

Git clone 環境では、歯車メニューの「バージョン管理」から nyanz 版の安定版と `develop` の更新先を確認できます。利用中の系列に新しいコミットがある場合、メニューは「更新があります」と表示します。本家の npm 最新版はこの通知の対象ではありません。

更新時は作業ツリーと更新先を確認し、設定ファイルと局ロゴをバックアップします。依存関係が変わった場合だけ `npm install` を行い、毎回 `npm run build` を実行します。失敗時は更新前のコードとビルドへ復旧を試みます。成功後は画面から再起動してください。Windows サービスと [Linux の systemd サービス](linux-nyanz.md) で Web からの再起動を利用できます。

バックアップは `data/update/backups/` に保存し、設定は直近 3 回分、局ロゴ (`logo-map.json` と `logo-data`) は直近 1 回分を保持します。サービスと番組の DB は再取得できるため含めません。設定やロゴの保存先を変更している場合は、実際に使用しているパスからバックアップします。

更新・再起動を許可する接続元は、サーバー設定の「Web更新を許可する IPv4 CIDR 範囲」で指定します。このリストを変更できるのは Mirakurun 本体から `localhost` または `127.0.0.1` で接続した場合だけです。初期値は `127.0.0.1/32` で、IPv6 のローカルホスト (`::1`) も利用できます。別の管理 PC から操作する場合は、最初に Mirakurun 本体からその PC の IP アドレスを CIDR 形式で追加し、Mirakurun を再起動してください。通常の API の許可範囲とは別の設定ですが、管理 PC は通常の API 側でも接続を許可されている必要があります。

過去の安定版へのロールバックは、Web アップデーターを含むリリースに限ります。現在の `4.1.3-nyanz.1` など、アップデーター導入前の版は Web からの切り替え先にできません。

## 設定ファイル

Remote 接続管理の設定・確認方法は [Remote Mirakurun の接続管理](Remote.ja.md) を参照してください。

初期設定は `data\config\` に配置します。

- `data\config\server.yml`
- `data\config\tuners.yml`
- `data\config\channels.yml`

tuners.yml、channels.ymlの一例

```yaml
- name: PT3-T0
  types:
    - GR
  command: C:\nyanzTV\BonRecTest.exe --space <space> --driver C:\nyanzTV\BonDriver_PT3-T0.dll --output - --channel <channel>
  decoder: C:\nyanzTV\arib-b25-stream-test.exe
  isDisabled: false
```

```yaml
- name: ＮＨＫ総合１・大阪
  type: GR
  space: 0
  channel: '11'
```

Windows 環境では物理チャンネルが Linux 環境から -13 された 0 から始まるので、アンテナメーカーのサイトに書いてある物理チャンネル番号から -13 した数字を記載してください。例えば、24 と記載されていた場合は 11 です。
チャンネルタイプの `GR-ALT*` はチューナーコマンドへ渡す時は `GR` として扱われ、Mirakurun 内部のチューナー割り当てでは別タイプとして扱われます。

## コマンドライン起動

テストや手動起動では次を使います。

```powershell
npm start
```

互換用に `npm run start.win32` でも起動できます。

標準出力・標準エラーはコンソールにも出ますが、同時に以下へ保存されます。

- `data\log\stdout.log`
- `data\log\stderr.log`

サービス・番組データ・局ロゴは以下へ保存されます。

- `data\db\services.json`
- `data\db\programs.json`
- `data\db\logo-data\`

## Windows サービス

管理者権限の PowerShell で実行してください。

```powershell
npm run service:install.win32
```

Windows サービスは Node.js に `--max-semi-space-size=2` を指定して起動します。ソースを更新しただけでは既存サービスの登録済み起動引数は変わらないため、この設定を反映する場合はインストール手順を再実行してください。この設定の反映は機能利用の必須条件ではありません。

登録されるサービス名は `mirakurun-nyanz` です。本家 Mirakurun のサービス名とは別名になっているため、テストの際に本家をアンインストールする必要はありません。

アンインストールは次のコマンドで行ってください。

```powershell
npm run service:uninstall.win32
```

サービス起動時の標準出力と標準エラーも、コマンドライン起動時と同じく以下へ保存されます。

- `data\log\stdout.log`
- `data\log\stderr.log`

`services.json` や `programs.json` などのDB系ファイルは `data\db\` に保存されます。

## Web UI

起動後、通常の Mirakurun と同じく以下へアクセスします。

```text
http://localhost:40772/
http://<server-ip>:40772/
```

## logo-map機能
data\dbにnetworkidとserviceidとlogoidを記録したlogo-map.jsonが生成されるようになっているので、logo-map.jsonとロゴデータの入ったlogo-dataフォルダを新しいバージョンのmirakurunのdata\dbに配置すると、logo-mapを参考に再スキャンされたサービスにロゴidを割り振り、移植したロゴデータを使用します。

## 注意点・あとがき

- Linux / Docker での動作は確認していないため、その環境での動作は保証していません。
- フォーク作成者本人は特にプログラミングの知識は無く、Codex を使用して移植しているため、有識者から見たらおかしいコード、非効率的な部分がある可能性があります。その場合は指摘していただけるとありがたいです。
- `GR-ALT*` 対応版の EPGStation は近日中に公開予定です。
