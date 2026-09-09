import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

/**
 * CA 根证书下载（供信创浏览器导入信任库）。
 *
 * 仅提供固定文件名 ca.crt（仅含公钥，可公开），不拼接用户输入的路径，
 * 杜绝路径穿越；私钥 ca.key 永不通过 HTTP 提供。
 *
 * 证书目录：环境变量 CERT_DIR，默认 /opt/meeting/certs
 * （Docker 部署由 compose 挂载 ./deploy/docker/certs:/certs 并设 CERT_DIR=/certs）。
 */
const CERT_DIR = process.env.CERT_DIR || "/opt/meeting/certs";

export async function caCertRoutes(app: FastifyInstance) {
  app.get("/api/certs/ca.crt", async (req, reply) => {
    const filePath = join(CERT_DIR, "ca.crt");
    if (!existsSync(filePath)) {
      return reply
        .code(404)
        .send({ error: "ca_cert_not_found" });
    }
    const data = readFileSync(filePath);
    return reply
      .header("Content-Type", "application/x-x509-ca-cert")
      .header("Content-Disposition", 'attachment; filename="ca.crt"')
      .header("Cache-Control", "no-store")
      .send(data);
  });
}
