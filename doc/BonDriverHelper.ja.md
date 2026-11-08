# BonDriver Helper（Windows・実験機能）

BonDriver Helper は、Windows のローカルチューナーで BonDriver DLL を常駐させ、配信していない間はチューナーを閉じておく機能です。実験機能のため、既定では無効です。実機での性能向上や安定性はまだ測定していません。

無効のままなら、現在の BonRecTest コマンドの起動方法で動作します。この機能は Windows のローカルチューナー専用です。Remote Mirakurun の接続先には適用されません。

## ビルド

Windows に Visual Studio C++ Build Tools をインストールします。Visual Studio Installer で「C++ によるデスクトップ開発」を選び、Windows SDK も含めてください。

Mirakurun のリポジトリ直下で次を実行します。

    npm run build:bon-helper

ビルドスクリプトが x86 用と x64 用のヘルパーを作成します。BonDriver DLL の PE ヘッダーからアーキテクチャを判定し、対応するヘルパーを選びます。x86 と x64 以外の DLL は使えません。

以前にヘルパーをビルドした環境では、Web 更新などで通常の `npm run build` が実行されると、ネイティブソースが更新されていればヘルパーを再ビルドします。機能を利用する環境では C++ Build Tools を残してください。`npm run clean` はビルド記録と生成物も削除するため、clean の後は `npm run build:bon-helper` を明示的に実行してください。

## 有効化

Web UI の「チューナー設定」で、対象のローカル BonRecTest チューナーにある「BonDriver Helper（実験機能・既定OFF）」を有効にし、保存して Mirakurun を再起動します。無効に戻す場合も同じ設定を保存して再起動してください。

同じ設定は実行環境のチューナー設定ファイルでも指定できます。通常の保存先は `data/config/tuners.yml` です。`TUNERS_CONFIG_PATH` を設定している場合は、そのパスのファイルを編集してください。

    - name: BonDriver BS/CS
      types:
        - BS
        - CS
      command: 'BonRecTest.exe --driver "C:\BonDriver\BonDriver_BS.dll" --space <space> --channel <channel> --output -'
      decoder: arib-b25-stream-test
      enableBonDriverHelper: true

既存の `command` が BonDriver DLL、チューニングスペース、チャンネルの指定元です。対応するコマンド名は `BonRecTest` または `BonRecTest.exe` です。コマンドでは `--driver`、`--space`、`--channel`、`--output -` だけを使えます。`--driver` と `--output -` は必須で、`--channel` にはチャンネル番号を指定します。`--space` を省略すると 0 になります。数値は 0 から 4294967295 までの整数です。パスに空白がある場合は引用符で囲んでください。

decoder は BonDriver Helper とは別の設定です。必要な CAS デコーダーを通常どおり指定してください。

## 動作とエラー

Helper は最初の選局時に起動します。最後の利用者が配信を終了すると、停止処理をすぐ始めて BonDriver の CloseTuner() を呼びます。Helper プロセスと DLL はそのまま常駐し、次の選局で再利用します。Mirakurun の終了・再起動時には Helper プロセスも終了します。

BonDriver2 を実装していない DLL、読み込めない DLL、対応外の DLL、または未対応オプションを含むコマンドは利用できません。Helper からの応答待ちは 10 秒です。タイムアウトや起動・選局の失敗時は Helper を終了してストリームを失敗させます。従来の BonRecTest 起動方式へ自動で切り替えることはありません。設定を無効に戻すと従来の方式に戻ります。

## 実機での確認

機能を有効にした後、次を確認してください。

1. 対象チューナーで録画またはストリームを開始し、映像・音声と TS 出力を確認する。
2. EPG 取得を実行し、番組情報が取得できることを確認する。
3. 複数チューナーで録画・視聴を同時に行い、Mirakurun のチューナー選択と優先度制御が期待どおりに働くことを確認する。
4. 最後の配信を終了した後、他のチューナーアプリからデバイスを開けることを確認する。Helper プロセスが残っていても、BonDriver のチューナーが閉じていることを確認する。
5. アイドル中と録画中の Helper の CPU 使用率・メモリ使用量を記録する。性能差は環境ごとに測定してください。
6. Remote Mirakurun を使う構成では、親側の remote tuner ではなく、機能を使う子機のローカル Windows チューナーで設定し、親子間の配信も確認する。

## 自動テスト（開発用）

模擬 BonDriver DLL を使うテストは、実チューナーを操作しません。x86/x64 ヘルパー、未使用時の解放、共有・優先度、選局キャンセル、親プロセスの強制終了を確認します。

```powershell
npm run build:bon-helper -- --test-driver
npm run build
$env:TEST_BON_NATIVE = "1"
npm test
Remove-Item Env:TEST_BON_NATIVE
```
