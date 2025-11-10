# CI测试覆盖文档 (CI Test Coverage)

> **文档版本**: 1.0
> **最后更新**: 2025-11-07
> **CI平台**: GitHub Actions
> **关联workflow**: `.github/workflows/`

---

## 目录

- [1. 概述](#1-概述)
- [2. 当前CI流程分析](#2-当前ci流程分析)
- [3. CI测试改进方案](#3-ci测试改进方案)
- [4. 测试流水线设计](#4-测试流水线设计)
- [5. 跨平台测试策略](#5-跨平台测试策略)
- [6. 性能和缓存优化](#6-性能和缓存优化)
- [7. 失败处理和通知](#7-失败处理和通知)
- [8. 实施计划](#8-实施计划)

---

## 1. 概述

### 1.1 现状问题

**当前CI流程的致命缺陷**：

```yaml
# ❌ 问题1: release.yml - 发布流程完全不测试
release-mac:
  steps:
    - Build app              # 直接构建
    - Sign and notarize      # 直接签名
    - Upload to GitHub       # 直接发布
    # 没有测试！用户是第一批测试者

# ❌ 问题2: code-consistency-check.yml - lint被禁用
format-check:
  steps:
    - Check formatting       # ✅ prettier
    # TODO: add lint once fixed  # ❌ lint注释掉了
    - Type check             # ✅ tsc --noEmit
    # 没有运行测试！
```

**后果**：
- 每次发布都是赌博 🎰
- 回归bug直接进生产环境 🐛
- 用户报bug后才发现问题 😱
- 开发者信心不足，害怕改代码 😰

### 1.2 目标

**短期** (1周):
- ✅ 在PR检查中加入单元测试
- ✅ 修复lint问题，启用lint检查
- ✅ 添加测试覆盖率报告

**中期** (2周):
- ✅ 在发布流程前加入测试门禁
- ✅ 添加跨平台测试 (macOS/Linux/Windows)
- ✅ 添加集成测试

**长期** (1个月):
- ✅ 添加E2E测试 (可选)
- ✅ 添加性能回归测试
- ✅ 添加依赖安全扫描

---

## 2. 当前CI流程分析

### 2.1 现有Workflows

#### 2.1.1 code-consistency-check.yml

**触发条件**: PR到main分支
**运行平台**: ubuntu-latest (仅Linux)
**耗时**: ~2分钟

```yaml
jobs:
  format-check:
    runs-on: ubuntu-latest
    steps:
      - Checkout
      - Setup Node.js 24
      - npm ci
      - Check formatting          # ✅ 有
      # - Check linting           # ❌ 注释掉
      - Type check                # ✅ 有
      # - Run tests               # ❌ 没有！
```

**评分**: 🔴 3/10
- ✅ 有格式检查
- ✅ 有类型检查
- ❌ 没有lint
- ❌ 没有测试
- ❌ 只在Linux运行

#### 2.1.2 release.yml

**触发条件**: tag推送 (v*)
**运行平台**: macos-latest, ubuntu-latest
**耗时**: ~15-30分钟

```yaml
jobs:
  build-mac:
    # 本地测试构建，不发布

  release-mac:
    steps:
      - Build TypeScript/Vite   # ❌ 没测试就构建
      - Rebuild native modules
      - Sign with Apple Dev ID
      - Notarize
      - Upload DMG to Release   # ❌ 没测试就发布！

  release-linux:
    steps:
      - Build TypeScript/Vite   # ❌ 没测试就构建
      - Build AppImage + deb
      - Upload to Release       # ❌ 没测试就发布！
```

**评分**: 🔴 2/10
- ✅ 有构建验证
- ✅ 有签名验证 (macOS)
- ❌ 没有任何测试
- ❌ 没有冒烟测试
- ❌ 没有E2E测试

**风险等级**: 🔴 **极高** - 用户是第一批测试者！

---

## 3. CI测试改进方案

### 3.1 新增: test.yml (核心测试流水线)

**目标**: 提供统一的测试入口，被其他workflows调用

```yaml
# .github/workflows/test.yml
name: Test Suite

on:
  workflow_call:      # 可被其他workflow调用
    inputs:
      platform:
        required: false
        type: string
        default: 'ubuntu-latest'
      coverage:
        required: false
        type: boolean
        default: false
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    name: Test (${{ matrix.os }})
    runs-on: ${{ matrix.os }}

    strategy:
      fail-fast: false    # 不要因为一个平台失败就取消其他平台
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node-version: [22]

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'

      - name: Setup Python (for node-gyp)
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install system dependencies (Linux)
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y build-essential git

      - name: Install dependencies
        run: npm ci

      - name: Rebuild native modules
        run: npm run rebuild

      - name: Lint
        run: npm run lint

      - name: Type check
        run: npm run type-check

      - name: Run unit tests
        run: npm test

      - name: Run unit tests with coverage
        if: inputs.coverage || github.event_name == 'pull_request'
        run: npm run test:coverage

      - name: Upload coverage to Codecov
        if: inputs.coverage || github.event_name == 'pull_request'
        uses: codecov/codecov-action@v4
        with:
          file: ./coverage/coverage-final.json
          flags: unittests-${{ matrix.os }}
          name: codecov-${{ matrix.os }}
```

### 3.2 改进: code-consistency-check.yml

**新增**: 调用test.yml

```yaml
# .github/workflows/code-consistency-check.yml
name: Code Consistency Check

on:
  pull_request:
    branches: [main]
  workflow_dispatch:

jobs:
  format-check:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Check formatting
        run: npm run format:check

  # ✅ 新增：调用测试流水线
  test:
    uses: ./.github/workflows/test.yml
    with:
      platform: ubuntu-latest
      coverage: true
```

### 3.3 改进: release.yml

**关键改进**: 在构建前运行完整测试

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags: ['v*']
  workflow_dispatch: ...

jobs:
  # ✅ 新增：发布前的测试门禁
  pre-release-test:
    name: Pre-release Test Gate
    uses: ./.github/workflows/test.yml
    with:
      coverage: true

  # ✅ 新增：跨平台测试
  test-all-platforms:
    name: Test All Platforms
    needs: pre-release-test
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm test
      - run: npm run build
      # 验证构建产物
      - name: Smoke test built files
        run: |
          test -f dist/main/main/entry.js || exit 1
          test -f dist/renderer/index.html || exit 1

  build-mac:
    needs: test-all-platforms    # ✅ 测试通过才构建
    runs-on: macos-latest
    steps: ...

  release-mac:
    needs: build-mac              # 保持现有依赖
    runs-on: macos-latest
    steps:
      # 现有步骤保持不变
      ...

      # ✅ 新增：发布前的冒烟测试
      - name: Smoke test packaged app (macOS)
        run: |
          APP="release/mac-arm64/emdash.app"
          if [ -d "$APP" ]; then
            # 测试能否启动（不打开GUI）
            ELECTRON_RUN_AS_NODE=1 "$APP/Contents/MacOS/emdash" \
              -e "console.log('Smoke test passed')"
          fi

  release-linux:
    needs: test-all-platforms    # ✅ 测试通过才构建
    runs-on: ubuntu-latest
    steps: ...
```

---

## 4. 测试流水线设计

### 4.1 三层测试金字塔

```
        ┌─────────────┐
        │  E2E测试    │  (可选，耗时长)
        │  <5% 时间   │
        └─────────────┘
       ┌───────────────┐
       │  集成测试      │  (重要API/IPC)
       │  ~15% 时间     │
       └───────────────┘
    ┌─────────────────────┐
    │   单元测试           │  (核心逻辑)
    │   ~80% 时间          │
    └─────────────────────┘
```

### 4.2 测试阶段划分

#### Stage 1: 快速检查 (< 2分钟)
- Lint
- Type check
- 格式检查

如果失败 → **立即终止**，节省资源

#### Stage 2: 单元测试 (< 5分钟)
- 运行所有单元测试
- 生成覆盖率报告
- 并行在3个平台运行

如果失败 → **不允许合并/发布**

#### Stage 3: 构建验证 (< 3分钟)
- TypeScript编译
- Vite打包
- Native模块重构建
- 验证产物完整性

如果失败 → **不允许发布**

#### Stage 4: 打包测试 (仅Release, < 10分钟)
- electron-builder打包
- 签名验证
- 冒烟测试 (启动app不crash)

如果失败 → **不发布**

---

## 5. 跨平台测试策略

### 5.1 平台矩阵

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]
    node-version: [22]
    include:
      # macOS特定配置
      - os: macos-latest
        arch: arm64
      - os: macos-latest
        arch: x64

      # Linux发行版
      - os: ubuntu-22.04   # LTS
      - os: ubuntu-20.04   # 老版本兼容性

      # Windows
      - os: windows-latest
```

### 5.2 平台特定测试

#### macOS
```yaml
- name: Test macOS PATH handling
  if: runner.os == 'macOS'
  run: npm test -- --grep "PATH.*Homebrew"

- name: Test macOS native modules
  if: runner.os == 'macOS'
  run: |
    npm test -- --grep "node-pty.*darwin"
    npm test -- --grep "keytar.*darwin"
```

#### Windows
```yaml
- name: Test Windows shell resolution
  if: runner.os == 'Windows'
  run: npm test -- --grep "cmd.exe|PowerShell|.cmd"

- name: Test Windows worktree cleanup
  if: runner.os == 'Windows'
  run: npm test -- --grep "attrib.*Windows"
```

#### Linux
```yaml
- name: Test Linux sandbox
  if: runner.os == 'Linux'
  run: npm test -- --grep "sandbox.*read-only"
```

### 5.3 条件跳过

```typescript
// 测试文件中
describe('CodexService', () => {
  it.skipIf(process.platform !== 'win32')(
    '应该在Windows上查找.cmd文件',
    async () => { ... }
  );

  it.skipIf(process.platform !== 'darwin')(
    '应该在macOS上从login shell读取PATH',
    async () => { ... }
  );
});
```

---

## 6. 性能和缓存优化

### 6.1 依赖缓存

```yaml
- name: Cache node_modules
  uses: actions/cache@v4
  with:
    path: node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-node-

- name: Cache Electron binaries
  uses: actions/cache@v4
  with:
    path: |
      ~/.cache/electron
      ~/.cache/electron-builder
    key: ${{ runner.os }}-electron-${{ hashFiles('package-lock.json') }}
```

### 6.2 测试并行化

```yaml
- name: Run tests in parallel
  run: npm test -- --reporter=verbose --threads --maxThreads=4
```

### 6.3 增量测试 (仅PR)

```yaml
- name: Get changed files
  id: changed-files
  uses: tj-actions/changed-files@v42
  with:
    files: |
      src/**/*.ts
      src/**/*.tsx

- name: Run tests for changed modules only
  if: steps.changed-files.outputs.any_changed == 'true'
  run: |
    # 仅测试修改的文件相关的测试
    npm test -- --changed
```

---

## 7. 失败处理和通知

### 7.1 测试失败处理

```yaml
- name: Run tests
  id: test
  run: npm test
  continue-on-error: true

- name: Archive test results
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: test-results-${{ matrix.os }}
    path: |
      coverage/
      test-results/
    retention-days: 7

- name: Fail if tests failed
  if: steps.test.outcome == 'failure'
  run: exit 1
```

### 7.2 覆盖率门禁

```yaml
- name: Check coverage threshold
  run: |
    COVERAGE=$(jq '.total.lines.pct' coverage/coverage-summary.json)
    THRESHOLD=50
    if (( $(echo "$COVERAGE < $THRESHOLD" | bc -l) )); then
      echo "Coverage $COVERAGE% is below threshold $THRESHOLD%"
      exit 1
    fi
```

### 7.3 PR评论

```yaml
- name: Comment PR with coverage
  if: github.event_name == 'pull_request'
  uses: actions/github-script@v7
  with:
    script: |
      const coverage = require('./coverage/coverage-summary.json');
      const comment = `
      ## 测试覆盖率报告

      | 类型 | 覆盖率 | 状态 |
      |------|--------|------|
      | Lines | ${coverage.total.lines.pct}% | ${coverage.total.lines.pct >= 50 ? '✅' : '❌'} |
      | Branches | ${coverage.total.branches.pct}% | ${coverage.total.branches.pct >= 50 ? '✅' : '❌'} |
      | Functions | ${coverage.total.functions.pct}% | ${coverage.total.functions.pct >= 50 ? '✅' : '❌'} |
      `;

      github.rest.issues.createComment({
        issue_number: context.issue.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        body: comment
      });
```

### 7.4 Slack通知 (可选)

```yaml
- name: Notify Slack on failure
  if: failure() && github.ref == 'refs/heads/main'
  uses: slackapi/slack-github-action@v1
  with:
    payload: |
      {
        "text": "❌ Tests failed on main branch",
        "blocks": [
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "*Tests failed*\n<${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}|View logs>"
            }
          }
        ]
      }
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

---

## 8. 实施计划

### 8.1 第1周：基础测试集成

**目标**: 让测试在CI中跑起来

#### Day 1-2: 修复现有问题
```bash
# 1. 修复lint问题
npm run lint --fix
# 手动修复剩余问题

# 2. 在package.json添加test命令
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest watch",
    "test:coverage": "vitest run --coverage"
  }
}

# 3. 添加vitest.config.ts
```

#### Day 3-4: 创建test.yml
```bash
# 创建 .github/workflows/test.yml
# 按照 3.1 章节的配置

# 本地验证
act -j test    # 使用act本地运行GitHub Actions
```

#### Day 5: 更新code-consistency-check.yml
```bash
# 启用lint检查
# 添加test job调用test.yml
```

#### Day 6-7: 验证和监控
```bash
# 创建测试PR验证流程
# 监控CI运行时间
# 优化缓存配置
```

### 8.2 第2周：测试门禁

**目标**: 在发布前强制运行测试

#### Day 8-10: 更新release.yml
```yaml
# 添加pre-release-test job
# 添加test-all-platforms job
# 添加冒烟测试
```

#### Day 11-12: 跨平台测试
```yaml
# 配置platform matrix
# 添加平台特定测试
```

#### Day 13-14: 覆盖率报告
```bash
# 集成Codecov
# 添加PR评论
# 配置覆盖率门禁 (50%+)
```

### 8.3 第3周：优化和监控

**目标**: 提升CI性能和可靠性

#### Day 15-17: 性能优化
```yaml
# 添加依赖缓存
# 添加Electron二进制缓存
# 启用测试并行化
# 实现增量测试
```

#### Day 18-19: 失败处理
```yaml
# 添加artifact上传
# 添加失败通知
# 添加重试机制
```

#### Day 20-21: 文档和培训
```markdown
# 更新CONTRIBUTING.md
# 编写CI故障排查指南
# 团队分享会
```

---

## 9. 成本分析

### 9.1 CI时间预估

#### 当前 (无测试)
```
code-consistency-check.yml:  ~2分钟
release.yml (macOS):        ~20分钟
release.yml (Linux):        ~15分钟
总计:                        ~37分钟/release
```

#### 改进后 (有测试)
```
PR检查:
  - Format/Lint/Type:       ~2分钟
  - Test (Linux):           ~5分钟
  - Test (macOS):           ~6分钟
  - Test (Windows):         ~7分钟
  总计:                      ~20分钟 (并行) → ~8分钟

Release:
  - Pre-release test:       ~8分钟 (并行)
  - Build + Test:           ~25分钟 (macOS)
  - Build + Test:           ~20分钟 (Linux)
  总计:                      ~53分钟/release
```

**增加时间**:
- PR: +6分钟
- Release: +16分钟

**收益**:
- 避免发布有bug的版本
- 提前发现跨平台问题
- 开发者信心提升

### 9.2 GitHub Actions分钟数

免费额度 (公开仓库): **无限制**
私有仓库: 2000分钟/月

预估消耗:
- 每个PR: ~8分钟 × 3平台 = 24分钟
- 每次发布: ~53分钟
- 每月(假设20 PR + 4 release): 20×24 + 4×53 = **692分钟/月**

**✅ 在免费额度内**

---

## 10. 监控指标

### 10.1 关键指标

建议追踪以下指标：

```markdown
| 指标 | 目标 | 当前 | 趋势 |
|------|------|------|------|
| **测试覆盖率** | >70% | 3.5% | 📈 |
| **PR检查通过率** | >95% | N/A | - |
| **CI平均运行时间 (PR)** | <10分钟 | 2分钟 | ⚠️ |
| **CI平均运行时间 (Release)** | <60分钟 | 37分钟 | ⚠️ |
| **测试成功率** | >98% | N/A | - |
| **Release失败率** | <5% | Unknown | ❓ |
| **平均修复时间 (MTTR)** | <4小时 | Unknown | ❓ |
```

### 10.2 Dashboard (可选)

使用GitHub Actions badges:

```markdown
# README.md
[![Tests](https://github.com/generalaction/emdash/workflows/Test/badge.svg)](https://github.com/generalaction/emdash/actions)
[![Coverage](https://codecov.io/gh/generalaction/emdash/branch/main/graph/badge.svg)](https://codecov.io/gh/generalaction/emdash)
[![Release](https://img.shields.io/github/v/release/generalaction/emdash)](https://github.com/generalaction/emdash/releases)
```

---

## 11. 常见问题

### Q1: CI运行太慢怎么办？

**A**: 优化策略
1. 使用更多缓存（node_modules, Electron binaries）
2. 只在Linux上跑完整测试，其他平台跑冒烟测试
3. PR只跑增量测试，main分支跑全量测试
4. 使用faster runners (付费)

### Q2: 测试经常flaky怎么办？

**A**:
1. 识别flaky测试 (连续3次失败才算真失败)
2. 添加重试机制 (vitest `retry: 2`)
3. 隔离flaky测试到单独的job
4. 修复根本原因 (通常是竞态条件或外部依赖)

### Q3: Native模块在CI上编译失败？

**A**:
1. 确保Python 3.11安装
2. Linux: 安装`build-essential`
3. Windows: 安装`windows-build-tools`
4. 使用预编译二进制 (如果可用)

### Q4: 需要测试真实的Git操作怎么办？

**A**:
```yaml
- name: Setup Git
  run: |
    git config --global user.name "CI Bot"
    git config --global user.email "ci@emdash.sh"

- name: Create test repo
  run: |
    mkdir /tmp/test-repo
    cd /tmp/test-repo
    git init
    git commit --allow-empty -m "Initial commit"
```

---

## 附录

### A. 完整配置文件

参考:
- `.github/workflows/test.yml` (新建)
- `.github/workflows/code-consistency-check.yml` (修改)
- `.github/workflows/release.yml` (修改)

### B. 本地CI测试

使用[act](https://github.com/nektos/act)在本地运行GitHub Actions:

```bash
# 安装act
brew install act    # macOS
# 或
curl https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash

# 运行特定job
act -j test

# 运行PR工作流
act pull_request

# 调试模式
act -j test --verbose
```

### C. CI故障排查清单

```markdown
- [ ] 检查GitHub Actions日志
- [ ] 本地能否复现问题 (npm test)
- [ ] 是否是平台特定问题
- [ ] 是否是依赖版本问题
- [ ] 是否是flaky test
- [ ] 是否是网络/超时问题
- [ ] 检查secret是否配置正确
- [ ] 检查权限 (GITHUB_TOKEN)
```

---

**下一步**: 实施第1周的改进计划
