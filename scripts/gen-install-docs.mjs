/**
 * Generate install Word documents from Markdown source.
 * Usage: node scripts/gen-install-docs.mjs
 *
 * Requires global docx package: npm install -g docx
 * Source: docs/install/src/*.md  →  Output: docs/install/*.docx
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire("D:/dev.env/nvm/node_global/");
const docx = require("docx");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, BorderStyle,
} = docx;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "docs", "install", "src");
const outDir = join(root, "docs", "install");

function cell(text) {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text: text.trim(), size: 21 })] })],
  });
}

function parseMd(md) {
  const lines = md.split("\n");
  const paras = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    // Code block
    if (line.startsWith("```")) {
      const cl = []; i++;
      while (i < lines.length && !lines[i].startsWith("```")) { cl.push(lines[i]); i++; }
      i++;
      paras.push(new Paragraph({
        children: [new TextRun({ text: cl.join("\n"), font: "Consolas", size: 19 })],
        spacing: { before: 80, after: 80 },
        shading: { fill: "F4F4F4" },
      }));
      continue;
    }
    // Headings
    if (line.startsWith("# ")) {
      // 标题 1：主标题与副标题均居中（格式要求）
      paras.push(new Paragraph({ text: line.slice(2).trim(), heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { before: 240, after: 120 } }));
      i++; continue;
    }
    if (line.startsWith("## ")) {
      paras.push(new Paragraph({ text: line.slice(3).trim(), heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
      i++; continue;
    }
    if (line.startsWith("### ")) {
      paras.push(new Paragraph({ text: line.slice(4).trim(), heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 80 } }));
      i++; continue;
    }
    if (line.startsWith("#### ")) {
      paras.push(new Paragraph({ text: line.slice(5).trim(), heading: HeadingLevel.HEADING_4, spacing: { before: 120, after: 60 } }));
      i++; continue;
    }
    // Table
    if (line.startsWith("|")) {
      const tr = [];
      while (i < lines.length && lines[i].startsWith("|")) { tr.push(lines[i].split("|").filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)); i++; }
      const data = tr.filter(r => !r.every(c => /^[-: ]*$/.test(c.trim())));
      if (data.length > 0) {
        const header = data[0];
        const rows = [
          new TableRow({ tableHeader: true, children: header.map(c => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c.trim(), bold: true, size: 21 })] })] })) }),
          ...data.slice(1).map(r => new TableRow({ children: r.map(c => cell(c)) })),
        ];
        paras.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
      }
      continue;
    }
    // Bullet
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const text = line.slice(2).replace(/\*\*(.+?)\*\*/g, "$1");
      paras.push(new Paragraph({
        children: [new TextRun({ text: "• " + text, size: 22 })],
        spacing: { before: 40, after: 40 },
      }));
      i++; continue;
    }
    // Normal paragraph
    const text = line.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`(.+?)`/g, "$1");
    paras.push(new Paragraph({
      children: [new TextRun({ text, size: 22 })],
      spacing: { before: 40, after: 40 },
    }));
    i++;
  }
  return paras;
}

if (!existsSync(srcDir)) {
  console.error("Source directory not found:", srcDir);
  process.exit(1);
}

const files = readdirSync(srcDir).filter(f => f.endsWith(".md"));
for (const file of files) {
  const md = readFileSync(join(srcDir, file), "utf8");
  const elements = parseMd(md);
  const doc = new Document({
    sections: [{ properties: {}, children: elements }],
    styles: {
      default: {
        document: { run: { font: "Microsoft YaHei", size: 22 } },
      },
    },
  });
  const outName = basename(file, ".md") + ".docx";
  const outPath = join(outDir, outName);
  const buffer = await Packer.toBuffer(doc);
  writeFileSync(outPath, buffer);
  console.log(`Generated: ${outPath}`);
}
