# IoTデータサーバ

MQTTで複数のIoTデバイスからJSONデータを受信し、デバイス・ラベル・日付ごとのJSON Linesファイルに保存する簡易データサーバです。

受信・蓄積を担当する `receiver` と、可視化APIを担当する `viewer` は別プロセスとして起動します。

## 構成

```text
packages/
  shared/    設定schema、MQTT topic解析、認可、保存パスなどの共有コード
  receiver/  内蔵MQTTブローカ、デバイス認証、JSONL保存
  viewer/    readonly API、履歴読み込み、JSONata抽出、リアルタイム購読
```

MQTTデータtopic:

```text
devices/{deviceName}/data/{label}
```

保存先:

```text
data/devices/{deviceName}/{label}/YYYY-MM-DD.jsonl
```

## セットアップ

```bash
npm install
```

## 設定方法

設定ファイルは `config/` 配下に置きます。まずexampleをコピーします。

```bash
cp config/server.example.yaml config/server.yaml
cp config/devices.example.yaml config/devices.yaml
cp config/extractors.example.yaml config/extractors.yaml
```

`config/*.yaml` は `.gitignore` 対象です。実トークンや管理者パスワードはコミットしないでください。

### `server.yaml`

主にMQTT、保存先、viewerの接続先を設定します。

```yaml
mqtt:
  host: "0.0.0.0"
  port: 1883
  maxPayloadBytes: 65536

storage:
  dataDir: "./data"
  dateMode: "utc"
  retentionDays: 62

viewer:
  host: "0.0.0.0"
  port: 3000
  realtime:
    mqtt:
      url: "mqtt://127.0.0.1:1883"
      username: "viewer"
      password: "viewer-token"
```

`viewer.realtime.mqtt.url` を変えると、ローカルのviewerから別ホストのMQTTブローカを購読できます。

### `devices.yaml`

デバイス名、デバイストークン、有効なラベル、readonly view tokenを設定します。

```yaml
devices:
  - name: "room-a-sensor"
    enabled: true
    token: "device-token"
    labels:
      - name: "environment"
        enabled: true
        readonlyView:
          enabled: true
          token: "readonly-token"
```

開発中は `token` を使えます。本番では `tokenHash` の利用を推奨します。

### `extractors.yaml`

履歴グラフ用の抽出ルールを設定します。式はJSONataです。

```yaml
extractors:
  - id: "room-temperature"
    device: "room-a-sensor"
    label: "environment"
    labelText: "Temperature"
    expression: "temperature"
    valueType: "number"
    unit: "degC"
    enabled: true
```

例:

```text
temperature
temperature * 1.8 + 32
$sqrt(x * x + y * y + z * z)
```

## ビルド方法

```bash
npm run build
```

型チェックのみ:

```bash
npm run typecheck
```

テスト:

```bash
npm test
```

## 実行方法

開発時は2つのターミナルで起動します。

```bash
npm run dev:receiver
```

```bash
npm run dev:viewer
```

ビルド済みJSを実行する場合:

```bash
npm run build
npm run start:receiver
```

別ターミナルで:

```bash
npm run start:viewer
```

環境変数で設定ディレクトリとデータディレクトリを指定できます。

```bash
IOT_DATA_SERVER_CONFIG_DIR=/etc/iot-data-server \
IOT_DATA_SERVER_DATA_DIR=/var/lib/iot-data-server/data \
npm run start:receiver
```

## 動作確認

receiverを起動した状態で、MQTTクライアントからpublishします。

```bash
node -e "const mqtt=require('mqtt'); const c=mqtt.connect('mqtt://127.0.0.1:1883',{username:'room-a-sensor',password:'device-token'}); c.on('connect',()=>{ c.publish('devices/room-a-sensor/data/environment', JSON.stringify({temperature:24.8,humidity:61}), {}, ()=>c.end()); });"
```

保存ファイル例:

```text
data/devices/room-a-sensor/environment/2026-07-16.jsonl
```

1行の形式:

```json
{"receivedAt":"2026-07-16T09:51:31.961Z","device":"room-a-sensor","label":"environment","topic":"devices/room-a-sensor/data/environment","data":{"temperature":24.8,"humidity":61}}
```

## Viewer API

health check:

```text
GET /health
```

readonly metadata:

```text
GET /api/view/:device/:label/metadata?token=...
```

readonly history:

```text
GET /api/view/:device/:label/history?token=...&from=2026-07-16T00:00:00.000Z&to=2026-07-16T23:59:59.999Z&extractor=room-temperature
```

readonly realtime SSE:

```text
GET /api/view/:device/:label/realtime?token=...
```

## デプロイ方針

初期運用では、receiverとviewerを別々のsystemd serviceとして起動する想定です。

配置例:

```text
/opt/iot-data-server/app/
/etc/iot-data-server/server.yaml
/etc/iot-data-server/devices.yaml
/etc/iot-data-server/extractors.yaml
/var/lib/iot-data-server/data/
```

通常のUI更新ではreceiverは再起動せず、viewerだけを再起動します。

```bash
sudo systemctl restart iot-data-viewer
```

## 注意

- MQTT TLSは選択可能ですが、必須ではありません。
- デバイス都合によりインターネット経由の平文MQTTも排除しません。
- 平文MQTTを公開する場合は、トークン漏えい・盗聴・なりすましのリスクを理解したうえで運用してください。
- デバイス名とラベル名は `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$` に制限されます。
