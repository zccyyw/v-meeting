/**
 * 举手手型图标。AntD 图标库无手型（仅 Like 拇指），且信创浏览器对
 * emoji 字形（✋）渲染不一致，故用内联 SVG（Material front_hand 轮廓），
 * 尺寸随 font-size（1em），颜色随 currentColor，与 antd 图标行为一致。
 */
export function HandIcon({
  style,
  className,
}: {
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="currentColor"
      style={style}
      className={className}
      aria-hidden
      focusable="false"
    >
      <path d="M19.75 8c-.69 0-1.25.56-1.25 1.25V15h-1V3.25c0-.69-.56-1.25-1.25-1.25S15 2.56 15 3.25V14h-1V1.25c0-.69-.56-1.25-1.25-1.25S11.5.56 11.5 1.25V14h-1V3.25c0-.69-.56-1.25-1.25-1.25S7 2.56 7 3.25V14H6V5.75C6 5.06 5.44 4.5 4.75 4.5S3.5 5.06 3.5 5.75v10c0 4.56 3.69 8.25 8.25 8.25S20 20.31 20 15.75V9.25C20 8.56 19.44 8 19.75 8z" />
    </svg>
  );
}
