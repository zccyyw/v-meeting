#!/usr/bin/env node
/**
 * Generate TLS certificate using node-forge (pure JS, no OpenSSL).
 *
 * 模式一（默认）: 自签证书 — 内网测试用
 * 模式二（--ca）: 根 CA 签发 — 信创环境推荐
 *
 * Usage:
 *   # 自签
 *   node gen-cert.mjs <ip-or-domain> [output-dir]
 *
 *   # CA 签发（信创环境）
 *   node gen-cert.mjs --ca <ip-or-domain> [output-dir]
 *
 * Outputs (CA 模式额外输出 ca.crt + ca.key):
 *   <output-dir>/fullchain.pem   — 证书链（服务器证书 + CA 证书）
 *   <output-dir>/privkey.pem      — 服务器私钥
 *   <output-dir>/ca.crt           — 根 CA 证书（导入浏览器信任库）
 *   <output-dir>/ca.key           — 根 CA 私钥（保管）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import forge from "node-forge";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse --ca flag
let useCa = false;
const args = process.argv.slice(2).filter((a) => {
  if (a === "--ca") { useCa = true; return false; }
  return true;
});

const host = args[0];
if (!host) {
  console.error("Usage: node gen-cert.mjs [--ca] <ip-or-domain> [output-dir]");
  process.exit(1);
}

const outDir = args[1] ? path.resolve(args[1]) : path.resolve(__dirname, "../certs");
fs.mkdirSync(outDir, { recursive: true });

const isIP = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

function buildAltNames(h) {
  const names = [];
  if (isIP) {
    names.push({ type: 7, ip: h });
    names.push({ type: 7, ip: "127.0.0.1" });
  } else {
    names.push({ type: 2, value: h });
    names.push({ type: 2, value: "localhost" });
    names.push({ type: 7, ip: "127.0.0.1" });
  }
  return names;
}

const altNames = buildAltNames(host);

function randomSerial() {
  return "01" + forge.util.bytesToHex(forge.random.getBytesSync(8));
}

// ========== CA 签发模式 ==========
if (useCa) {
  console.log("=== CA 签发模式（信创环境推荐）===");

  // 1. 根 CA
  let caCert, caKey;
  const caCertPath = path.join(outDir, "ca.crt");
  const caKeyPath = path.join(outDir, "ca.key");

  if (fs.existsSync(caCertPath) && fs.existsSync(caKeyPath)) {
    console.log("[1/5] 复用已有根 CA...");
    caCert = forge.pki.certificateFromPem(fs.readFileSync(caCertPath, "utf8"));
    caKey = forge.pki.privateKeyFromPem(fs.readFileSync(caKeyPath, "utf8"));
  } else {
    console.log("[1/5] 生成根 CA 私钥 (RSA 4096)...");
    caKey = forge.pki.rsa.generateKeyPair(4096);
    caCert = forge.pki.createCertificate();
    caCert.publicKey = caKey.publicKey;
    caCert.serialNumber = randomSerial();
    const caNotBefore = new Date();
    caNotBefore.setDate(caNotBefore.getDate() - 1);
    const caNotAfter = new Date();
    caNotAfter.setFullYear(caNotAfter.getFullYear() + 10);
    caCert.validity.notBefore = caNotBefore;
    caCert.validity.notAfter = caNotAfter;

    const caAttrs = [
      { name: "commonName", value: "Meeting-Root-CA" },
      { name: "organizationName", value: "Meeting-CA" },
      { name: "countryName", value: "CN" },
    ];
    caCert.setSubject(caAttrs);
    caCert.setIssuer(caAttrs);
    caCert.setExtensions([
      { name: "basicConstraints", cA: true, critical: true },
      { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    ]);
    caCert.sign(caKey.privateKey, forge.md.sha256.create());

    fs.writeFileSync(caCertPath, forge.pki.certificateToPem(caCert), { mode: 0o644 });
    fs.writeFileSync(caKeyPath, forge.pki.privateKeyToPem(caKey.privateKey), { mode: 0o600 });
  }

  // 2. 服务器密钥
  console.log("[2/5] 生成服务器私钥 (RSA 2048)...");
  const serverKeys = forge.pki.rsa.generateKeyPair(2048);

  // 3. 服务器证书
  console.log("[3/5] 生成服务器证书...");
  const serverCert = forge.pki.createCertificate();
  serverCert.publicKey = serverKeys.publicKey;
  serverCert.serialNumber = randomSerial();

  const srvNotBefore = new Date();
  srvNotBefore.setDate(srvNotBefore.getDate() - 1);
  const srvNotAfter = new Date();
  srvNotAfter.setDate(srvNotAfter.getDate() + 825);
  serverCert.validity.notBefore = srvNotBefore;
  serverCert.validity.notAfter = srvNotAfter;

  const srvAttrs = [
    { name: "commonName", value: host },
    { name: "organizationName", value: "Meeting" },
    { name: "countryName", value: "CN" },
  ];
  serverCert.setSubject(srvAttrs);
  serverCert.setIssuer(caCert.subject.attributes);

  serverCert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
    { name: "extKeyUsage", serverAuth: true },
    { name: "subjectAltName", altNames },
  ]);

  // 4. CA 签发
  console.log("[4/5] 根 CA 签发服务器证书...");
  serverCert.sign(caKey.privateKey ?? caKey, forge.md.sha256.create());

  // 5. 合并证书链
  console.log("[5/5] 生成 fullchain.pem...");
  const serverPem = forge.pki.certificateToPem(serverCert);
  const caPem = forge.pki.certificateToPem(caCert);
  const fullchain = serverPem + caPem;

  const fullchainPath = path.join(outDir, "fullchain.pem");
  const privkeyPath = path.join(outDir, "privkey.pem");

  fs.writeFileSync(fullchainPath, fullchain, { mode: 0o644 });
  fs.writeFileSync(privkeyPath, forge.pki.privateKeyToPem(serverKeys.privateKey), { mode: 0o600 });

  console.log("");
  console.log("=== 完成 ===");
  console.log(`  ca.crt         → ${path.join(outDir, "ca.crt")} (导入浏览器信任库)`);
  console.log(`  fullchain.pem  → ${fullchainPath}`);
  console.log(`  privkey.pem    → ${privkeyPath}`);
  console.log(`  Subject: CN=${host}`);
  console.log(`  SAN: ${isIP ? "IP" : "DNS"}:${host}, IP:127.0.0.1`);
  console.log(`  Issuer: Meeting-Root-CA`);
  process.exit(0);
}

// ========== 自签模式 ==========
console.log("Generating RSA 2048 key pair (self-signed)...");
const keys = forge.pki.rsa.generateKeyPair(2048);

const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = randomSerial();

const notBefore = new Date();
notBefore.setDate(notBefore.getDate() - 1);
const notAfter = new Date();
notAfter.setDate(notAfter.getDate() + 825);
cert.validity.notBefore = notBefore;
cert.validity.notAfter = notAfter;

const attrs = [
  { name: "commonName", value: host },
  { name: "organizationName", value: "Meeting" },
  { name: "countryName", value: "CN" },
];
cert.setSubject(attrs);
cert.setIssuer(attrs);

cert.setExtensions([
  { name: "basicConstraints", cA: false },
  {
    name: "keyUsage",
    keyCertSign: true,
    digitalSignature: true,
    nonRepudiation: true,
    keyEncipherment: true,
    dataEncipherment: true,
  },
  { name: "extKeyUsage", serverAuth: true },
  { name: "subjectAltName", altNames },
]);

cert.sign(keys.privateKey);

const certPem = forge.pki.certificateToPem(cert);
const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

const certPath = path.join(outDir, "fullchain.pem");
const keyPath = path.join(outDir, "privkey.pem");

fs.writeFileSync(certPath, certPem, { mode: 0o644 });
fs.writeFileSync(keyPath, keyPem, { mode: 0o600 });

console.log(`OK: ${certPath}`);
console.log(`OK: ${keyPath}`);
console.log(`Subject: CN=${host}`);
console.log(`SAN: ${isIP ? "IP" : "DNS"}:${host}, IP:127.0.0.1`);
console.log(`Validity: ${notBefore.toISOString().slice(0, 10)} ~ ${notAfter.toISOString().slice(0, 10)}`);
console.log("");
console.log("提示: 信创环境请用 --ca 模式: node gen-cert.mjs --ca " + host);
