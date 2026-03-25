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

React + Tailwind + shadcn 風格 UI 的 LichtFeld-Studio 網頁控制台，支援：

- 單租戶密碼保護
- 首頁任務清單（縮圖、進度、執行時間、經過時間、ETA）
- 兩步驟建立任務（Step 1: 上傳 ZIP 或選擇 Dataset、Step 2: 參數設定）
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

```bash
cp .env.example .env
# 編輯 .env：至少填 SESSION_SECRET / ADMIN_PASSWORD_HASH / LFS_BIN_PATH
mkdir -p data

docker compose up --build
```

Compose 只需要掛載一個資料夾：

- `./data:/data`
- 其中會自動建立：
  - `/data/datasets`
  - `/data/outputs`
  - `/data/db`
  - `/data/logs`

登入 session cookie 會自動依連線情境調整：

- 直接用 `http://主機:3000` 存取 Docker 服務時，不會強制 `Secure`，避免正確密碼也無法登入
- 若前面有 HTTPS reverse proxy，請保留 `X-Forwarded-Proto`，cookie 會自動標成 `Secure`

### Docker build 會自動編譯 LichtFeld-Studio

- 在 image build 階段會自動：
  1. `git clone` LichtFeld-Studio
  2. 使用 CMake + Ninja + vcpkg 編譯
  3. 安裝到 `/opt/lichtfeld`
- 預設執行檔：`/opt/lichtfeld/bin/LichtFeld-Studio`
- 可在 `.env` 覆蓋版本來源：
  - `LFS_REPO`
  - `LFS_REF`（預設 `master`）

## 環境變數

- `LFS_BIN_PATH`：LichtFeld-Studio 執行檔路徑
- `TIMELAPSE_MIN_FREE_GB`：低於此值會自動中止任務
- `DATASET_ALLOWED_ROOTS`：後端允許註冊的伺服器資料路徑白名單（主要給 API/進階流程使用）

## Timelapse API

- `GET /api/jobs/:id/timelapse/cameras`
- `GET /api/jobs/:id/timelapse/frames?camera=...&cursor=...`
- `GET /api/jobs/:id/timelapse/latest`
- `GET /api/jobs/:id/timelapse/download?camera=...|all`

## 測試

```bash
pnpm test
```
