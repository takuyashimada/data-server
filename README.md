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
  maxClientIdLength: 128

storage:
  dataDir: "./data"
  dateMode: "utc"
  retentionDays: 62

viewer:
  host: "0.0.0.0"
  port: 3000
  basePath: ""
  realtime:
    mqtt:
      url: "mqtt://127.0.0.1:1883"
      username: "viewer"
      password: "viewer-token"
```

`viewer.realtime.mqtt.url` を変えると、ローカルのviewerから別ホストのMQTTブローカを購読できます。

`viewer.basePath` は、nginxなどのリバースプロキシ配下でviewerをサブパスに置く場合の前置パスです。たとえば外部URLを `/iot-data/view/...` にする場合は `basePath: "/iot-data"` を指定します。空文字の場合は従来通りルート配下のURLを生成します。

nginx配下でライブ更新を使う場合は、readonly realtime SSEのレスポンスがバッファされないようにします。viewerは `X-Accel-Buffering: no` を返しますが、nginx設定でも対象locationに `proxy_buffering off;` を指定してください。

`maxClientIdLength` はMQTT client_idの最大長です。M5Stack/UIFlow2など、デバイス側が長いclient_idを自動生成する場合があるため、デフォルトでは128文字にしています。

`storage.dataDir` に相対パスを指定した場合は、`config/` の親ディレクトリを基準に解決します。通常の開発環境では `./data` はプロジェクトroot直下の `data/` を指します。

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
        timestamp: "measuredAt"
        readonlyView:
          enabled: true
          token: "readonly-token"
```

`timestamp` を指定すると、受信JSONオブジェクトのトップレベルにある該当フィールドを測定時刻として扱います。値はms単位のUNIX時刻です。保存レコードには受信時刻 `receivedAt` と測定時刻 `measuredAt` の両方が入り、日次ファイル、グラフ表示、履歴範囲指定、周波数フィルターは `measuredAt` を優先します。`timestamp` が未指定、またはpayloadがJSONオブジェクトでない場合は従来通り `receivedAt` を使います。

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

Dockerで起動する場合:

```bash
docker build -t iot-data-server:1.1.0 .
docker run --rm \
  -p 1883:1883 \
  -p 8883:8883 \
  -p 3000:3000 \
  -v "$PWD/config:/app/config:ro" \
  -v "$PWD/data:/app/data" \
  iot-data-server:1.1.0
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

## receiverログ

receiverはJSON形式のログを標準出力へ出します。

起動成功:

```json
{"process":"receiver","host":"0.0.0.0","port":1883,"msg":"MQTT receiver started"}
```

設定ファイル再読み込み成功:

```json
{"process":"receiver","disconnected":0,"msg":"configuration reloaded"}
```

認証失敗:

```json
{"process":"receiver","clientId":"room-a-sensor","username":"unknown-device","msg":"MQTT authentication failed: unknown device"}
```

```json
{"process":"receiver","clientId":"room-a-sensor","username":"room-a-sensor","msg":"MQTT authentication failed: invalid token"}
```

接続packetやprotocol段階での失敗:

```json
{"process":"receiver","clientId":"room-a-sensor","msg":"MQTT connection error"}
```

publish認可や接続後のclient error:

```json
{"process":"receiver","clientId":"room-a-sensor","msg":"MQTT client error"}
```

M5Stackなど外部デバイスから接続できない場合、receiverログに何も出なければ、MacのFirewall、ルータのゲストSSID、接続先IP、ポート到達性など、MQTT以前のネットワーク到達性を疑ってください。

## Viewer API

health check:

```text
GET /health
```

readonly page:

```text
GET /view/:device/:label?token=...
```

定義済みextractorを初期選択する場合:

```text
GET /view/:device/:label?token=...&extractor=room-temperature
```

複数の定義済みextractorを同時表示する場合:

```text
GET /view/:device/:label?token=...&extractor=raw-x&extractor=raw-y&extractor=raw-z
```

テンポラリなJSONata式を指定する場合:

```text
GET /view/:device/:label?token=...&expression=temperature%20*%201.8%20%2B%2032
```

テンポラリ式も複数指定できます。画面上では1行1式で編集します。

```text
GET /view/:device/:label?token=...&expression=%24%5B0%5D&expression=%24%5B1%5D&expression=%24%5B2%5D
```

readonly pageではブラウザ側でもJSONataを評価するため、定義済みextractorに加えて、画面上で一時的な抽出式を試せます。定義済みextractorとテンポラリ式は同時に表示できます。

抽出後の数値系列には、ブラウザ側で一時的な周波数バンド分解を適用できます。`frequency bands` を有効にし、`time constants` に `2s, 60s, 3600s` のような任意個のEMA時定数を指定すると、N個の時定数からN+1個のバンドを生成します。各バンドは隣り合うローパスの差分で、最後のバンドは最も長い時定数のローパス成分です。URLで初期状態を指定する場合:

```text
GET /view/:device/:label?token=...&extractor=raw-x&bands=1&bandConstants=2s%2C60s%2C3600s
```

元系列も併記する場合:

```text
GET /view/:device/:label?token=...&extractor=raw-x&bands=1&bandConstants=2s%2C60s%2C3600s&bandRaw=1
```

画面上部の `load from` / `load to` は、表示可能な最大データ範囲を指定します。`load to` は空欄にでき、空欄の場合は「現在まで」を対象にしてリアルタイムデータへ追従します。`load to` を指定した場合は過去範囲の閲覧となり、リアルタイム追従は行いません。グラフ下の範囲バーは、読み込んだ最大範囲の中で実際に表示する時間窓を調整します。

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

nginxのリバースプロキシ配下でSSEを使う場合の例:

```nginx
location /iot-data/ {
  proxy_pass http://127.0.0.1:3000/;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_buffering off;
  proxy_read_timeout 1h;
}
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
