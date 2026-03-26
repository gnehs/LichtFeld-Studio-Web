# LichtFeld-Studio Web

> 非官方專案。與 [MrNeRF/LichtFeld-Studio](https://github.com/MrNeRF/LichtFeld-Studio) 無隸屬或官方背書關係。
>
> 本 repo 含有 AI 協助產生的程式碼與文件。請自行驗證功能、安全性與部署結果；因使用本專案造成的資料、成本、服務或硬體損失，作者與貢獻者概不負責。

LichtFeld-Studio 的簡易 Web 控制台，提供 React + Tailwind 前端與 Node.js + TypeScript 後端，方便在瀏覽器中管理 dataset、建立訓練任務、查看進度與下載輸出。

## 功能重點

- 單一管理者密碼登入
- Session 會持久化到 SQLite，後端重啟後可沿用既有登入狀態
- 會定期主動清理已過期的 session，避免資料表持續累積
- 上傳 ZIP 或直接選用伺服器上的 dataset
- 建立、停止、刪除訓練任務
- 刪除任務時會一併移除該任務的 output、timelapse 與 log，無法復原
- 查看 timelapse、模型輸出與系統資源資訊
- 低磁碟空間自動停止任務（Disk Guard）

## 專案結構

- `frontend/`: React + Vite + Tailwind 前端
- `backend/`: Express + TypeScript API 與訓練流程控制
- `scripts/init-password.mjs`: 產生管理者密碼 bcrypt hash

## 本機開發

1. 建立環境變數檔。

```bash
cp .env.example .env
```

2. 產生管理者密碼 hash，填入 `.env` 的 `ADMIN_PASSWORD_HASH`，並把 `SESSION_SECRET` 換成自己的值。

```bash
pnpm install --filter @lichtfeld/backend
node scripts/init-password.mjs your-password
```

3. 安裝依賴並啟動前後端。

```bash
pnpm install
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
- 容器內預設 `LFS_BIN_PATH=/opt/lichtfeld/bin/LichtFeld-Studio`

## 環境變數

必要：

- `SESSION_SECRET`: session secret
- `ADMIN_PASSWORD_HASH`: 管理者密碼的 bcrypt hash

常用選填：

- `TIMELAPSE_MIN_FREE_GB`: 剩餘空間低於此值時自動停止任務，預設 `5`
- `SESSION_CLEANUP_INTERVAL_MS`: 主動清理過期 session 的週期，預設 `3600000`（1 小時）
- `DATASET_ALLOWED_ROOTS`: 允許註冊的 dataset 路徑白名單，預設為 datasets 目錄
- `LFS_BIN_PATH`: LichtFeld-Studio 執行檔路徑；Docker 預設已設定

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

不論是前端上傳 ZIP，或手動放進 `datasets/`，都應符合這個結構。

## 常用指令

```bash
pnpm dev
pnpm -r build
pnpm test
```

`pnpm test` 目前執行 backend 測試。
