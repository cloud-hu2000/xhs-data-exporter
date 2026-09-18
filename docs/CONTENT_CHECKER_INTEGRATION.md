# 发布前检测 API 与本地数据复盘

数据分析仪表盘必须在本机运行：它读取本地下载文件、JSON 数据和浏览器登录态。不要将仪表盘、下载目录或本地数据发布到服务器。

发布前检测使用独立的服务器 API。服务器只提供健康检查和以 /api/content-checker/ 开头的接口，处理审核、账户、额度、历史记录、实操库和模型调用；它不提供仪表盘页面或数据分析接口。

本机仪表盘固定连接 `http://101.37.116.48:5178/api/content-checker`，无需创建或配置 `.env`。包括封面分析、内容策略、相似内容匹配、下一篇内容生成及发布前检测在内的所有 AI 请求都由该后端执行；百炼 Key 绝不会从本机读取。

然后照常运行 npm run dashboard。发布前检测页面会向这个 API 发请求，而数据分析仍从本机仪表盘读取。

服务器运行 npm run content-checker:api，固定监听 `127.0.0.1:5179`；Nginx 将 API 代理到对外的 5178 端口。跨域固定允许 `http://localhost:5178` 和 `http://127.0.0.1:5178`。

需要账户、检测记录、会员或实操库时，**仅 API 服务器环境**配置 DATABASE_URL 和 ADMIN_EMAILS：将 .env.content-checker-api.example 复制为 .env.content-checker-api，并填入真实值。首次使用空数据库时可执行 db/content-checker-schema.sql；已有审核库应直接复用原有 DATABASE_URL。仪表盘不读取、不保存、也不连接数据库；所有数据库读写只经受鉴权、输入校验与参数化查询保护的 /api/content-checker/ API 端点完成。

DASHSCOPE_API_KEY 未配置时，服务仍执行确定性规则检测；配置后会增加图片和语境复核。登录用户的原图放在服务器的私有上传目录，不由 Nginx 静态公开。

审核结果是发布前风险提示，不代表任何平台的官方审核结论。
