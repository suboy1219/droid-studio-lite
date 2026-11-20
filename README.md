# Droid Studio Lite

一个轻量的 Android Studio 替代品，只保留三件最常用的东西：**Logcat**、**Device Explorer**、**文本编辑器**。

基于 Electron + React + CodeMirror 6，所有设备操作直接调用本机 `adb`。

## 功能

- **Logcat**：实时流式日志，级别（V/D/I/W/E/F）开关、tag 过滤、关键词搜索、pid 过滤、暂停/恢复、自动跟随、清空、导出为 txt。断线后自动重连。
- **Device Explorer**：浏览设备目录（默认 `/sdcard`），支持进入/返回、路径直达、面包屑、新建文件夹、上传、下载到本地、删除；双击文本文件直接用编辑器打开。
- **文本编辑器**：CodeMirror 6，多标签，行号、语法高亮（JS/TS/JSON/XML/HTML/Java/Kotlin/Gradle）、查找替换、自动换行；同时支持本地文件与设备文件（打开 → 编辑 → 保存回写，并保留原文件权限）。

## 运行

```bash
npm install
npm run dev
```

`npm run dev` 会同时启动 Vite 开发服务器和 Electron 窗口。

## 打包

```bash
npm run dist
```

产物是单文件免安装版 `release/DroidStudioLite-<version>.exe`，双击直接运行，无需安装（首次启动会解压到临时目录，比安装版稍慢）。

另有免安装目录版 `release/win-unpacked/Droid Studio Lite.exe`，启动更快。

如果 Electron / nsis 下载缓慢，可先设置镜像：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
```

## 快捷键

| 快捷键 | 作用 |
| --- | --- |
| `Ctrl+S` | 保存当前文件 |
| `Ctrl+Shift+S` | 另存为（转为本地文件） |
| `Ctrl+W` | 关闭当前标签 |

## adb 查找顺序

1. 应用内手动指定（工具栏「adb 设置」）
2. `ANDROID_HOME` / `ANDROID_SDK_ROOT` / `ANDROID_SDK_HOME`
3. 系统 `PATH`
4. `%LOCALAPPDATA%\Android\Sdk` 及常见安装目录

## 已知限制

- 非 root 设备无法浏览 `/data/data` 下其他应用的私有目录，这是 Android 权限模型限制；有 `su` 的设备可自行用 root shell 访问。
- 设备文件保存依赖 `adb push`，仅对 shell 用户有写权限的位置有效（如 `/sdcard`、`/data/local/tmp`）。
- 文本编辑器上限 8 MB，二进制文件会被拒绝打开。
- Logcat 首次连接只展示最近约 4000 行历史，之后实时追加，界面最多保留 3 万行。
