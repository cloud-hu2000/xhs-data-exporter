# 发布前检测与发布后复盘

“发布前工具 / 发布前检测”是仪表盘的一部分，不需要也不支持单独启动审核服务。运行一次仪表盘即可同时使用发布前审核和发布后数据复盘：

```sh
npm run dashboard
```

浏览器页面与审核接口同源：

```text
浏览器仪表盘 ──> /api/content-checker/* ──> MySQL（账户、额度、记录、实操库）
       │
       └──> 本地 JSON / 导出文件（发布后数据复盘）
```

接口不会监听额外端口，也不需要 `CONTENT_CHECKER_API_BASE` 或 CORS 配置。

## 功能

- 发布前检测：标题、正文、最多 18 张 JPG/PNG/WEBP 图片、风险分、规则证据、模型图片框选。
- 检测记录：登录用户从 MySQL 读取完整记录；未登录用户可完成检测但不持久化。
- 知识库：内置正向发布实践内容。
- 实操库与会员中心：需要登录和 MySQL。
- 管理实操库：仅 `ADMIN_EMAILS` 中的账户可见。

## 配置

从根目录 `.env.example` 创建 `.env`。若需要登录、检测记录、会员和实操库，设置：

```dotenv
DATABASE_URL=mysql://note_guard:password@127.0.0.1:3306/note_guard
ADMIN_EMAILS=admin@example.com
```

首次使用空 MySQL 数据库时，执行 [content-checker-schema.sql](../db/content-checker-schema.sql)。已有审核库请直接复用原有 `DATABASE_URL`，不要重复初始化 schema。

`DASHSCOPE_API_KEY` 未配置时，仍会运行确定性规则检测；配置后会追加图片和语境复核。登录用户上传的原图默认存至 `data/content-checker-uploads/`，该目录不由静态站点公开；可用 `UPLOAD_DIR` 改为另一个受限路径。

审核结果是发布前风险提示，不代表任何平台的官方审核结论。
