# Linux ネイティブ版

このフォークは Linux での直接起動と systemd サービス登録に対応しています。Node.js 22 / 24 / 26 が必要です。実機チューナーを使った動作確認はまだ行っていません。

## インストール

Linux 向けの変更は `develop` ブランチで作業中です。Git、Node.js 22 / 24 / 26、npm を用意し、ソースを取得してビルドします。

```sh
git clone -b develop https://github.com/nyanz00/Mirakurun.git
cd Mirakurun
npm install
npm run build
```

標準の設定とデータはリポジトリ内に作られます。

- 設定: `data/config/server.yml`、`data/config/tuners.yml`、`data/config/channels.yml`
- サービス・番組 DB と局ロゴ: `data/db/`
- Unix ドメインソケット: `data/mirakurun.sock`

既存 Linux 版の `/usr/local` 配下の保存先を使う場合は、起動時に `MIRAKURUN_PORTABLE=0` を設定します。`SERVER_CONFIG_PATH`、`TUNERS_CONFIG_PATH`、`CHANNELS_CONFIG_PATH`、`SERVICES_DB_PATH`、`PROGRAMS_DB_PATH`、`LOGO_DATA_DIR_PATH`、`LOGO_MAP_PATH` を個別に設定した場合は、そのパスが使われます。

## 起動と停止

手動起動はリポジトリのルートで実行します。

```sh
npm start
```

停止するには、起動したプロセスに `Ctrl+C` を送ります。

## systemd サービス

ソースはサービスを実行する Linux ユーザーが書き込みできる場所に置き、依存関係のインストールとビルドをそのユーザーで行います。サービス登録時は、利用する Node.js と実行ユーザーを明示します。

```sh
sudo "$(command -v node)" bin/service.linux.js install --user "$(id -un)"
```

systemd サービスは Node.js に `--max-semi-space-size=2` を指定して起動します。ソースを更新しただけでは既存サービスの登録済み起動引数は変わらないため、この設定を反映する場合はインストール手順を再実行してください。この設定の反映は機能利用の必須条件ではありません。

サービスの状態とログは次のコマンドで確認できます。

```sh
sudo systemctl status mirakurun-nyanz.service
sudo journalctl -u mirakurun-nyanz.service -f
```

アンインストールする場合は次を実行します。

```sh
sudo "$(command -v node)" bin/service.linux.js uninstall
```

systemd サービスを使うと、Web UI から再起動できます。ログは systemd journal に記録されます。

## Web UI からの更新

Web UI からの更新には Git clone 環境、Git、npm、およびビルド用の開発依存関係が必要です。`npm install` の後に `npm run build` が実行できる状態を保ってください。Linux 対応を含まない古い更新先は選択できません。

## Docker

同梱の Compose 設定はローカルイメージ `mirakurun-nyanz:local` を使います。起動前に一度ビルドしてください。

```sh
npm run docker:build
npm run docker:run-setup
npm run docker:up
```

通常の Docker 実行では、Compose の `/opt/mirakurun/config` と `/opt/mirakurun/data` のマウントを使用します。
