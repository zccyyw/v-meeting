import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

/**
 * 全局错误边界：捕获渲染期异常与懒加载 chunk 加载失败（内网/离线包场景
 * chunk 网络失败即 reject，会冒泡到这里），避免整应用白屏无恢复入口。
 * 兜底 UI 提供「刷新页面」与错误详情折叠，刷新失败时用户至少知道发生了什么。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 控制台保留完整堆栈供定位；不上报外部服务（内网部署）
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 24,
          fontFamily: "system-ui, sans-serif",
          color: "#e6e6e6",
          background: "#141414",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: 20, margin: 0 }}>页面出错了</h1>
        <p style={{ margin: 0, opacity: 0.75, maxWidth: 480 }}>
          应用遇到意外错误，已停止渲染以避免进一步异常。请尝试刷新页面；
          若反复出现，请联系管理员并附上下方错误详情。
        </p>
        <button
          type="button"
          onClick={this.handleReload}
          style={{
            padding: "8px 20px",
            fontSize: 14,
            cursor: "pointer",
            borderRadius: 6,
            border: "1px solid #434343",
            background: "#1f1f1f",
            color: "#e6e6e6",
          }}
        >
          刷新页面
        </button>
        <details style={{ maxWidth: 640, textAlign: "left", opacity: 0.6 }}>
          <summary style={{ cursor: "pointer", fontSize: 13 }}>错误详情</summary>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              fontSize: 12,
              background: "#000",
              padding: 12,
              borderRadius: 6,
              maxHeight: 240,
              overflow: "auto",
            }}
          >
            {error.message}
            {"\n"}
            {error.stack}
          </pre>
        </details>
      </div>
    );
  }
}
