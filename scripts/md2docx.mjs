#!/usr/bin/env node
// 将 Markdown（本项目部署说明子集：标题/段落/代码块/表格/引用）转为 .docx。
// 用法：node scripts/md2docx.mjs <in.md> <out.docx>
import { readFileSync, writeFileSync } from "node:fs";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  BorderStyle,
  WidthType,
  ShadingType,
  AlignmentType,
} from "docx";

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) {
  console.error("usage: node md2docx.mjs <in.md> <out.docx>");
  process.exit(1);
}

const md = readFileSync(input, "utf8");
const lines = md.split("\n");

const FONT = "Arial";
const MONO = "Consolas";

function parseInline(text) {
  const runs = [];
  const regex = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let last = 0;
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) runs.push(new TextRun({ text: text.slice(last, m.index), font: FONT }));
    if (m[2] !== undefined) runs.push(new TextRun({ text: m[2], bold: true, font: FONT }));
    else if (m[3] !== undefined) runs.push(new TextRun({ text: m[3], font: MONO }));
    last = regex.lastIndex;
  }
  if (last < text.length) runs.push(new TextRun({ text: text.slice(last), font: FONT }));
  if (runs.length === 0) runs.push(new TextRun({ text, font: FONT }));
  return runs;
}

function heading(text, level) {
  const sizes = { 1: 32, 2: 28, 3: 24 };
  return new Paragraph({
    heading: level,
    spacing: { before: level === 1 ? 240 : 180, after: 120 },
    children: [new TextRun({ text, bold: true, size: sizes[level], font: FONT })],
  });
}

function codeParagraph(block) {
  const inner = block.split("\n").map((l, idx, arr) =>
    new TextRun({ text: l || " ", font: MONO, size: 18, break: idx < arr.length - 1 }),
  );
  return new Paragraph({
    children: inner,
    shading: { fill: "F2F4F7", type: ShadingType.CLEAR, color: "auto" },
    spacing: { before: 80, after: 80 },
    indent: { left: 200, right: 200 },
    border: {
      left: { style: BorderStyle.SINGLE, size: 6, color: "C8CDD4", space: 4 },
    },
  });
}

function quote(text) {
  return new Paragraph({
    children: parseInline(text),
    spacing: { before: 80, after: 80 },
    indent: { left: 200 },
    border: {
      left: { style: BorderStyle.SINGLE, size: 12, color: "2E75B6", space: 6 },
    },
  });
}

function splitRow(r) {
  return r.replace(/^\|/, "").replace(/\|$/, "").split("|").map((s) => s.trim());
}

function isSep(r) {
  return r.replace(/\|/g, "").replace(/[-:\s]/g, "") === "";
}

function buildTable(rows) {
  const dataRows = rows.filter((r) => !isSep(r));
  if (dataRows.length === 0) return null;
  const ncol = splitRow(dataRows[0]).length;
  const total = 9026; // A4 内容宽度（DXA，1 英寸边距）
  const colW = Math.floor(total / ncol);
  const columnWidths = Array(ncol).fill(colW);
  const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
  const borders = { top: border, bottom: border, left: border, right: border };

  const toRow = (cells, header) =>
    new TableRow({
      tableHeader: header,
      children: cells.map(
        (c) =>
          new TableCell({
            borders,
            width: { size: colW, type: WidthType.DXA },
            shading: header ? { fill: "D5E8F0", type: ShadingType.CLEAR } : undefined,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: c, bold: header, font: FONT, size: 20 }),
                ],
              }),
            ],
          }),
      ),
    });

  const tableRows = dataRows.map((r, i) => toRow(splitRow(r), i === 0));
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths,
    rows: tableRows,
  });
}

const children = [];
let i = 0;
let firstTitle = true;
while (i < lines.length) {
  const line = lines[i];
  if (line.startsWith("# ")) {
    children.push(heading(line.slice(2), HeadingLevel.HEADING_1));
    i++;
  } else if (line.startsWith("## ")) {
    children.push(heading(line.slice(3), HeadingLevel.HEADING_2));
    i++;
  } else if (line.startsWith("### ")) {
    children.push(heading(line.slice(4), HeadingLevel.HEADING_3));
    i++;
  } else if (line.startsWith("```")) {
    i++;
    const code = [];
    while (i < lines.length && !lines[i].startsWith("```")) {
      code.push(lines[i]);
      i++;
    }
    i++; // 跳过收尾 ```
    children.push(codeParagraph(code.join("\n")));
  } else if (line.startsWith("|")) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith("|")) {
      rows.push(lines[i]);
      i++;
    }
    const t = buildTable(rows);
    if (t) children.push(t);
  } else if (line.startsWith("> ")) {
    children.push(quote(line.slice(2)));
    i++;
  } else if (line.trim() === "") {
    i++;
  } else {
    children.push(
      new Paragraph({ spacing: { after: 80 }, children: parseInline(line) }),
    );
    i++;
  }
}

const doc = new Document({
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  writeFileSync(output, buf);
  console.log(`✓ ${output}`);
});
