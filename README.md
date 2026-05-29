# 小红书数据导出工具

这个文件夹专门用于从小红书创作者中心导出笔记详情数据。

目标页面：

https://creator.xiaohongshu.com/statistics/data-analysis

## 第一次使用

可以直接双击：

```text
00-install-deps.bat
```

或者在终端安装依赖：

```powershell
cd C:\Users\FG\Documents\mutiDataAnalysis\xhs-data-exporter
npm.cmd install
```

然后双击：

```text
01-open-browser-login.bat
```

或者在终端打开专用浏览器：

```powershell
npm.cmd run browser
```

浏览器打开后，手动登录小红书创作者中心，并进入“数据分析”页面。

## 开始导出

登录完成后，不要关闭刚才打开的浏览器窗口。另开一个终端运行：

测试 1 条笔记：

```text
02-export-test-one.bat
```

全量导出：

```text
03-export-all.bat
```

导入 Excel 并生成统一数据表：

```text
05-import-data.bat
```

打开小红书数据分析中心：

```text
06-open-analysis-center.bat
```

或者在终端运行：

```powershell
cd C:\Users\FG\Documents\mutiDataAnalysis\xhs-data-exporter
npm.cmd run export
```

脚本会：

1. 连接已经登录的浏览器。
2. 打开小红书数据分析页。
3. 逐个点击页面里的“详情数据”。
4. 在详情页点击“导出”。
5. 如果有分页，继续点击“下一页”。

只测试 1 条笔记时可以这样运行：

```powershell
$env:XHS_MAX_NOTES="1"
npm.cmd run export
```

导出的文件默认放在：

```text
C:\Users\FG\Documents\mutiDataAnalysis\xhs-data-exporter\downloads
```

统一数据表默认生成在：

```text
C:\Users\FG\Documents\mutiDataAnalysis\xhs-data-exporter\data
```

## 页面按钮识别不准时

如果小红书页面里的按钮文案不是“详情数据”或“导出”，先运行：

```text
04-inspect-page.bat
```

或者在终端运行：

```powershell
npm.cmd run inspect
```

它会列出当前页面可点击元素的文字。然后修改 `config.json` 里的：

```json
{
  "detailTexts": ["详情数据"],
  "exportTexts": ["导出数据", "导出", "下载"],
  "exportAllButtonsInDetail": true,
  "closeTexts": ["关闭", "返回"],
  "nextPageTexts": ["下一页", "下一页 >"]
}
```

## 注意

- 这个工具不会保存账号密码。
- 请使用 `npm.cmd`，不要直接用 `npm`，因为当前 PowerShell 执行策略会拦截 `npm.ps1`。
- 如果浏览器没有打开，`npm.cmd run export` 会提示连接失败。
- 如果小红书把导出做成异步任务，脚本会完成点击，但文件可能需要在页面里稍后下载。
