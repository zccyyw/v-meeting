import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  App as AntApp,
  Button,
  Card,
  Checkbox,
  Col,
  Form,
  Input,
  Flex,
  Modal,
  Row,
  Typography,
  theme,
} from "antd";
import {
  LoginOutlined,
  VideoCameraOutlined,
  ScheduleOutlined,
  PlayCircleOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { MeetingApi } from "@/api/client";
import {
  getJoinHistory,
  rememberJoin,
  type JoinHistoryEntry,
} from "@/auth/joinHistory";
import {
  formatMeetingCode,
  getJoinPrefs,
  setJoinPrefs,
  takePendingJoinCode,
} from "@/auth/joinPrefs";
import { getDisplayName } from "@/auth/session";
import { ActionTile } from "@/components/ActionTile";
import { apiErrorMessage } from "@/i18n/errorMessage";
import { showMessage } from "@/ui/toast";

const TILE_ICON_SIZE = 28;

type ScheduleItem = {
  id: number;
  code: string;
  title: string;
  status: string;
  scheduledAt: string | null;
  createdAt: string;
  priority: string | null;
};

type ModalKind = "join" | "schedule" | null;

type JoinFormValues = {
  code: string;
  password?: string;
  mic: boolean;
  cam: boolean;
};

type ScheduleFormValues = {
  topic: string;
  waitingRoom: boolean;
  enablePassword: boolean;
  password?: string;
  time: string;
};

export function HomePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const displayName = getDisplayName();
  const { message } = AntApp.useApp();
  const { token } = theme.useToken();

  const [modal, setModal] = useState<ModalKind>(null);
  const [busy, setBusy] = useState(false);

  const [joinForm] = Form.useForm<JoinFormValues>();
  const [schedForm] = Form.useForm<ScheduleFormValues>();
  const [joinNeedsPassword, setJoinNeedsPassword] = useState(false);
  const [joinHistory, setJoinHistory] = useState<JoinHistoryEntry[]>(() =>
    getJoinHistory(),
  );
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [enteringId, setEnteringId] = useState<number | null>(null);

  const localeTag = i18n.language.startsWith("zh") ? "zh-CN" : "en-US";
  const todayLabel = new Date().toLocaleDateString(localeTag, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const loadSchedule = useCallback(async () => {
    setScheduleLoading(true);
    try {
      const res = await MeetingApi.listMine();
      // 后端已按优先级排序（live > 高 > 中 > 低 > 无优先级 > 预约时间升序 > 创建时间倒序）
      // 前端直接使用后端排序结果，无需再排序
      const sorted = res.items;
      setScheduleItems(sorted);
    } catch (err) {
      console.error(err);
    } finally {
      setScheduleLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSchedule();
  }, [loadSchedule]);

  function closeModal() {
    setModal(null);
    setBusy(false);
    setJoinNeedsPassword(false);
    joinForm.resetFields();
    schedForm.resetFields();
  }

  function meetingPath(
    id: number | string,
    token: string,
    extra?: { code?: string; mic?: boolean; cam?: boolean; share?: boolean },
  ) {
    const sp = new URLSearchParams();
    sp.set("token", token);
    if (extra?.code) sp.set("code", extra.code);
    if (extra?.mic != null) sp.set("mic", extra.mic ? "1" : "0");
    if (extra?.cam != null) sp.set("cam", extra.cam ? "1" : "0");
    if (extra?.share) sp.set("share", "1");
    return `/m/${id}?${sp.toString()}`;
  }

  async function completeJoin(
    meeting: { id: number; code: string; title: string },
    opts: { mic: boolean; cam: boolean; password?: string; replace?: boolean },
  ) {
    const { token } = await MeetingApi.joinToken(meeting.id, {
      password: opts.password,
    });
    rememberJoin(meeting.code, meeting.title);
    setJoinHistory(getJoinHistory());
    navigate(
      meetingPath(meeting.id, token, {
        code: meeting.code,
        mic: opts.mic,
        cam: opts.cam,
      }),
      opts.replace ? { replace: true } : undefined,
    );
  }

  async function silentJoin(codeRaw: string) {
    setBusy(true);
    try {
      const code = codeRaw.replace(/\D/g, "");
      if (code.length !== 9) throw new Error("meeting_code_must_be_9_digits");
      const prefs = getJoinPrefs();
      const meeting = await MeetingApi.byCode(code);
      if (meeting.passwordRequired) {
        openJoinModal(meeting.code, true);
        return;
      }
      await completeJoin(meeting, {
        mic: prefs.mic,
        cam: prefs.cam,
        replace: true,
      });
    } catch (err) {
      message.error(apiErrorMessage(t, err));
      setBusy(false);
    }
  }

  useEffect(() => {
    const fromQuery = searchParams.get("join")?.replace(/\D/g, "") ?? "";
    let code = fromQuery.length === 9 ? fromQuery : "";
    if (!code) {
      code = takePendingJoinCode() ?? "";
    } else {
      takePendingJoinCode();
    }
    if (!code) return;

    if (fromQuery.length === 9) {
      const next = new URLSearchParams(searchParams);
      next.delete("join");
      const qs = next.toString();
      navigate(qs ? `/?${qs}` : "/", { replace: true });
    }

    void silentJoin(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot auto-join on mount / join query
  }, []);

  function openJoinModal(prefillCode?: string, needsPassword = false) {
    const prefs = getJoinPrefs();
    joinForm.setFieldsValue({
      code: prefillCode ?? "",
      password: "",
      mic: prefs.mic,
      cam: prefs.cam,
    });
    setJoinNeedsPassword(needsPassword);
    setJoinHistory(getJoinHistory());
    setModal("join");
    setBusy(false);
  }

  async function onInstant() {
    setBusy(true);
    try {
      const title =
        t("home.instant") +
        " · " +
        new Date().toLocaleString(localeTag, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      const res = await MeetingApi.create({ title });
      if (!res.hostJoinToken) throw new Error("meeting_create_failed");
      rememberJoin(res.code, title);
      navigate(meetingPath(res.id, res.hostJoinToken, { code: res.code }));
    } catch (err) {
      message.error(apiErrorMessage(t, err));
      setBusy(false);
    }
  }

  function goToRecordings() {
    navigate("/recordings");
  }

  async function onJoin() {
    setBusy(true);
    try {
      const values = await joinForm.validateFields();
      const code = values.code.replace(/\D/g, "");
      if (code.length !== 9) throw new Error("meeting_code_must_be_9_digits");
      setJoinPrefs({ mic: values.mic, cam: values.cam });
      const meeting = await MeetingApi.byCode(code);
      if (meeting.passwordRequired) {
        setJoinNeedsPassword(true);
        if (!values.password?.trim()) {
          throw new Error("password_required");
        }
      }
      await completeJoin(meeting, {
        mic: values.mic,
        cam: values.cam,
        password: meeting.passwordRequired ? values.password : undefined,
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (raw.includes("password_required")) {
        setJoinNeedsPassword(true);
      }
      if (typeof err === "object" && err !== null && "errorFields" in err) return;
      message.error(apiErrorMessage(t, err));
      setBusy(false);
    }
  }

  async function onSchedule() {
    setBusy(true);
    try {
      const values = await schedForm.validateFields();
      if (!values.time) throw new Error("scheduled_time_required");
      if (values.enablePassword && values.password && values.password.trim().length < 4) {
        throw new Error("join_password_too_short");
      }
      const title = values.topic?.trim() || t("home.schedule");
      const res = await MeetingApi.create({
        title,
        waitingRoomEnabled: values.waitingRoom,
        scheduledAt: new Date(values.time).toISOString(),
        joinPassword: values.enablePassword
          ? values.password?.trim()
          : undefined,
      });
      rememberJoin(res.code, title);
      setJoinHistory(getJoinHistory());
      closeModal();
      showMessage(
        t("home.scheduleSuccess", {
          code: formatMeetingCode(res.code),
        }),
      );
      await loadSchedule();
    } catch (err) {
      if (typeof err === "object" && err !== null && "errorFields" in err) return;
      message.error(apiErrorMessage(t, err));
      setBusy(false);
    }
  }

  async function onEnterScheduled(item: ScheduleItem) {
    setEnteringId(item.id);
    try {
      const prefs = getJoinPrefs();
      await completeJoin(
        { id: item.id, code: item.code, title: item.title },
        { mic: prefs.mic, cam: prefs.cam },
      );
    } catch (err) {
      message.error(apiErrorMessage(t, err));
      setEnteringId(null);
    }
  }

  function formatScheduleTime(iso: string | null): string {
    if (!iso) return t("home.scheduleNoTime");
    try {
      return new Date(iso).toLocaleString(localeTag, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  const tiles = [
    { key: "join", label: t("home.join"), icon: <LoginOutlined style={{ fontSize: TILE_ICON_SIZE }} />, onClick: () => openJoinModal() },
    { key: "instant", label: t("home.instant"), icon: <VideoCameraOutlined style={{ fontSize: TILE_ICON_SIZE }} />, onClick: () => void onInstant() },
    { key: "schedule", label: t("home.schedule"), icon: <ScheduleOutlined style={{ fontSize: TILE_ICON_SIZE }} />, onClick: () => {
      schedForm.resetFields();
      setModal("schedule");
    }},
    { key: "recordings", label: t("home.recordings"), icon: <PlayCircleOutlined style={{ fontSize: TILE_ICON_SIZE }} />, onClick: goToRecordings },
    { key: "groups", label: t("group.title"), icon: <TeamOutlined style={{ fontSize: TILE_ICON_SIZE }} />, onClick: () => navigate("/groups") },
  ];

  return (
    <div style={{ width: "100%", maxWidth: 960, margin: "0 auto", padding: "0 16px" }}>
      <Typography.Title level={2} style={{ marginBottom: 24 }}>
        {t("home.greeting", { name: displayName || "—" })}
      </Typography.Title>

      <Row gutter={[24, 24]}>
        {/* 左侧：操作按钮 */}
        <Col xs={24} md={16}>
          <Row gutter={[16, 16]}>
            {tiles.map((tile) => (
              <Col key={tile.key} xs={12} sm={8} md={6}>
                <ActionTile
                  icon={tile.icon}
                  label={tile.label}
                  onClick={tile.onClick}
                />
              </Col>
            ))}
          </Row>
        </Col>

        {/* 右侧：日程列表 */}
        <Col xs={24} md={8}>
          <Card
            size="small"
            title={todayLabel}
            styles={{ body: { padding: 0 } }}
          >
            {scheduleLoading && scheduleItems.length === 0 ? (
              <div style={{ padding: 16, textAlign: "center" }}>
                <Typography.Text type="secondary">{t("home.scheduleLoading")}</Typography.Text>
              </div>
            ) : scheduleItems.length === 0 ? (
              <div style={{ padding: 16, textAlign: "center" }}>
                <Typography.Text type="secondary">{t("home.emptySchedule")}</Typography.Text>
              </div>
            ) : (
              <Flex vertical gap="small">
                {scheduleItems.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "12px 0 12px 10px",
                      borderBottom: `1px solid ${token.colorBorderSecondary}`,
                      borderLeft: `3px solid ${
                        item.status === "live"
                          ? token.colorError
                          : item.priority === "高"
                            ? token.colorError
                            : item.priority === "中"
                              ? token.colorWarning
                              : item.priority === "低"
                                ? token.colorSuccess
                                : item.scheduledAt
                                  ? token.colorPrimary
                                  : token.colorBorder
                      }`,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Typography.Text strong>{item.title}</Typography.Text>
                      {item.status === "live" && (
                        <Typography.Text
                          style={{
                            marginLeft: 8,
                            color: "#ff4d4f",
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        >
                          ● {t("home.live", "直播中")}
                        </Typography.Text>
                      )}
                      {item.priority && (
                        <Typography.Text
                          style={{
                            marginLeft: 6,
                            fontSize: 11,
                            color:
                              item.priority === "高"
                                ? token.colorError
                                : item.priority === "中"
                                  ? token.colorWarning
                                  : token.colorSuccess,
                            fontWeight: 600,
                          }}
                        >
                          {item.priority}
                        </Typography.Text>
                      )}
                      <div style={{ fontSize: 13, color: token.colorTextSecondary }}>
                        {formatScheduleTime(item.scheduledAt)}
                      </div>
                      <div style={{ fontFamily: "ui-monospace, Consolas, monospace", letterSpacing: "0.04em", color: token.colorTextSecondary }}>
                        {formatMeetingCode(item.code)}
                      </div>
                    </div>
                    <Button
                      type="primary"
                      size="small"
                      loading={enteringId === item.id || busy}
                      onClick={() => void onEnterScheduled(item)}
                    >
                      {enteringId === item.id
                        ? t("home.joining")
                        : t("home.enterMeeting")}
                    </Button>
                  </div>
                ))}
              </Flex>
            )}
          </Card>
        </Col>
      </Row>

      {/* Join Meeting Modal */}
      <Modal
        open={modal === "join"}
        title={t("joinModal.title")}
        onCancel={closeModal}
        onOk={() => void onJoin()}
        confirmLoading={busy}
        okText={t("joinModal.submit")}
        cancelText={t("common.cancel")}
        destroyOnHidden
      >
        <Form form={joinForm} layout="vertical" initialValues={{ mic: true, cam: false }}>
          <Form.Item
            name="code"
            label={t("joinModal.code")}
            rules={[{ required: true, message: t("joinModal.code") }]}
          >
            <Input
              inputMode="numeric"
              pattern="\d{9}"
              maxLength={11}
              placeholder={joinHistory.length > 0 ? t("joinModal.codePlaceholder") : "123456789"}
              autoFocus
            />
          </Form.Item>
          {joinNeedsPassword && (
            <Form.Item
              name="password"
              label={t("joinModal.password")}
              rules={[{ required: true, message: t("joinModal.password") }, { min: 4, max: 32 }]}
            >
              <Input.Password autoComplete="off" />
            </Form.Item>
          )}
          <Form.Item name="mic" valuePropName="checked">
            <Checkbox>{t("joinModal.micOnJoin")}</Checkbox>
          </Form.Item>
          <Form.Item name="cam" valuePropName="checked">
            <Checkbox>{t("joinModal.camOnJoin")}</Checkbox>
          </Form.Item>
        </Form>
      </Modal>

      {/* Schedule Meeting Modal */}
      <Modal
        open={modal === "schedule"}
        title={t("scheduleModal.title")}
        onCancel={closeModal}
        onOk={() => void onSchedule()}
        confirmLoading={busy}
        okText={t("scheduleModal.submit")}
        cancelText={t("common.cancel")}
        destroyOnHidden
      >
        <Form form={schedForm} layout="vertical" initialValues={{ waitingRoom: false, enablePassword: false }}>
          <Form.Item
            name="topic"
            label={t("scheduleModal.topic")}
            rules={[{ max: 120 }]}
          >
            <Input maxLength={120} autoFocus />
          </Form.Item>
          <Form.Item name="waitingRoom" valuePropName="checked">
            <Checkbox>{t("scheduleModal.waitingRoom")}</Checkbox>
          </Form.Item>
          <Form.Item name="enablePassword" valuePropName="checked">
            <Checkbox>{t("scheduleModal.enablePassword")}</Checkbox>
          </Form.Item>
          <Form.Item shouldUpdate noStyle>
            {() => {
              const enablePwd = schedForm.getFieldValue("enablePassword");
              return enablePwd ? (
                <Form.Item
                  name="password"
                  label={t("scheduleModal.password")}
                  rules={[{ min: 4, max: 32 }]}
                  style={{ marginTop: 12 }}
                >
                  <Input.Password
                    autoComplete="new-password"
                    placeholder={t("scheduleModal.passwordHint")}
                  />
                </Form.Item>
              ) : null;
            }}
          </Form.Item>
          <Form.Item
            name="time"
            label={t("scheduleModal.time")}
            rules={[{ required: true, message: t("scheduleModal.time") }]}
          >
            <Input type="datetime-local" style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
