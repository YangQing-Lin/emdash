# Windows 构建指南

本文档提供 Emdash 在 Windows 10/11 上的完整编译流程。

> **当前状态**：Windows 支持处于实验阶段。官方 CI/CD 流水线暂未包含 Windows 构建，因此需要手动编译。

---

## 系统要求

- **操作系统**：Windows 10 1809+ 或 Windows 11（需要 ConPTY 支持）
- **磁盘空间**：至少 5GB（包含依赖和构建产物）
- **网络**：稳定的互联网连接（下载依赖约 500MB+）

---

## 前置依赖安装

### 1. Node.js 22.20.0

**方式一：使用 nvm-windows（推荐）**

```powershell
# 1. 下载 nvm-windows 安装器
# https://github.com/coreybutler/nvm-windows/releases/latest
# 下载 nvm-setup.exe 并运行

# 2. 安装完成后，打开新的 PowerShell 窗口
nvm install 22.20.0
nvm use 22.20.0

# 3. 验证版本
node -v
# 输出：v22.20.0
npm -v
# 输出：10.x.x 或更高
```

**方式二：直接安装**

```powershell
# 下载 Node.js 22.20.0 Windows 安装器：
# https://nodejs.org/dist/v22.20.0/node-v22.20.0-x64.msi
# 运行安装器，接受默认选项

# 验证安装
node -v
```

---

### 2. Python 3.11

**node-gyp 编译 native modules 需要 Python 3.11.x**

```powershell
# 1. 下载 Python 3.11.x Windows 安装器：
# https://www.python.org/downloads/windows/
# 选择 "Windows installer (64-bit)"

# 2. 运行安装器时：
#    ✅ 勾选 "Add Python 3.11 to PATH"
#    ✅ 选择 "Customize installation"
#    ✅ 勾选 "pip"、"py launcher"

# 3. 验证安装
python --version
# 输出：Python 3.11.x

pip --version
# 输出：pip 23.x.x (python 3.11)
```

**配置 npm 使用此 Python**

```powershell
# 查找 Python 安装路径
where python
# 输出类似：C:\Python311\python.exe

# 配置 npm
npm config set python "C:\Python311\python.exe"
```

---

### 3. Visual Studio Build Tools

**编译 native modules（sqlite3、node-pty、keytar）需要 C++ 编译器**

**方式一：自动安装（推荐，但可能失败）**

```powershell
# 以管理员身份运行 PowerShell
npm install --global --production windows-build-tools

# 此命令会自动安装：
# - Visual Studio Build Tools 2017
# - Python 2.7（node-gyp 的遗留依赖）
```

**方式二：手动安装（更可靠）**

```powershell
# 1. 下载 Visual Studio Build Tools 2022：
# https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022

# 2. 运行安装器，在 "Workloads" 标签页选择：
#    ✅ Desktop development with C++

# 3. 在 "Individual components" 标签页确保选中：
#    ✅ MSVC v143 - VS 2022 C++ x64/x86 build tools
#    ✅ Windows 10 SDK (10.0.19041.0 或更高)

# 4. 安装完成后，配置 npm
npm config set msvs_version 2022
```

---

### 4. Git for Windows

```powershell
# 1. 下载 Git for Windows：
# https://git-scm.com/download/win
# 下载 64-bit Git for Windows Setup

# 2. 运行安装器，关键选项：
#    - "Adjusting your PATH environment"
#      选择：Git from the command line and also from 3rd-party software
#    - "Configuring the line ending conversions"
#      选择：Checkout as-is, commit as-is（避免换行符问题）

# 3. 验证安装
git --version
# 输出：git version 2.x.x
```

---

## 编译流程

### 步骤 1：克隆代码仓库

```powershell
# 打开 PowerShell（建议以管理员身份运行）

# 选择一个简短路径（避免路径长度限制）
cd C:\
mkdir Projects
cd Projects

# 克隆仓库
git clone https://github.com/generalaction/emdash.git
cd emdash

# 验证分支
git branch
# 输出：* main
```

**⚠️ 重要提示**：
- 避免路径包含空格、中文或特殊字符
- 建议使用短路径（如 `C:\Projects\emdash`）
- Windows 路径长度限制为 260 字符，深层嵌套可能导致 npm install 失败

---

### 步骤 2：安装 npm 依赖

```powershell
# 确保在 emdash 项目根目录
cd C:\Projects\emdash

# 清理 npm 缓存（可选，但推荐）
npm cache clean --force

# 安装依赖（约 10-20 分钟）
npm install

# 如果遇到网络超时，配置国内镜像（可选）
npm config set registry https://registry.npmmirror.com
npm install
```

**常见错误处理**：

```powershell
# 错误：EPERM: operation not permitted
# 解决：以管理员身份运行 PowerShell

# 错误：Maximum call stack size exceeded
# 解决：清理并重装
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json
npm install

# 错误：gyp ERR! find Python
# 解决：显式指定 Python 路径
npm config set python "C:\Python311\python.exe"
npm install
```

---

### 步骤 3：重建 Native Modules

**这是最关键的步骤！必须为 Electron 重建 native modules**

```powershell
# 自动重建（使用项目脚本）
npm run rebuild

# 如果失败，手动重建关键模块
npx @electron/rebuild -f -w sqlite3,node-pty,keytar
```

**分模块调试**（如果全量重建失败）：

```powershell
# 单独重建 sqlite3
npx @electron/rebuild -f -m node_modules/sqlite3

# 单独重建 node-pty
npx @electron/rebuild -f -m node_modules/node-pty

# 单独重建 keytar（可能失败，见下文）
npx @electron/rebuild -f -m node_modules/keytar
```

**keytar 编译失败的处理**：

keytar 用于安全存储凭证，在 Windows 上依赖 Windows Credential Manager。如果编译失败：

```powershell
# 临时方案：将 keytar 设为可选依赖
# 编辑 package.json，将这一行：
#   "keytar": "^7.9.0"
# 从 "dependencies" 移动到 "optionalDependencies"

# 然后重新安装
npm install
npm run rebuild
```

**影响**：禁用 keytar 后，GitHub/Linear/Jira 的 API token 将存储在明文配置中（仅本地，无安全风险）。

---

### 步骤 4：编译应用代码

```powershell
# 编译 TypeScript（主进程）和 Vite（渲染进程）
npm run build

# 等待编译完成（约 1-3 分钟）
# 输出应包含：
#   ✓ built in 2.5s
```

**验证构建产物**：

```powershell
# 检查主进程产物
dir dist\main\main\
# 应该看到 entry.js 等文件

# 检查渲染进程产物
dir dist\renderer\
# 应该看到 index.html, assets/ 等
```

---

### 步骤 5：开发模式测试（可选）

**在打包前，先测试应用能否运行**

```powershell
# 启动开发模式
npm run dev

# 此命令会：
# 1. 启动 Vite 开发服务器（端口 3000）
# 2. 启动 Electron 主进程
# 3. 自动打开应用窗口
```

**预期结果**：
- Electron 窗口成功打开
- 界面正常渲染（左侧边栏、项目列表等）
- 控制台无严重报错

**常见问题**：

```powershell
# 问题 1：Electron 窗口一片空白
# 原因：Vite 开发服务器未启动
# 解决：分别运行两个命令
# 终端 1：
npm run dev:renderer
# 终端 2：
npm run dev:main

# 问题 2：报错 "Cannot find module 'sqlite3'"
# 原因：native module 未正确重建
# 解决：重新执行步骤 3

# 问题 3：终端无法启动（node-pty 错误）
# 原因：Windows 版本 < 1809（缺少 ConPTY）
# 解决：升级系统或使用 winpty（需手动适配代码）
```

---

### 步骤 6：打包成安装程序

```powershell
# 打包 Windows 版本（NSIS 安装器 + 便携版）
npm run package:win

# 打包过程约 10-15 分钟，输出在 release\ 目录
```

**预期产物**：

```powershell
dir release\

# 应该看到：
# emdash-x64-installer.exe  （安装版，约 150MB）
# emdash-x64.exe            （便携版，约 150MB）
# emdash-x64-installer.exe.blockmap （自动更新元数据）
```

---

### 步骤 7：安装和测试

```powershell
# 方式 1：运行安装器
.\release\emdash-x64-installer.exe
# 按提示安装到 C:\Program Files\emdash\
# 安装后从开始菜单启动

# 方式 2：运行便携版
.\release\emdash-x64.exe
# 直接启动，不安装
```

**功能验证清单**：

1. **应用启动**
   - [ ] 窗口正常打开
   - [ ] UI 完整渲染

2. **项目管理**
   - [ ] 能否添加项目（选择本地 Git 仓库）
   - [ ] 项目列表显示正常

3. **Workspace 创建**（测试 Git worktree）
   - [ ] 点击 "New Workspace"
   - [ ] 输入名称，点击创建
   - [ ] 检查是否在 `../worktrees/` 创建了新目录
   - [ ] 运行 `git worktree list` 验证

4. **终端功能**（测试 node-pty）
   - [ ] 在 workspace 中打开终端
   - [ ] 能否输入命令（如 `echo hello`）
   - [ ] 输出是否正常显示

5. **Agent 运行**（如果已安装 Codex 等 CLI）
   - [ ] 选择 provider（如 Codex）
   - [ ] 启动 agent 会话
   - [ ] 发送简单指令（如 "list files"）
   - [ ] 查看响应是否正常

---

## 常见故障排查

### 1. 编译失败：node-gyp 错误

**症状**：
```
gyp ERR! find Python
gyp ERR! stack Error: Could not find any Python installation to use
```

**解决方案**：
```powershell
# 确保 Python 3.11 已安装并在 PATH 中
python --version

# 显式配置 npm
npm config set python "C:\Python311\python.exe"

# 重新安装
Remove-Item -Recurse -Force node_modules
npm install
```

---

### 2. 编译失败：MSBuild 错误

**症状**：
```
gyp ERR! find VS
gyp ERR! stack Error: Could not find any Visual Studio installation to use
```

**解决方案**：
```powershell
# 安装 Visual Studio Build Tools（见步骤 3）

# 配置 npm 使用正确版本
npm config set msvs_version 2022

# 清理并重装
npm cache clean --force
Remove-Item -Recurse -Force node_modules
npm install
```

---

### 3. 运行时崩溃：sqlite3 模块加载失败

**症状**：
- Electron 启动后立即崩溃
- 控制台报错：`Error: The module '...\sqlite3.node' was compiled against a different Node.js version`

**解决方案**：
```powershell
# 重建 sqlite3（指定 Electron 版本）
npx @electron/rebuild -f -w sqlite3

# 验证重建结果
dir node_modules\sqlite3\build\Release\
# 应该看到 node_sqlite3.node（注意是 .node 扩展名）
```

---

### 4. Git worktree 创建失败

**症状**：
- 创建 workspace 时报错
- 错误信息包含路径或权限问题

**可能原因和解决方案**：

```powershell
# 原因 1：路径包含中文或特殊字符
# 解决：将项目移动到纯英文路径
Move-Item C:\中文路径\emdash C:\Projects\emdash

# 原因 2：Git 未正确配置
# 解决：配置 Git
git config --global core.autocrlf false
git config --global core.filemode false

# 原因 3：权限不足
# 解决：以管理员身份运行 Emdash
```

---

### 5. 终端无法启动（node-pty）

**症状**：
- 点击终端面板无响应
- 控制台报错：`conpty not available`

**解决方案**：

```powershell
# 检查 Windows 版本（需要 >= 1809）
winver
# 如果版本号 < 1809（如 1803、1709），升级系统

# Windows 10 1809+ 升级方法：
# 设置 > 更新和安全 > Windows 更新 > 检查更新
```

**替代方案**（如果无法升级系统）：
- 使用外部终端（如 Windows Terminal）手动进入 worktree 目录

---

### 6. 打包失败：electron-builder 错误

**症状**：
```
Cannot compute electron version from installed node modules
```

**解决方案**：
```powershell
# 确保 electron 已正确安装
npm list electron
# 输出应显示：electron@30.5.1

# 如果缺失，手动安装
npm install electron@30.5.1 --save-dev

# 重新打包
npm run package:win
```

---

## 性能优化建议

### 1. 加速 npm install

```powershell
# 使用国内镜像（提升下载速度 5-10 倍）
npm config set registry https://registry.npmmirror.com
npm config set electron_mirror https://npmmirror.com/mirrors/electron/
npm config set electron_builder_binaries_mirror https://npmmirror.com/mirrors/electron-builder-binaries/
```

### 2. 减少打包时间

```powershell
# 仅打包便携版（跳过安装器，节省 5 分钟）
npx electron-builder --win portable --x64 --publish never
```

### 3. 调试构建问题

```powershell
# 启用详细日志
$env:DEBUG="electron-builder"
npm run package:win

# 构建单个架构（如果只需 x64）
npx electron-builder --win --x64 --publish never
```

---

## 已知限制

1. **自动更新不可用**
   - 原因：官方未发布 Windows 版本到 GitHub Releases
   - 影响：无法使用应用内自动更新功能
   - 解决：手动下载新版本重新安装

2. **keytar 凭证存储**
   - 状态：可能编译失败（依赖 Windows Credential Manager）
   - 影响：API token 可能存储在明文配置中
   - 风险：仅本地存储，无远程传输

3. **路径长度限制**
   - 问题：Windows MAX_PATH = 260 字符
   - 影响：深层 node_modules 可能导致安装失败
   - 解决：使用短路径 + 启用长路径支持（Windows 10 1607+）
     ```powershell
     # 以管理员身份运行
     New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
     ```

4. **Git worktree 路径**
   - 问题：Windows 路径分隔符（`\`）可能导致问题
   - 影响：workspace 创建可能失败
   - 解决：项目路径使用英文、无空格、无特殊字符

---

## 开发模式快速启动

如果你经常需要调试，使用这个工作流：

```powershell
# 一次性设置（仅首次）
cd C:\Projects\emdash
npm install
npm run rebuild

# 每次开发启动
npm run dev

# 热重载：
# - 渲染进程（React）：自动热重载
# - 主进程（Electron）：修改后需手动重启（Ctrl+C 后重新 npm run dev）
```

---

## 贡献 Windows 支持

如果你成功编译并希望帮助改进 Windows 支持：

### 1. 补充 CI/CD 流水线

编辑 `.github/workflows/release.yml`，参考 `release-mac` 和 `release-linux` job，添加 `release-win` job。

关键步骤：
- 使用 `runs-on: windows-latest`
- 安装 Python 3.11 和 Visual Studio Build Tools
- 运行 `npm run package:win`
- 上传产物到 GitHub Release

### 2. 提交测试报告

在 GitHub Issues 中提交：
- 标题：`[Windows] Build and functionality test report`
- 内容：
  - Windows 版本（如 Windows 10 21H2）
  - 编译成功/失败的详细日志
  - 功能测试清单（参考步骤 7）
  - 遇到的问题和解决方案

### 3. 代码修复

常见需要修复的区域：
- `src/main/services/WorktreeService.ts`：路径处理
- `src/main/services/ptyManager.ts`：Windows shell 兼容性
- `src/main/main.ts`：PATH 环境变量处理

提交 PR 时：
- 使用 Conventional Commits：`fix(windows): handle path separators in worktree creation`
- 附上测试截图或日志
- 确保不破坏 macOS/Linux 功能

---

## 获取帮助

- **GitHub Issues**：https://github.com/generalaction/emdash/issues
- **Discord 社区**：https://discord.gg/UmTn6Nb7
- **文档反馈**：如果本文档有错误或遗漏，欢迎提 PR 修正

---

## 附录：完整命令清单

```powershell
# ========================================
# 前置准备
# ========================================
# 1. 安装 Node.js 22.20.0（从官网下载或使用 nvm-windows）
# 2. 安装 Python 3.11（从官网下载）
# 3. 安装 Visual Studio Build Tools 2022
# 4. 安装 Git for Windows

# ========================================
# 编译流程（以管理员身份运行 PowerShell）
# ========================================

# 配置 npm
npm config set python "C:\Python311\python.exe"
npm config set msvs_version 2022

# 克隆代码
cd C:\Projects
git clone https://github.com/generalaction/emdash.git
cd emdash

# 安装依赖
npm install

# 重建 native modules
npm run rebuild

# 编译应用
npm run build

# 测试（可选）
npm run dev

# 打包
npm run package:win

# 验证产物
dir release\emdash-x64-installer.exe
dir release\emdash-x64.exe

# ========================================
# 故障排查
# ========================================

# 重置环境（核弹方案）
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json
npm cache clean --force
npm install
npm run rebuild
npm run build
npm run package:win
```

---

**文档版本**：v1.0
**最后更新**：2025-11-07
**适用版本**：Emdash 0.3.28+
**维护者**：社区贡献
