# AGENTS.md

本檔提供在此 repository 內工作的 AI Agent/自動化工具遵循規則。

## 專案定位與免責

1. 本專案 **不是** LichtFeld-Studio 官方專案。
2. 本專案包含 AI 協助產生之程式碼。
3. 對於使用本專案造成之任何損失（資料、金錢、商譽、硬體、資安或服務可用性），作者與貢獻者 **概不負責**。
4. Agent 必須避免暗示「官方背書」或「官方保證」。

## 語言與溝通

1. 預設使用台灣繁體中文。
2. 回覆需清楚說明風險、假設與限制。
3. 不得宣稱未驗證的結果為已保證正確。

## 開發規範

1. 套件管理：使用 `pnpm`（workspace/monorepo）。
2. 主要指令：
   - `pnpm -r build`
   - `pnpm test`
3. 前端：React + Tailwind。
4. 後端：Node.js + TypeScript。
5. Docker 部署：以單一 `./data:/data` volume 為預設。

## 程式碼與安全

1. 變更前先理解現有流程，不任意破壞 API 相容性。
2. 禁止把密碼、金鑰、Token 寫入 repo。
3. 任何涉及訓練刪除/中止等操作，需保留可追蹤紀錄。
4. 若修改影響資料安全或成本，必須在 PR/commit 註明風險。

## 前端 UI 樣式指南（針對 Tailwind）

本專案使用特製的 `glass-panel` 與 `icon-mask` 玻璃金屬質感，在建立新元件或修改 UI 時應遵守以下規範：

1. **`glass-panel` 工具類**: 
   - 用於取代所有的邊框（`border`）與光環（`ring`）。
   - 會自動使用 `::before` 與 `::after` 加上精緻的半透明 0.5px 邊框與頂部漸層高光，並設定為 `isolate` (產生 z-index 堆疊上下文)。
   - **重要**：加上此類別的元件不可設置原生邊框寬度（請加上 `border-0`），且不需設置原生邊框顏色。這已經整合在全局的 Shadcn UI 組件中 (`Button`, `Input`, `Textarea`, `Badge`, `Card`)。
   - 使用方式範例：`<div className="glass-panel rounded-xl bg-black/20 p-4">...</div>`
2. **`icon-mask` 工具類**: 
   - 用於帶有深色光暈效果的圓形圖示遮罩，會讓元素的底部漸層消失。
   - 適合用在裝飾性 Icon 的外層 div，增強科技感。

## Dockerfile 依賴維護

本節說明當 LichtFeld-Studio 升版後遇到 `error while loading shared libraries` 時的處理方式。

### 根本原因

`Dockerfile` 的 `lfs-build` 階段透過 cmake + vcpkg 建構 LichtFeld-Studio，但 `cmake --install` 只安裝 LichtFeld-Studio 自己的 target（`liblfs_*.so`），**不會**把 vcpkg 建構的第三方 `.so` 複製到安裝路徑。runtime image 又是乾淨的 `nvidia/cuda:*-runtime`，幾乎不含任何開發套件，因此大量 vcpkg 依賴在執行時找不到。

### vcpkg manifest mode 的安裝路徑

LichtFeld-Studio 使用 manifest mode（根目錄有 `vcpkg.json`），vcpkg 依賴**不在** `/opt/vcpkg/installed/`，而是在：

```
/opt/src/LichtFeld-Studio/build/vcpkg_installed/<triplet>/lib/
```

CMakeLists.txt 的 RPATH 設定也印證這點：

```cmake
set(_vcpkg_release_runtime_dir "${CMAKE_BINARY_DIR}/vcpkg_installed/${VCPKG_TARGET_TRIPLET}/lib")
```

### 正確的複製策略

修改 `Dockerfile` 的 `lfs-build` 階段，在 `cmake --install` 之後用以下 for loop 一次複製所有 vcpkg `.so`（同時處理 regular files 與 symlinks，排除 debug 版本，`-maxdepth 3` 避免掃入 Python stdlib 子目錄）：

```dockerfile
&& for vcpkg_dir in /opt/src/LichtFeld-Studio/build/vcpkg_installed /opt/vcpkg/installed; do \
     [ -d "$vcpkg_dir" ] || continue; \
     find "$vcpkg_dir" -not -path '*/debug/*' -maxdepth 3 \
       \( -name '*.so' -o -name '*.so.*' \) \( -type f -o -type l \) \
       -exec cp -an {} /opt/lichtfeld/lib/ \;; \
   done \
```

### 升版時的注意事項

1. 升版後若出現 `cannot open shared object file`，**不要**只針對報錯的單一 `.so` 加 pattern，應確認上述 for loop 是否存在且路徑正確。
2. 若 vcpkg 新增了大量子目錄深度超過 3 層的依賴（較少見），才需要調整 `-maxdepth`。
3. vcpkg 依賴清單以 `vcpkg.json` 為準，可能包含：ffmpeg、SDL3、Python3、TBB、OpenImageIO、assimp、RmlUi、boost-regex、OpenSSL、libarchive、freetype、USD 等，均需透過上述策略一併帶入。

## 文件更新

1. 調整部署、環境變數、API 或重大行為時，必須同步更新 `README.md`。
2. 若新增 Agent 工作流程或限制，請更新本檔案。
