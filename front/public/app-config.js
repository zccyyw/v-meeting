/* 运行时配置注入点（占位实现）。
 * - Docker 部署：web 容器启动时 entrypoint 按 .env 重写本文件（安装前改 .env、启动后生效）。
 * - 主机部署（rpm/deb/native）：网关动态输出 /app-config.js（读 conf/.env），优先于本占位文件。
 * - dev：无注入，使用构建期 .env 值，本占位为 no-op。
 * 本文件在 <head> 中同步加载，必须在首帧前完成标题等修改。 */
(function () {
  var c = window.__APP_CONFIG__ || {};
  if (c.appName) {
    document.title = c.appName;
    var m = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (m) m.setAttribute("content", c.appName);
  }
})();
