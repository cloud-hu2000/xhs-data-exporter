# 小红书数据导出工具

这个文件夹专门用于从小红书创作者中心导出笔记详情数据。

目标页面：

https://creator.xiaohongshu.com/statistics/data-analysis

## 使用方法

Windows 下双击：

```text
run.bat
```

macOS 下双击 `run.command`；若系统提示权限不足，可在终端进入本目录后执行一次：

```bash
chmod +x run.command
./run.command
```

工具会自动寻找 macOS 的 Google Chrome、Chrome for Testing、Chromium 或 Microsoft Edge。每次都会使用项目内独立的浏览器配置目录（例如 `.chrome-profile-9222`），不会占用或修改日常 Chrome 的登录资料。首次运行请在这个独立窗口中登录小红书；之后会保留登录状态。

请将 Chrome、Chrome for Testing、Chromium 或 Microsoft Edge 安装到系统标准位置。

首次运行会自动检查并安装依赖。推荐选择“一键完整流程”，按提示完成登录确认后，工具会自动：

1. 全量导出笔记数据。
2. 导入下载文件并生成统一数据表。
3. 启动并打开分析中心。

也可以在菜单中单独执行测试导出、打开登录浏览器、导入数据、检查页面按钮等操作。

分析中心的界面由 Tailwind CSS 构建，并使用 Flowbite 组件。运行仪表盘命令时会自动生成样式；开发样式时可另开终端运行 `npm run dashboard:css:watch`。

命令行用户可以直接传入命令：

```powershell
run.bat full
run.bat test
run.bat browser
run.bat export
run.bat import
run.bat dashboard
run.bat inspect
```

脚本会：

1. 连接已经登录的浏览器。
2. 打开小红书数据分析页。
3. 逐个点击页面里的“详情数据”。
4. 在详情页点击“导出”。
5. 如果有分页，继续点击“下一页”。

只测试 1 条笔记时，在 `run.bat` 菜单中选择“测试流程”即可。

导出的文件默认放在：

```text
C:\Users\FG\Documents\mutiDataAnalysis\xhs-data-exporter\downloads
```

统一数据表默认生成在：

```text
C:\Users\FG\Documents\mutiDataAnalysis\xhs-data-exporter\data
```

## 页面按钮识别不准时

如果小红书页面里的按钮文案不是“详情数据”或“导出”，在 `run.bat` 菜单中选择“检查当前页面按钮”。

它会列出当前页面可点击元素的文字。然后修改 `config.json` 里的：

```json
{
  "detailTexts": ["分析详情", "详情数据"],
  "exportTexts": ["导出数据", "导出", "下载"],
  "exportAllButtonsInDetail": true,
  "closeTexts": ["关闭", "返回"],
  "nextPageTexts": ["下一页", "下一页 >"]
}
```

## 注意

- 这个工具不会保存账号密码。
- Windows 下依赖安装会自动使用 `npm.cmd`，无需手动处理 PowerShell 执行策略。
- 导出前如果浏览器没有打开，统一入口会自动打开并等待登录确认。
- 如果小红书把导出做成异步任务，脚本会完成点击，但文件可能需要在页面里稍后下载。
