# LichtFeld-Studio Web

> 非官方專案。與 [MrNeRF/LichtFeld-Studio](https://github.com/MrNeRF/LichtFeld-Studio) 無隸屬或官方背書關係。
>
> 本 repo 含有 AI 協助產生的程式碼與文件。請自行驗證功能、安全性與部署結果；因使用本專案造成的資料、成本、服務或硬體損失，作者與貢獻者概不負責。

LichtFeld-Studio 的簡易 Web 控制台，提供 React + Tailwind 前端與 Node.js + TypeScript 後端，方便在瀏覽器中管理 dataset、建立訓練任務、查看進度與下載輸出。

## 功能重點

- 單一管理者密碼登入
- Session 會持久化到 SQLite，後端重啟後可沿用既有登入狀態
- 會定期主動清理已過期的 session，避免資料表持續累積
- 以 tus protocol 上傳 ZIP，支援續傳、進度顯示、伺服器驗證階段提示，以及超過 2 GiB 的大型 ZIP
- 也可直接選用伺服器上的 dataset
- 建立、停止、刪除訓練任務
- 刪除任務時會一併移除該任務的 output、timelapse 與 log，無法復原
- 查看 timelapse、Splat 預覽與模型輸出
- 模型下載預設匯出為 SOG，也可在任務頁選擇 PLY、SPZ 或 HTML
- 低磁碟空間自動停止任務（Disk Guard）

## 專案結構

- `frontend/`: React + Vite + Tailwind 前端
- `backend/`: Express + TypeScript API 與訓練流程控制
- `modal/`: Modal control/web/trainer Functions 與 CPU/GPU 映像定義
- `scripts/init-password.mjs`: 產生管理者密碼 bcrypt hash

## 本機開發

1. 建立環境變數檔。

```bash
cp .env.example .env
```

2. 產生管理者密碼 hash，填入 `.env` 的 `ADMIN_PASSWORD_HASH`，並把 `SESSION_SECRET` 換成自己的值。

```bash
corepack enable
pnpm install --frozen-lockfile
node scripts/init-password.mjs your-password
```

3. 啟動前後端。

```bash
pnpm dev
```

開發模式預設：

- 前端：`http://localhost:5173`
- 後端：`http://localhost:3000`

## Docker 部署

先準備 `.env`：

```bash
cp .env.example .env
node scripts/init-password.mjs your-password
```

把產生出的 hash 填進 `.env`，並修改 `SESSION_SECRET` 後執行：

```bash
mkdir -p data
docker compose up -d --build
```

預設對外服務埠為 `3000`，資料只需要掛載一個 volume：`./data:/app/data`。

`./data` 內會使用這些目錄：

- `datasets/`: 原始資料集
- `outputs/`: 訓練輸出
- `db/`: SQLite 資料庫（包含 app 資料與 session）
- `logs/`: 任務與系統日誌

注意事項：

- Docker 配置預設使用 `gpus: all`
- 主機需先安裝 NVIDIA Driver 與 NVIDIA Container Toolkit
- Docker build 預設建構 LichtFeld-Studio `v0.5.3`，可用 `LFS_REF` 覆寫
- 容器內預設 `LFS_BIN_PATH=/opt/lichtfeld/bin/LichtFeld-Studio`
- Docker 與 Modal GPU 映像會一併打包 LichtFeld-Studio build 產生的 OpenMesh shared libraries，並在 runtime image 建置時以 `ldd` 掃描 `/opt/lichtfeld/bin` 與所有 `.so` 的動態相依性（NVIDIA driver libraries 由 host 注入）；升版後需重新建置映像。

## Modal 雲端部署（CPU Web + GPU trainer）

`modal/app.py` 提供兩個 Modal Function：CPU `web_server` 與 GPU `gpu_trainer`。dispatch/cancel 已整合進 `web_server` 容器內的 loopback helper，不再需要獨立的 `control_server`。trainer 會把狀態與 log 寫進該 job 的 output，Web 僅在使用者讀取任務資料時 reload Volume 並同步，因此訓練本身不會持續以 callback 喚醒 scale-to-zero 的 Web container。這條路徑可與上面的 Docker 部署並存；不使用 Modal 時維持 `TRAINING_EXECUTOR=local` 即可。

### 建立 Modal 資源

先安裝 Modal CLI 並登入（[官方入門文件](https://modal.com/docs/guide)）：

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r modal/requirements.txt
modal setup
```

`modal/app.py` 預設使用以下具名資源；若以環境變數覆寫名稱，請同步修改建立與部署指令：

- App `lichtfeld-studio-web-modal`（可用 `MODAL_APP_NAME` 覆寫）。
- Volume `lichtfeld-data`：掛載到 `/data`，放置 datasets 與 outputs，供 Web wrapper 與 GPU trainer 共用。
- Volume `lichtfeld-web-state`：掛載到 `/state`，放置 Web-only 的 SQLite/session 狀態與 logs。
- Secret `lichtfeld-modal-web`：提供 Web wrapper 的 `SESSION_SECRET` 與 `ADMIN_PASSWORD_HASH`。

需要改名時可在執行 `modal deploy` 的環境設定 `MODAL_APP_NAME`、`MODAL_DATA_VOLUME`、`MODAL_STATE_VOLUME` 與 `MODAL_WEB_SECRET_NAME`；名稱必須與實際建立的 App/Volume/Secret 一致。

```bash
modal volume create lichtfeld-data
modal volume create lichtfeld-web-state

# Web wrapper 的登入密碼與 session secret。
WEB_SESSION_SECRET="$(openssl rand -hex 32)"
WEB_ADMIN_PASSWORD_HASH="$(node scripts/init-password.mjs 'replace-with-your-password')"
modal secret create lichtfeld-modal-web \
  SESSION_SECRET="$WEB_SESSION_SECRET" \
  ADMIN_PASSWORD_HASH="$WEB_ADMIN_PASSWORD_HASH"
```

部署與本機熱更新（[CLI deploy](https://modal.com/docs/cli/latest/deploy)、[developing/debugging](https://modal.com/docs/guide/developing-debugging)）：

```bash
modal deploy modal/app.py
# 開發時可用：modal serve modal/app.py
```

部署輸出的 `web_server` URL 就是 Web 控制台。內建 wrapper 會把 `MODAL_CONTROL_URL` 與 `MODAL_VOLUME_HELPER_URL` 都指向同一容器內的 `http://127.0.0.1:3001` helper，不需要公開 control URL 或 token。

若改用自訂 Modal Web wrapper，必須在相同容器提供相容的 loopback helper 並設定 `MODAL_CONTROL_URL` 與 `MODAL_VOLUME_HELPER_URL`。Backend 仍須掛載同一個 Modal data Volume；一般本機或外部 Docker 無法直接讀寫 Modal Volume，本專案目前沒有提供額外的資料同步橋接：

將建立 Secret 時使用的同一組隨機值填入後端 `.env`（下列尖括號是佔位符，不要照抄）：

```dotenv
TRAINING_EXECUTOR=modal
MODAL_CONTROL_URL=http://127.0.0.1:3001
MODAL_VOLUME_HELPER_URL=http://127.0.0.1:3001
```

Modal Web wrapper 會在同一個容器啟動 helper。`/data/commit` 會在 dispatch 前提交 Volume，`/data/reload` 會在 Web 端按需同步 worker 寫入的 `.web-status.json`、`.web-training.log` 與 timelapse。`/jobs/dispatch`、`/jobs/cancel` 則直接操作 Modal FunctionCall。這個 loopback URL 不應對外公開。

### Autoscaling、限制與費用

- `web_server` 使用 `min_containers=0`、`scaledown_window=2`：沒有請求時 CPU container 會縮到零，新的請求需要承擔 cold start 延遲（[autoscaling](https://modal.com/docs/guide/scale)）。
- 瀏覽器開著 job log 的 SSE 連線時仍屬於活躍請求，`web_server` 不會在連線期間縮到零；關閉頁面或連線結束後，才會進入上述 idle 縮容窗口。
- GPU worker 將訓練 artifact 寫入 shared Volume；瀏覽器正在讀取任務時，Web 端既有的低頻查詢會按需 reload 並同步狀態、log 與 timelapse，不會由 trainer 主動喚醒 Web。
- `gpu_trainer` 會依獨立的訓練輸入自動擴容，預設最多同時啟動 5 個 GPU container（可用 `MODAL_TRAINER_MAX_CONTAINERS` 調整），因此新任務不必等待上一個任務結束。這個預設同時遵循 Modal Volume v1 對少量並行 writer 的建議；提高上限會增加 GPU 成本與 Volume commit contention。
- GPU `gpu_trainer` 僅在有訓練呼叫時啟動；可在建立任務頁選擇 Modal GPU 型號（預設 A10），每個 job 透過 Modal dynamic Function configuration 取得所選資源。單次 Function execution 最長 24 小時（可用 `MODAL_TRAINER_TIMEOUT` 調低，但不能超過上限，見 [timeouts](https://modal.com/docs/guide/timeouts)）。超過 24 小時的工作需自行 checkpoint、重試或拆成多次呼叫。
- `gpu_trainer` 啟動 LichtFeld-Studio 前，會把 `--data-path` 指向的完整資料集複製到容器本機 `/tmp/lichtfeld-datasets`，降低 Modal Volume 大量小檔案存取的延遲；`--output-path` 仍指向 `/data/outputs`，完成、失敗或取消後都會清除該次本機暫存。複製需要容器暫存磁碟同時容納一份完整資料集；Modal 預設 ephemeral disk 配額為 512 GiB，超過時需調高 Function 的 `ephemeral_disk`（[CPU、記憶體與磁碟設定](https://modal.com/docs/guide/resources)）。
- scale-to-zero 只代表 compute container 不常駐；Persistent Volumes 的儲存、映像建置/儲存與網路流量仍可能產生費用。Volume 刪除資料後，依 Modal 文件仍可能在最多約四天內計入儲存處理費（[Volumes pricing](https://modal.com/docs/guide/volumes)）。

若要完全在本機執行，將 `TRAINING_EXECUTOR` 設回 `local`，並照 Docker 段落執行 `docker compose up -d --build`；不需要建立或保留 Modal 資源。

## 環境變數

必要：

- `SESSION_SECRET`: session secret
- `ADMIN_PASSWORD_HASH`: 管理者密碼的 bcrypt hash
- `TRAINING_EXECUTOR=modal` 且使用自訂 Modal Web wrapper 時，還必須設定 loopback `MODAL_CONTROL_URL` 與 `MODAL_VOLUME_HELPER_URL`；內建 wrapper 會自動注入

常用選填：

- `TIMELAPSE_MIN_FREE_GB`: 剩餘空間低於此值時自動停止任務，預設 `5`
- `SESSION_CLEANUP_INTERVAL_MS`: 主動清理過期 session 的週期，預設 `3600000`（1 小時）
- `DATASET_ALLOWED_ROOTS`: 允許註冊的 dataset 路徑白名單，預設為 datasets 目錄
- `LFS_BIN_PATH`: LichtFeld-Studio 執行檔路徑；Docker 預設已設定
- `LFS_REF`: Docker build 使用的 LichtFeld-Studio git ref，預設 `v0.5.3`
- `TRAINING_EXECUTOR`: `local`（預設）或 `modal`
- `MODAL_VOLUME_HELPER_URL`: 自訂 Modal wrapper 的 volume helper URL；標準 wrapper 會自動注入 loopback URL
- `MODAL_GPU`、`MODAL_TRAINER_TIMEOUT`: Modal trainer 的預設 GPU 型號與單次執行 timeout（預設 A10、86400 秒）；前端可逐 job 覆寫 GPU 型號
- `MODAL_TRAINER_MAX_CONTAINERS`: Modal trainer 的並行 GPU container 上限（預設 `5`）；每個同時執行的訓練各自使用一個 container
- `MODAL_STAGING_WORKERS`: Modal trainer 從 Volume 複製資料集到本機 SSD 時的平行 worker 數（預設 32，最大 64）
- `MODAL_GPU_IMAGE`: 選填的 GPU registry image；設定後會略過 `modal/Dockerfile.gpu`，因此該映像必須自行包含 Python、`modal/requirements.txt` 套件、OpenMesh shared libraries，並重新以 `ldd` 驗證。未設定時會使用本專案已驗證的 Dockerfile 建置流程。

其他像 `DATA_ROOT`、`DATASETS_DIR`、`OUTPUTS_DIR`、`DB_PATH`、`LOGS_DIR` 都有預設值，通常不需要調整。

## Dataset 格式

dataset 根目錄必須直接包含 `images/` 與 `sparse/`：

```text
my-dataset/
|- images/
|  |- 0001.jpg
|  \- ...
\- sparse/
   \- ...
```

不論是前端以 tus 上傳 ZIP，或手動放進 `datasets/`，都應符合這個結構。前端在 ZIP 上傳前會先要求確認資料夾名稱，預設直接帶入 ZIP 檔名；後端也會用這個名稱建立 `datasets/` 內的資料夾，而不是隨機 ID。ZIP 傳完後還會進入伺服器端的解壓縮與驗證階段，完成後才會註冊成可用 dataset。未完成的 tus 暫存 upload 會在最後活動 24 小時後自動過期並清理。

## 常用指令

```bash
pnpm dev
pnpm -r build
pnpm test
```

`pnpm test` 目前執行 backend 測試。
