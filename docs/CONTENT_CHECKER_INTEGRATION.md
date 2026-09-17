# 发布前检测 API 与本地数据复盘

数据分析仪表盘必须在本机运行：它读取本地下载文件、JSON 数据和浏览器登录态。不要将仪表盘、下载目录或本地数据发布到服务器。

发布前检测使用独立的服务器 API。服务器只提供健康检查和以 /api/content-checker/ 开头的接口，处理审核、账户、额度、历史记录、实操库和模型调用；它不提供仪表盘页面或数据分析接口。

本机启动仪表盘前，在根目录 .env 设置：

    XHS_CONTENT_CHECKER_API_BASE=https://api.example.com/api/content-checker

然后照常运行 npm run dashboard。发布前检测页面会向这个 API 发请求，而数据分析仍从本机仪表盘读取。

服务器运行 npm run content-checker:api。默认仅监听回环地址；Nginx 将 API 代理到公开 HTTPS 端口。CONTENT_CHECKER_ALLOWED_ORIGINS 默认允许 http://localhost:5178 和 http://127.0.0.1:5178，其他本地地址或端口需显式加入该变量。

需要账户、检测记录、会员或实操库时，**仅 API 服务器环境**配置 DATABASE_URL 和 ADMIN_EMAILS：将 .env.content-checker-api.example 复制为 .env.content-checker-api，并填入真实值（也可用 CONTENT_CHECKER_API_ENV_FILE 指定其他私有文件）。首次使用空数据库时可执行 db/content-checker-schema.sql；已有审核库应直接复用原有 DATABASE_URL。仪表盘不读取、不保存、也不连接数据库；所有数据库读写只经受鉴权、输入校验与参数化查询保护的 /api/content-checker/ API 端点完成。

DASHSCOPE_API_KEY 未配置时，服务仍执行确定性规则检测；配置后会增加图片和语境复核。登录用户的原图放在服务器的私有上传目录，不由 Nginx 静态公开。

审核结果是发布前风险提示，不代表任何平台的官方审核结论。
