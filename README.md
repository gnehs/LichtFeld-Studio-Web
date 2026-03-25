# LichtFeld-Studio Web

> [!WARNING]
> **非官方專案聲明**
>
> 本專案 **不是** [MrNeRF/LichtFeld-Studio](https://github.com/MrNeRF/LichtFeld-Studio) 官方專案，與官方團隊無隸屬、代理或保證關係。
>
> **AI 程式碼聲明**
>
> 本專案含有以 AI 協助撰寫之程式碼與文件，可能存在錯誤、遺漏或安全風險。
>
> **免責聲明**
>
> 使用者應自行評估、測試與承擔所有風險。對於因使用本專案而造成之任何直接或間接損失（包含但不限於資料遺失、訓練失敗、服務中斷、商業損失、硬體或資安問題），專案作者與貢獻者 **概不負責**。

React + Tailwind CSS v4 + shadcn 風格 UI 的 LichtFeld-Studio 網頁控制台，支援：

- 單租戶密碼保護
- 首頁任務清單（縮圖、進度、執行時間、經過時間、ETA）
- 兩步驟建立任務（Step 1: 上傳 ZIP 或選擇 Dataset、Step 2: 參數設定）
- 可自行把符合格式的 dataset 資料夾放進伺服器後再註冊/選用
- 建立任務頁支援拖移 ZIP 上傳、背景上傳進度與手動重新整理 dataset 清單
- Node 透過 CLI 啟動/停止 headless 訓練
- 單任務序列 queue
- Timelapse 自動啟用（由後端自動挑選 dataset 影像，前端不提供啟用開關）
- Disk Guard（低於門檻自動停止任務，狀態 `stopped_low_disk`）

## 1. 先建立密碼雜湊

```bash
pnpm install --filter @lichtfeld/backend
node scripts/init-password.mjs your-password
```

把輸出貼到 `.env` 的 `ADMIN_PASSWORD_HASH`。

## 2. 啟動開發模式

```bash
pnpm install
pnpm dev
```

`pnpm dev` 會同時啟動前後端。
前端預設 `http://localhost:5173`，後端 `http://localhost:3000`。

## 3. Docker 部署

先拉 image：

```bash
docker pull ghcr.io/gnehs/lichtfeld-studio-web:latest
```

建立設定與資料夾：

```bash
cp .env.example .env
# 編輯 .env：至少填 SESSION_SECRET / ADMIN_PASSWORD_HASH
mkdir -p data
```

單行執行：

```bash
docker run -d --name lichtfeld-studio-web \
  --restart unless-stopped \
  --gpus all \
  -p 3000:3000 \
  --env-file .env \
  -v "$(pwd)/data:/app/data" \
  ghcr.io/gnehs/lichtfeld-studio-web:latest
```

若偏好 Compose，也可直接執行：

```bash
docker compose up -d
```

Compose 只需要掛載一個資料夾：

- `./data:/app/data`
- 其中會自動建立：
  - `/data/datasets`
  - `/data/outputs`
  - `/data/db`
  - `/data/logs`
- 上述資料夾會在 container 啟動時檢查並補建，因此首次掛載空的 `./data` 也會自動初始化

登入 session cookie 會自動依連線情境調整：

- 直接用 `http://主機:3000` 存取 Docker 服務時，不會強制 `Secure`，避免正確密碼也無法登入
- 若前面有 HTTPS reverse proxy，請保留 `X-Forwarded-Proto`，cookie 會自動標成 `Secure`

### Docker 與 GPU

- 預設 image 已內含 LichtFeld-Studio，執行檔路徑為 `/opt/lichtfeld/bin/LichtFeld-Studio`
- container 啟動時會自動把 `/opt/lichtfeld/lib` 與 `/opt/lichtfeld/lib64` 加入 `LD_LIBRARY_PATH`，避免訓練時找不到 `liblfs_mcp.so` 等共享函式庫
- Docker 啟動時已支援 CUDA GPU；請確認主機已安裝 NVIDIA Driver 與 NVIDIA Container Toolkit
- `docker run` 請帶 `--gpus all`
- `docker compose.yml` 已包含 `gpus: all`

### Docker 排錯

- 若訓練時出現 `/opt/lichtfeld/bin/LichtFeld-Studio: error while loading shared libraries: liblfs_mcp.so: cannot open shared object file: No such file or directory`，通常代表 image 尚未套用新版啟動設定
- 請重新 build 或重新 pull image 後再啟動 container，讓後端在啟動時自動補上 LichtFeld-Studio 的動態函式庫搜尋路徑
- 若出現 `liblfs_rmlui.so` 或其他 `liblfs_*.so` 缺失，通常是 loader path 未更新；新版 image 會同時設定 `LD_LIBRARY_PATH` 與 `ldconfig`（`/etc/ld.so.conf.d/lichtfeld.conf`）避免這類問題
- 若出現 `/opt/lichtfeld/bin/LichtFeld-Studio: error while loading shared libraries: libdbus-1.so.3: cannot open shared object file: No such file or directory`，代表 runtime image 缺少 `libdbus-1-3` 套件
- 請重新 build/pull 最新 image（已補上 OpenGL/X11/DBus 常見 runtime 依賴，例如 `libdbus-1-3`、`libgl1`、`libx11-6` 等），再重新啟動 container
- 若仍有共享函式庫錯誤，可在 container 內執行 `ldd /opt/lichtfeld/bin/LichtFeld-Studio | grep "not found"` 追蹤缺少的套件

## 環境變數

- required:
  - `SESSION_SECRET`：登入 session secret
  - `ADMIN_PASSWORD_HASH`：管理者密碼 bcrypt hash
- optional:
  - `TIMELAPSE_MIN_FREE_GB`：低於此值會自動中止任務
  - `DATASET_ALLOWED_ROOTS`：後端允許註冊的伺服器資料路徑白名單（主要給 API/進階流程使用）
- `LFS_BIN_PATH` 在 Docker image 內已預設為 `/opt/lichtfeld/bin/LichtFeld-Studio`，通常不需要手動設定
- 其餘路徑與埠號在 Docker 內已有預設值，通常不需要額外設定

## Dataset 格式與手動放置

- 不論是前端上傳 ZIP，或你自行把資料夾放進伺服器，dataset 根目錄都必須直接包含 `images/` 與 `sparse/`
- 合法範例：

```text
my-dataset/
|- images/
|  |- 0001.jpg
|  |- 0002.jpg
|  \- ...
\- sparse/
   \- ...
```

- 不建議多包一層外層資料夾；若 ZIP 解壓後變成 `my-dataset/dataset/images`，目前後端驗證會判定格式不符
- Docker 預設 dataset 目錄在 `/data/datasets`
- 若你是手動放置資料夾，後端在 `GET /api/datasets` 時會自動掃描 `/data/datasets`（或 `DATASETS_DIR`）下尚未註冊且格式正確的資料夾，並自動加入清單
- 前端建立任務頁可直接拖移 `.zip` 檔案進行上傳；選取 ZIP 後會自動切到參數設定頁，底部固定顯示上傳進度、檔名與速度
- 為避免「傳到一半」就被註冊，資料夾需同時通過結構驗證，且最近 15 秒內沒有寫入（API 上傳也會使用暫存標記檔避開中途掃描）
- 建立任務頁的 dataset 選單會列出 `DATASETS_DIR` 內所有資料夾；可用資料夾顯示照片數量，不可用資料夾會顯示失敗原因（例如缺少 `images/`、`sparse/` 或仍在寫入中）

## Timelapse API

- `GET /api/jobs/:id/timelapse/cameras`
- `GET /api/jobs/:id/timelapse/frames?camera=...&cursor=...`
- `GET /api/jobs/:id/timelapse/latest`
- `GET /api/jobs/:id/timelapse/download?camera=...|all`

## Model API

- `GET /api/jobs/:id/model/download`（下載該任務輸出目錄中最新的 `.ply` 模型檔）

## 測試

```bash
pnpm test
```
