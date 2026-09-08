/**
 * Generate install Word documents from Markdown source.
 * Usage: node scripts/gen-install-docs.mjs
 *
 * Requires global docx package: npm install -g docx
 * Source: docs/install/src/*.md  →  Output: docs/install/*.docx
 *
 * Style contract:
 *   - 首个 `# ` 行   → 文档主标题（Title 样式，居中，非 Heading 1）
 *   - 第二个 `# ` 行 → 副标题（居中加粗，非 Heading）
 *   - `## ` 章节行   → Heading 1（一、二、…）
 *   - `### ` 小节行  → Heading 2
 *   - `#### ` 小节行 → Heading 3
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire("D:/dev.env/nvm/node_global/");
const docx = require("docx");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, BorderStyle, ShadingType,
  LevelFormat, VerticalAlign,
} = docx;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "docs", "install", "src");
const outDir = join(root, "docs", "install");

// ─── 统一字号（half-points）与配色 ───
const S = {
  title: 40,      // 20pt 主标题
  subtitle: 28,   // 14pt 副标题
  h1: 30,         // 15pt 章节
  h2: 25,         // 12.5pt 小节
  h3: 22,         // 11pt 子小节
  body: 21,       // 10.5pt 正文
  code: 18,       // 9pt 代码
  table: 20,      // 10pt 表格
};
const ACCENT = "1F4E79";   // 深蓝：标题与表头
const CODE_BG = "F5F6F8";  // 代码块底纹
const HEAD_BG = "DEEAF6";  // 表头底纹
const BORDER = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
const CELL_BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
const CELL_MARGINS = { top: 60, bottom: 60, left: 120, right: 120 };
// A4 内容宽（1 英寸边距）：11906 - 2880 = 9026 DXA
const CONTENT_W = 9026;

function thCell(text, cols) {
  return new TableCell({
    borders: CELL_BORDERS,
    margins: CELL_MARGINS,
    verticalAlign: VerticalAlign.CENTER,
    columnSpan: cols,
    width: { size: Math.round(CONTENT_W / cols), type: WidthType.DXA },
    shading: { fill: HEAD_BG, type: ShadingType.CLEAR },
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: text.trim(), bold: true, size: S.table, color: ACCENT })],
    })],
  });
}

function tdCell(text, cols) {
  return new TableCell({
    borders: CELL_BORDERS,
    margins: CELL_MARGINS,
    verticalAlign: VerticalAlign.CENTER,
    columnSpan: cols,
    width: { size: Math.round(CONTENT_W / cols), type: WidthType.DXA },
    children: [new Paragraph({
      children: [new TextRun({ text: text.trim(), size: S.table })],
    })],
  });
}

function parseMd(md) {
  const lines = md.split("\n");
  const paras = [];
  let i = 0;
  let h1Count = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    // 代码块
    if (line.startsWith("```")) {
      const cl = []; i++;
      while (i < lines.length && !lines[i].startsWith("```")) { cl.push(lines[i]); i++; }
      i++;
      paras.push(new Paragraph({
        children: [new TextRun({ text: cl.join("\n"), font: "Consolas", size: S.code })],
        spacing: { before: 120, after: 160, line: 300 },
        shading: { fill: CODE_BG },
        indent: { left: 240, right: 240 },
        border: {
          top: { style: BorderStyle.SINGLE, size: 2, color: "D9D9D9" },
          bottom: { style: BorderStyle.SINGLE, size: 2, color: "D9D9D9" },
          left: { style: BorderStyle.SINGLE, size: 2, color: "D9D9D9" },
          right: { style: BorderStyle.SINGLE, size: 2, color: "D9D9D9" },
        },
      }));
      continue;
    }
    // 主标题（首个 `# `）→ Title 样式，居中，非 Heading 1
    if (line.startsWith("# ")) {
      h1Count++;
      if (h1Count === 1) {
        paras.push(new Paragraph({
          text: line.slice(2).trim(),
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: 80 },
          children: [new TextRun({ text: line.slice(2).trim(), bold: true, size: S.title, color: ACCENT })],
        }));
      } else {
        // 副标题：居中加粗，与主标题同属标题区
        paras.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 120 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT, space: 4 } },
          children: [new TextRun({ text: line.slice(2).trim(), bold: true, size: S.subtitle, color: "404040" })],
        }));
      }
      i++; continue;
    }
    // 章节标题 → Heading 1
    if (line.startsWith("## ")) {
      paras.push(new Paragraph({ text: line.slice(3).trim(), heading: HeadingLevel.HEADING_1 }));
      i++; continue;
    }
    // 小节标题 → Heading 2
    if (line.startsWith("### ")) {
      paras.push(new Paragraph({ text: line.slice(4).trim(), heading: HeadingLevel.HEADING_2 }));
      i++; continue;
    }
    if (line.startsWith("#### ")) {
      paras.push(new Paragraph({ text: line.slice(5).trim(), heading: HeadingLevel.HEADING_3 }));
      i++; continue;
    }
    // 表格
    if (line.startsWith("|")) {
      const tr = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        tr.push(lines[i].split("|").filter((_, idx, arr) => idx > 0 && idx < arr.length - 1));
        i++;
      }
      const data = tr.filter(r => !r.every(c => /^[-: ]*$/.test(c.trim())));
      if (data.length > 0) {
        const cols = data[0].length;
        const rows = [
          new TableRow({ tableHeader: true, children: data[0].map(c => thCell(c, cols)) }),
          ...data.slice(1).map(r => new TableRow({ children: r.map(c => tdCell(c, cols)) })),
        ];
        paras.push(new Table({
          rows,
          width: { size: CONTENT_W, type: WidthType.DXA },
          columnWidths: Array(cols).fill(Math.round(CONTENT_W / cols)),
        }));
        paras.push(new Paragraph({ spacing: { before: 0, after: 120 }, children: [] }));
      }
      continue;
    }
    // 列表项
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const text = line.slice(2).replace(/\*\*(.+?)\*\*/g, "$1");
      paras.push(new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({ text, size: S.body })],
        spacing: { before: 40, after: 40 },
      }));
      i++; continue;
    }
    // 普通段落
    const text = line.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`(.+?)`/g, "$1");
    paras.push(new Paragraph({
      children: [new TextRun({ text, size: S.body })],
      spacing: { before: 60, after: 100, line: 320 },
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
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [{
            level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 560, hanging: 280 } } },
          }],
        },
      ],
    },
    sections: [{ properties: {}, children: elements }],
    styles: {
      default: {
        document: { run: { font: "Microsoft YaHei", size: S.body } },
      },
      paragraphStyles: [
        {
          id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: S.h1, bold: true, font: "Microsoft YaHei", color: ACCENT },
          paragraph: {
            spacing: { before: 360, after: 160 },
            outlineLevel: 0,
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT, space: 2 } },
          },
        },
        {
          id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: S.h2, bold: true, font: "Microsoft YaHei", color: "262626" },
          paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 1 },
        },
        {
          id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: S.h3, bold: true, font: "Microsoft YaHei", color: "404040" },
          paragraph: { spacing: { before: 180, after: 80 }, outlineLevel: 2 },
        },
      ],
    },
  });
  const outName = basename(file, ".md") + ".docx";
  const outPath = join(outDir, outName);
  const buffer = await Packer.toBuffer(doc);
  writeFileSync(outPath, buffer);
  console.log(`Generated: ${outPath}`);
}
