# IoTデータサーバ設計書

## 1. 目的

このプロジェクトでは、インターネットを介して複数のIoTデバイスからMQTTでJSONデータを受信し、ファイルに蓄積し、リアルタイムデータと累積データを可視化する簡易データサーバを構築する。

システムは意図的にファイルベースとし、DBは使用しない。デバイス認証情報、管理者認証情報、データ種別、閲覧トークン、抽出ルールはすべて設定ファイルに保存する。

## 2. 設計方針

- TypeScriptで実装し、Node.js上で動作させる。
- 受信・蓄積機能と可視化機能は別プロセスに分ける。
- 受信プロセスを稼働させたまま、可視化プロセスを更新・再起動できるようにする。
- 良質なOSSモジュールを活用し、独自実装は最小限にする。
- DBは使用せず、受信データは追記型のJSON Linesファイルとして保存する。
- MQTTトピックの認可は単純かつ厳密にする。
- サーバ稼働中に設定ファイルを再読み込みできるようにする。

## 3. プロセス構成

### 3.1 受信プロセス

責務:

- 内蔵MQTTブローカを起動する。
- human readableなデバイス名とトークンでデバイスを認証する。
- MQTT publishトピックを認可する。
- payloadが有効なJSONであることを検証する。
- 受信レコードをデバイス・ラベル・日付ごとのJSONLファイルへ追記する。
- 設定ファイルを監視し、プロセス停止なしで再読み込みする。
- 設定再読み込み後に無効になったデバイス接続を切断する。

利用候補モジュール:

- `aedes`: 内蔵MQTTブローカ。
- `mqtt`: 内部MQTTクライアント、テスト用クライアント。
- `zod`: 設定ファイルのschema validation。
- `chokidar`: 設定ファイルの監視。
- `pino`: structured logging。
- `yaml`: YAML設定ファイルの読み書き。

### 3.2 可視化プロセス

責務:

- 管理者UIを提供する。
- デバイス・ラベル単位のreadonlyビューを提供する。
- 受信プロセスからリアルタイムMQTTデータを購読する。
- 履歴グラフ表示のためにJSONLファイルを読み込む。
- 管理者UIから抽出ルールを管理できるようにする。
- 抽出ルールの変更を設定ファイルへ保存する。

利用候補モジュール:

- `fastify`: HTTPサーバ。
- `@fastify/websocket` または Server-Sent Events: ブラウザへのリアルタイム配信。
- `mqtt`: 受信プロセスのMQTTトピック購読。
- `uplot`: 軽量な時系列グラフ表示。
- `jsonpath-plus` または `jsonata`: 任意JSONからグラフ対象値を抽出。
- `argon2`: 管理者パスワード・トークンハッシュの検証。

## 4. MQTTトピック設計

デバイスは、以下の形式のトピックにのみデータをpublishする。

```text
devices/{deviceName}/data/{label}
```

例:

```text
devices/room-a-sensor/data/environment
devices/room-a-sensor/data/power
devices/pump-01/data/vibration
```

データレコードとして受け付けるのは、この4階層のトピックだけとする。

無効な例:

```text
devices/room-a-sensor/data
devices/room-a-sensor/data/environment/raw
devices/unknown-device/data/environment
devices/room-a-sensor/data/unknown-label
```

### 4.1 デバイス識別

MQTT認証には以下を使用する。

- MQTT username: `deviceName`
- MQTT password: デバイストークン

受信プロセスは、設定ファイルに記述されたデバイス名とトークンの組を検証する。

### 4.2 publish認可

認証後、デバイスは自分自身に紐づく有効なラベルのトピックにのみpublishできる。

たとえば、認証済みusernameが `room-a-sensor` の場合、設定で有効化されていれば以下を許可する。

```text
devices/room-a-sensor/data/environment
devices/room-a-sensor/data/power
```

以下は拒否する。

```text
devices/other-device/data/environment
devices/room-a-sensor/data/unknown
server/reload
admin/anything
```

### 4.3 可視化プロセスの購読

可視化プロセスは内部クライアントとしてMQTTブローカへ接続し、以下を購読する。

```text
devices/+/data/+
```

ブラウザからMQTTへ直接接続させない。可視化プロセスがMQTTデータを受け取り、WebSocketまたはServer-Sent Eventsでブラウザへ中継する。

## 5. payload仕様

MQTT payloadは有効なJSONでなければならない。

許可するJSON値:

- object
- array
- number
- string
- boolean
- null

受信プロセスはparse後の値を構造を変えずに保存する。

payloadサイズには設定値による上限を設ける。初期推奨値は以下。

```text
65536 bytes
```

## 6. データ保存設計

受信データは、デバイス・ラベル・日付ごとに保存する。

```text
data/devices/{deviceName}/{label}/YYYY-MM-DD.jsonl
```

例:

```text
data/devices/room-a-sensor/environment/2026-07-16.jsonl
data/devices/room-a-sensor/power/2026-07-16.jsonl
data/devices/pump-01/vibration/2026-07-16.jsonl
```

各行は1つのJSONオブジェクトとする。

```json
{"receivedAt":"2026-07-16T08:00:00.123Z","device":"room-a-sensor","label":"environment","topic":"devices/room-a-sensor/data/environment","data":{"temperature":24.8,"humidity":61}}
```

### 6.1 ローテーション

ファイルは日次でローテーションする。日付の基準はUTCまたはサーバローカル日付から選択できるようにする。

初期推奨値: UTC日付。

理由:

- 夏時間の影響を受けない。
- ISO timestampと比較しやすい。
- サーバのtimezone変更時にも曖昧さが少ない。

運用上、ローカルカレンダー日付が重要な場合は設定で切り替えられるようにする。

### 6.2 保存期間

想定保存期間は約2ヶ月とする。

保存期間の管理は定期クリーンアップ処理で行う。

- `retentionDays` より古いファイルを削除する。
- 空になったディレクトリを削除する。

初期推奨値:

```yaml
storage:
  retentionDays: 62
```

## 7. 設定ファイル

設定ファイルは以下のように分割する。

```text
config/server.yaml
config/devices.yaml
config/extractors.yaml
```

デバイス認証情報と可視化ルールを分けることで、ファイルベースの要件を満たしつつ管理しやすくする。

### 7.1 サーバ設定

```yaml
server:
  logLevel: "info"

mqtt:
  host: "0.0.0.0"
  port: 1883
  tls:
    enabled: false
    port: 8883
    keyFile: "./certs/server.key"
    certFile: "./certs/server.crt"
  maxPayloadBytes: 65536

storage:
  dataDir: "./data"
  rotation: "daily"
  dateMode: "utc"
  retentionDays: 62

viewer:
  host: "0.0.0.0"
  port: 3000

admin:
  passwordHash: "$argon2id$..."
```

### 7.2 デバイス設定

```yaml
devices:
  - name: "room-a-sensor"
    enabled: true
    tokenHash: "$argon2id$..."
    labels:
      - name: "environment"
        enabled: true
        readonlyView:
          enabled: true
          tokenHash: "$argon2id$..."
      - name: "power"
        enabled: true
        readonlyView:
          enabled: false

  - name: "pump-01"
    enabled: true
    tokenHash: "$argon2id$..."
    labels:
      - name: "vibration"
        enabled: true
        readonlyView:
          enabled: true
          tokenHash: "$argon2id$..."
```

### 7.3 抽出ルール設定

抽出ルールは、デバイスとラベルに紐づける。

```yaml
extractors:
  - id: "room-temperature"
    device: "room-a-sensor"
    label: "environment"
    labelText: "Temperature"
    expression: "$.temperature"
    valueType: "number"
    unit: "degC"
    enabled: true

  - id: "room-humidity"
    device: "room-a-sensor"
    label: "environment"
    labelText: "Humidity"
    expression: "$.humidity"
    valueType: "number"
    unit: "%"
    enabled: true
```

scalarなJSON payloadでは、ルート値を以下で選択する。

```text
$
```

arrayでは以下のように指定する。

```text
$[0]
```

objectでは以下のように指定する。

```text
$.temperature
```

## 8. 設定再読み込み

受信プロセスは設定ファイルを監視する。

再読み込み手順:

1. ファイル変更を検知する。
2. 関連する設定ファイルをすべて読み込む。
3. schema validationを行う。
4. 相互参照を検証する。
   - デバイス名が一意であること。
   - ラベル名が同一デバイス内で一意であること。
   - 抽出ルールが参照するデバイス・ラベルが存在すること。
5. 有効であれば、メモリ上の設定をatomicに差し替える。
6. 既存MQTT接続のうち、認可されなくなった接続を切断する。
7. 検証に失敗した場合は、直前の有効な設定を維持する。

受信プロセスは、再読み込みの成功・失敗をログに出力する。

可視化プロセスも設定ファイルを監視する。特に `extractors.yaml` は、グラフ設定を再起動なしで反映できるようにする。

## 9. 命名規則

デバイス名とラベル名は、MQTTトピック、URL、ファイルパスに使用するため、使用可能文字を制限する。

推奨pattern:

```text
^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$
```

許可する例:

```text
room-a-sensor
power_meter_01
PUMP01
```

拒否する例:

```text
room/a
../secret
sensor with space
```

## 10. Webビュー

### 10.1 管理者UI

管理者パスワードによるログインを必須とする。

主な機能:

- 全デバイス・全ラベルの一覧表示。
- リアルタイム受信データの表示。
- 履歴データのグラフ表示。
- 抽出ルールの作成・更新・削除。
- 抽出ルール変更の設定ファイル保存。
- 必要に応じた設定再読み込み。

### 10.2 readonlyビュー

readonlyビューは、1つのデバイスと1つのラベルに紐づく。

URL形式:

```text
/view/{deviceName}/{label}?token={viewToken}
```

例:

```text
/view/room-a-sensor/environment?token=...
```

readonlyビューの性質:

- 管理者パスワードは不要。
- 対象デバイス・ラベルのreadonly view tokenが必要。
- 抽出ルールや設定は変更できない。
- 該当するデバイス・ラベルのデータのみ表示する。

## 11. Viewer API案

管理者向けAPI:

```text
POST /api/admin/login
POST /api/admin/logout
GET  /api/admin/devices
GET  /api/admin/extractors
PUT  /api/admin/extractors
GET  /api/admin/history/:device/:label
GET  /api/admin/realtime
```

readonly向けAPI:

```text
GET /api/view/:device/:label/metadata?token=...
GET /api/view/:device/:label/history?token=...
GET /api/view/:device/:label/realtime?token=...
```

履歴取得のquery parameter:

```text
from=2026-07-16T00:00:00.000Z
to=2026-07-16T23:59:59.999Z
extractor=room-temperature
```

## 12. ブラウザへのリアルタイム配信

初期実装ではServer-Sent Eventsを推奨する。

理由:

- 一方向のリアルタイムデータ配信に向いている。
- ダッシュボード用途と相性がよい。
- MQTT over WebSocketを直接公開するより認可を制御しやすい。

ブラウザからサーバへ双方向通信が必要になった場合は、WebSocketへ切り替える。

event payload例:

```json
{"receivedAt":"2026-07-16T08:00:00.123Z","device":"room-a-sensor","label":"environment","data":{"temperature":24.8,"humidity":61}}
```

## 13. 履歴グラフ表示

可視化プロセスは、指定された日付範囲のJSONLファイルを読み込む。

処理手順:

1. デバイスとラベルを解決する。
2. 対象期間に該当する日次JSONLファイルを列挙する。
3. ファイルを1行ずつstreaming readする。
4. 各行をJSONとしてparseする。
5. 抽出ルールを適用する。
6. グラフ表示可能な数値を抽出する。
7. timestamp-valueの点列としてfrontendへ返す。

想定規模では、JSONLのstreaming readで十分対応可能と考える。

想定上限:

- デバイス数: 10〜20台。
- 送信間隔: 200ms〜1sec。
- 最大で20台 x 5 records/sec = 約100 records/sec。

この規模であれば、デバイス・ラベル単位のJSONL追記と履歴読み込みで運用可能と判断する。

## 14. セキュリティ

- デバイストークンと閲覧トークンはハッシュ化して保存する。
- 管理者パスワードはArgon2 hashとして保存する。
- MQTT TLSは必須にはしないが、選択可能にする。
- デバイス都合によりインターネット経由で平文MQTTが必要になる場合があるため、サーバ機能として平文MQTTを排除しない。
- 平文MQTTをインターネットへ公開する場合は、トークン漏えい・盗聴・なりすましのリスクがあることを運用上明示する。
- 平文MQTT利用時も、deviceNameとtokenによる認証、topic認可、payloadサイズ制限、ログ監視を必須の防御として実装する。
- 可能な環境ではTLS、安全なトンネル、VPN、リバースプロキシなどの利用を推奨する。
- readonlyビューでは、他のデバイス・ラベルのraw dataを返さない。
- ファイルパスは検証済みのデバイス名・ラベル名からのみ生成する。

## 15. 初期実装マイルストーン

### Milestone 1: プロジェクト基盤

- TypeScriptプロジェクトを作成する。
- lint、typecheck、test scriptを整備する。
- 設定schemaを作成する。
- サンプル設定ファイルを追加する。

### Milestone 2: 受信プロセス

- 内蔵MQTTブローカを起動する。
- デバイス認証を実装する。
- トピック認可を実装する。
- JSON payloadをparseする。
- JSONLレコード追記を実装する。
- 日次ファイルローテーションを実装する。
- 設定再読み込みを実装する。

### Milestone 3: 可視化backend

- Fastifyサーバを起動する。
- 管理者認証を実装する。
- `devices/+/data/+` を購読する。
- リアルタイムSSEを実装する。
- 履歴取得APIを実装する。
- readonly token検証を実装する。

### Milestone 4: 可視化frontend

- 管理者UIを作成する。
- readonlyビューを作成する。
- リアルタイムデータテーブルを追加する。
- 履歴グラフ表示を追加する。
- 抽出ルールエディタを追加する。

### Milestone 5: 運用向け整備

- 保存期間に基づくcleanupを追加する。
- structured logを整備する。
- サンプルデバイスpublisherを追加する。
- config validation、topic authorization、JSONL writeのテストを追加する。
- TLS利用時のdeployment notesを追加する。

## 16. 未確定事項

以下はまだ確定していない。

- 日次ローテーションの日付基準をUTCにするか、サーバローカル日付にするか。
- 抽出ルールの式にJSONPathを使うか、JSONataを使うか。
- readonly URLのtokenをquery parameterにするか、path parameterにするか。
- 受信プロセスと可視化プロセスで共有するconfig/schema codeを、monorepo内の共通packageとして切り出すか。

初期推奨値:

- 日次ローテーションはUTC日付。
- 抽出ルールはまずJSONPathを採用し、計算式が必要になったらJSONataを検討する。
- readonly tokenは実装が単純なquery parameterとする。
- config/schema codeは共有moduleとして作成する。
