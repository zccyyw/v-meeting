import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  AlignRightOutlined,
  BoldOutlined,
  ClearOutlined,
  CodeOutlined,
  ItalicOutlined,
  LinkOutlined,
  OrderedListOutlined,
  RedoOutlined,
  StrikethroughOutlined,
  UnderlineOutlined,
  UndoOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { Button, ColorPicker, Divider, Input, Popover, Select, Space, Tooltip } from "antd";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import { BackgroundColor, Color, TextStyle } from "@tiptap/extension-text-style";

const COLOR_PRESETS = [
  {
    colors: [
      "#f5222d", "#fa541c", "#fa8c16", "#fadb14", "#52c41a", "#13c2c2",
      "#1677ff", "#2f54eb", "#722ed1", "#000000", "#595959", "#8c8c8c",
    ],
  },
];

type RichTextEditorProps = {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
};

function ToolBtn(props: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip title={props.label}>
      <Button
        type="text"
        size="small"
        icon={props.icon}
        disabled={props.disabled}
        className={props.active ? "is-active" : undefined}
        onClick={props.onClick}
      />
    </Tooltip>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      blockquote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      heading: e.isActive("heading") ? (e.getAttributes("heading").level as 1 | 2 | 3) : 0,
      align: (["center", "right"] as const).find((a) => e.isActive({ textAlign: a })) ?? "left",
      linkHref: (e.getAttributes("link").href as string | undefined) ?? "",
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const chain = () => editor.chain().focus();

  return (
    <div className="rich-editor-toolbar">
      <ToolBtn label={t("richEditor.undo")} icon={<UndoOutlined />} disabled={!s.canUndo} onClick={() => chain().undo().run()} />
      <ToolBtn label={t("richEditor.redo")} icon={<RedoOutlined />} disabled={!s.canRedo} onClick={() => chain().redo().run()} />
      <Divider type="vertical" style={{ margin: "0 2px" }} />
      <Select
        size="small"
        style={{ width: 92 }}
        value={s.heading}
        onChange={(lvl) =>
          lvl ? chain().toggleHeading({ level: lvl as 1 | 2 | 3 }).run() : chain().setParagraph().run()
        }
        options={[
          { value: 0, label: t("richEditor.body") },
          { value: 1, label: "H1" },
          { value: 2, label: "H2" },
          { value: 3, label: "H3" },
        ]}
      />
      <Divider type="vertical" style={{ margin: "0 2px" }} />
      <ToolBtn label={t("richEditor.bold")} icon={<BoldOutlined />} active={s.bold} onClick={() => chain().toggleBold().run()} />
      <ToolBtn label={t("richEditor.italic")} icon={<ItalicOutlined />} active={s.italic} onClick={() => chain().toggleItalic().run()} />
      <ToolBtn label={t("richEditor.underline")} icon={<UnderlineOutlined />} active={s.underline} onClick={() => chain().toggleUnderline().run()} />
      <ToolBtn label={t("richEditor.strike")} icon={<StrikethroughOutlined />} active={s.strike} onClick={() => chain().toggleStrike().run()} />
      <Tooltip title={t("richEditor.textColor")}>
        <ColorPicker
          size="small"
          defaultValue="#000000"
          presets={COLOR_PRESETS}
          onChange={(c) => chain().setColor(c.toHexString()).run()}
        />
      </Tooltip>
      <Tooltip title={t("richEditor.bgColor")}>
        <ColorPicker
          size="small"
          defaultValue="#ffffff"
          presets={COLOR_PRESETS}
          onChange={(c) => chain().setBackgroundColor(c.toHexString()).run()}
        />
      </Tooltip>
      <Divider type="vertical" style={{ margin: "0 2px" }} />
      <ToolBtn label={t("richEditor.orderedList")} icon={<OrderedListOutlined />} active={s.orderedList} onClick={() => chain().toggleOrderedList().run()} />
      <ToolBtn label={t("richEditor.bulletList")} icon={<UnorderedListOutlined />} active={s.bulletList} onClick={() => chain().toggleBulletList().run()} />
      <ToolBtn label={t("richEditor.alignLeft")} icon={<AlignLeftOutlined />} active={s.align === "left"} onClick={() => chain().unsetTextAlign().run()} />
      <ToolBtn label={t("richEditor.alignCenter")} icon={<AlignCenterOutlined />} active={s.align === "center"} onClick={() => chain().setTextAlign("center").run()} />
      <ToolBtn label={t("richEditor.alignRight")} icon={<AlignRightOutlined />} active={s.align === "right"} onClick={() => chain().setTextAlign("right").run()} />
      <Divider type="vertical" style={{ margin: "0 2px" }} />
      <ToolBtn
        label={t("richEditor.blockquote")}
        active={s.blockquote}
        onClick={() => chain().toggleBlockquote().run()}
        icon={<span style={{ fontFamily: "Georgia, serif", fontWeight: 700, lineHeight: 1 }}>❝</span>}
      />
      <ToolBtn label={t("richEditor.codeBlock")} icon={<CodeOutlined />} active={s.codeBlock} onClick={() => chain().toggleCodeBlock().run()} />
      <Popover
        trigger="click"
        open={linkOpen}
        destroyOnHidden
        onOpenChange={(o) => {
          setLinkOpen(o);
          if (o) setLinkUrl(s.linkHref || "https://");
        }}
        content={
          <Space direction="vertical" style={{ width: 264 }}>
            <Input value={linkUrl} placeholder={t("richEditor.linkUrl")} onChange={(e) => setLinkUrl(e.target.value)} />
            <Space style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}>
              {s.linkHref && (
                <Button
                  size="small"
                  danger
                  onClick={() => {
                    chain().extendMarkRange("link").unsetLink().run();
                    setLinkOpen(false);
                  }}
                >
                  {t("richEditor.removeLink")}
                </Button>
              )}
              <Button
                size="small"
                type="primary"
                disabled={!linkUrl.trim()}
                onClick={() => {
                  chain().extendMarkRange("link").setLink({ href: linkUrl.trim() }).run();
                  setLinkOpen(false);
                }}
              >
                {t("common.save")}
              </Button>
            </Space>
          </Space>
        }
      >
        <Tooltip title={t("richEditor.setLink")}>
          <Button type="text" size="small" icon={<LinkOutlined />} className={s.linkHref ? "is-active" : undefined} />
        </Tooltip>
      </Popover>
      <ToolBtn
        label={t("richEditor.clearFormat")}
        icon={<ClearOutlined />}
        onClick={() => chain().unsetAllMarks().clearNodes().unsetColor().unsetBackgroundColor().unsetTextAlign().unsetLink().run()}
      />
    </div>
  );
}

/**
 * 富文本编辑器（antd Form 受控组件），基于 Tiptap 3（ProseMirror）。
 * 工具栏使用 antd Button 搭建，与全局样式和管理端主题天然一致；
 * 存储值为 HTML 字符串，展示侧渲染前须做 XSS 净化。
 */
export const RichTextEditor = memo(function RichTextEditor({
  value,
  onChange,
  placeholder,
  readOnly,
}: RichTextEditorProps) {
  const { t } = useTranslation();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const placeholderRef = useRef(placeholder);
  placeholderRef.current = placeholder;
  const lastHtmlRef = useRef(value ?? "");

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      TextStyle,
      Color,
      BackgroundColor,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: () => placeholderRef.current ?? t("richEditor.placeholder") }),
    ],
    content: value ?? "",
    editable: !readOnly,
    onUpdate({ editor }) {
      const html = editor.isEmpty ? "" : editor.getHTML();
      lastHtmlRef.current = html;
      onChangeRef.current?.(html);
    },
  });

  // 外部 value 变化（form.resetFields / setFieldsValue）时同步进编辑器
  useEffect(() => {
    if (!editor) return;
    const v = value ?? "";
    if (v !== lastHtmlRef.current) {
      lastHtmlRef.current = v;
      editor.commands.setContent(v, { emitUpdate: false });
    }
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  if (!editor) return <div className="rich-editor" />;

  return (
    <div className="rich-editor">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
});
