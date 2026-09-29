import { useCallback, useEffect, useRef, useState } from "react";
import {
  startRecording,
  type RecorderHandle,
  type RecorderSource,
} from "@/media/recorder";

/**
 * 本地录制生命周期 hook（P1-7 拆分第一步，行为与原 MeetingPage 内联实现一致）：
 * 状态（recording/recordElapsed）+ 计时 + start/stop/discard。
 * 上传落盘（RecordingsApi）与信令通知（notifyRecordingStarted/Stopped）仍由
 * MeetingPage 编排——它们依赖 snapshot 与 roomRef，属页面职责。
 */
export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [recordElapsed, setRecordElapsed] = useState(0);
  const recorderHandleRef = useRef<RecorderHandle | null>(null);
  const recordStartRef = useRef<number>(0);

  // 录制时长计时
  useEffect(() => {
    if (!recording) {
      setRecordElapsed(0);
      return;
    }
    const t = window.setInterval(() => {
      setRecordElapsed(Date.now() - recordStartRef.current);
    }, 1000);
    return () => window.clearInterval(t);
  }, [recording]);

  /** 开始录制；返回 false 表示启动失败（错误已打日志，调用方负责提示） */
  const start = useCallback((buildSources: () => RecorderSource[]): boolean => {
    try {
      recorderHandleRef.current = startRecording(buildSources);
      recordStartRef.current = Date.now();
      setRecording(true);
      return true;
    } catch (err) {
      console.error("start recording failed", err);
      return false;
    }
  }, []);

  /**
   * 停止录制：返回 null 表示没有进行中的录制；
   * 否则等待 stop 完成并返回 { blob, durationMs }
   * （durationMs 在 stop 之前采样、recording 状态先行置 false，均与原实现一致）。
   */
  const stop = useCallback(
    async (): Promise<{ blob: Blob; durationMs: number } | null> => {
      const handle = recorderHandleRef.current;
      if (!handle) return null;
      setRecording(false);
      const durationMs = handle.durationMs();
      const blob = await handle.stop();
      recorderHandleRef.current = null;
      return { blob, durationMs };
    },
    []
  );

  /** 页面卸载兜底：直接丢弃进行中的录制（与原卸载清理一致） */
  const discard = useCallback(() => {
    if (recorderHandleRef.current) {
      try {
        void recorderHandleRef.current.stop();
      } catch {
        /* ignore */
      }
      recorderHandleRef.current = null;
      setRecording(false);
    }
  }, []);

  return { recording, recordElapsed, start, stop, discard };
}