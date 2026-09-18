import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SearchOutlined,
  CloseOutlined,
  TeamOutlined,
  CheckOutlined,
} from "@ant-design/icons";
import { SysUserApi } from "@/api/client";

type SimpleUser = {
  userId: number;
  userName: string;
  nickName: string;
};

export type MemberPickerValue = {
  userIds: number[];
  deptIds: number[];
};

type SelectedUser = {
  userId: number;
  nickName: string;
  deptName: string | null;
};

type Props = {
  value?: MemberPickerValue;
  onChange?: (val: MemberPickerValue) => void;
  /** Exclude these user IDs (e.g. existing members when editing). */
  excludeUserIds?: number[];
  /** Max selectable users, 0 = unlimited. */
  maxUsers?: number;
  /** 不可移除/取消勾选的用户（如群主本人）。 */
  lockedUserIds?: number[];
};

export function MemberPicker({
  value,
  onChange,
  excludeUserIds = [],
  maxUsers = 0,
  lockedUserIds = [],
}: Props) {
  const { t } = useTranslation();
  const [userSearch, setUserSearch] = useState("");
  const [users, setUsers] = useState<SimpleUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  // Selected state (local, synced with value prop)
  const [selectedUsers, setSelectedUsers] = useState<Map<number, SelectedUser>>(new Map());
  // 用户信息缓存：跨搜索/翻页累积已见过的用户，
  // 保证已选列表始终能映射出昵称（而非用户 ID 兜底）
  const [userCache, setUserCache] = useState<Map<number, SimpleUser>>(new Map());

  // Sync from value prop
  useEffect(() => {
    if (!value) {
      setSelectedUsers(new Map());
      return;
    }
    const userMap = new Map<number, SelectedUser>();
    for (const uid of value.userIds) {
      const found = userCache.get(uid);
      if (found) {
        userMap.set(uid, {
          userId: uid,
          nickName: found.nickName,
          deptName: null,
        });
      } else {
        userMap.set(uid, { userId: uid, nickName: String(uid), deptName: null });
      }
    }
    setSelectedUsers(userMap);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync from external value
  }, [value?.userIds.join(","), userCache]);

  // 一次性拉取全部用户（不分页），搜索改为前端本地过滤
  useEffect(() => {
    setUsersLoading(true);
    void SysUserApi.simpleList({ pageSize: 5000 }).then((res) => {
      setUsers(res.items);
      // 累积进缓存，保证已选用户昵称稳定
      setUserCache((prev) => {
        const next = new Map(prev);
        for (const u of res.items) next.set(u.userId, u);
        return next;
      });
    }).catch(() => {
      setUsers([]);
    }).finally(() => setUsersLoading(false));
  }, []);

  const isUserSelected = useCallback(
    (uid: number) => selectedUsers.has(uid),
    [selectedUsers],
  );

  const toggleUser = useCallback(
    (user: SimpleUser) => {
      if (lockedUserIds.includes(user.userId)) return;
      const next = new Map(selectedUsers);
      if (next.has(user.userId)) {
        next.delete(user.userId);
      } else {
        if (maxUsers > 0 && next.size >= maxUsers) return;
        next.set(user.userId, {
          userId: user.userId,
          nickName: user.nickName,
          deptName: null,
        });
      }
      setSelectedUsers(next);
      // 保留已有部门成员选择（本组件仅管理用户维度）
      onChange?.({
        userIds: [...next.keys()],
        deptIds: value?.deptIds ?? [],
      });
    },
    [selectedUsers, maxUsers, onChange, value?.deptIds, lockedUserIds],
  );

  const removeUser = useCallback(
    (uid: number) => {
      if (lockedUserIds.includes(uid)) return;
      const next = new Map(selectedUsers);
      next.delete(uid);
      setSelectedUsers(next);
      onChange?.({
        userIds: [...next.keys()],
        deptIds: value?.deptIds ?? [],
      });
    },
    [selectedUsers, onChange, value?.deptIds, lockedUserIds],
  );

  // 搜索本地过滤：userName / 昵称模糊匹配
  const visibleUsers = useMemo(() => {
    const kw = userSearch.trim().toLowerCase();
    if (!kw) return users;
    return users.filter(
      (u) =>
        u.userName.toLowerCase().includes(kw) ||
        u.nickName.toLowerCase().includes(kw),
    );
  }, [users, userSearch]);

  return (
    <div className="member-picker member-picker-simple">
      {/* Left: user list with search */}
      <div className="member-picker-left">
        <div className="member-picker-search">
          <SearchOutlined style={{ fontSize: 16 }} aria-hidden />
          <input
            type="text"
            placeholder={t("memberPicker.searchUser")}
            value={userSearch}
            onChange={(e) => {
              setUserSearch(e.target.value);
            }}
          />
        </div>

        <div className="member-picker-user-list">
          {usersLoading && <p className="muted">{t("common.loading")}</p>}
          {!usersLoading && visibleUsers.length === 0 && (
            <p className="muted">{t("memberPicker.noUsers")}</p>
          )}
          {visibleUsers.map((user) => {
            const excluded = excludeUserIds.includes(user.userId);
            const locked = lockedUserIds.includes(user.userId);
            const selected = isUserSelected(user.userId);
            return (
              <button
                key={user.userId}
                type="button"
                className={`member-picker-user${selected ? " is-selected" : ""}${excluded || (locked && selected) ? " is-disabled" : ""}`}
                disabled={excluded || (locked && selected)}
                onClick={() => toggleUser(user)}
              >
                {/* 自定义复选框 */}
                <span className={`member-picker-checkbox${selected ? " is-checked" : ""}`}>
                  {selected && <CheckOutlined style={{ fontSize: 12 }} />}
                </span>
                <TeamOutlined style={{ fontSize: 14 }} aria-hidden />
                <span className="member-picker-user-name">{user.nickName}</span>
                <span className="member-picker-user-id">({user.userName})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: selected members */}
      <div className="member-picker-right">
        <div className="member-picker-right-header">
          <span>{t("memberPicker.selected")}</span>
          <span className="member-picker-count">
            {selectedUsers.size}
          </span>
        </div>

        <div className="member-picker-selected-list">
          {[...selectedUsers.values()].map((u) => (
            <div key={u.userId} className="member-picker-selected-item member-picker-selected-user">
              <TeamOutlined style={{ fontSize: 14 }} aria-hidden />
              <span className="member-picker-selected-name">{u.nickName}</span>
              <button
                type="button"
                className="member-picker-remove"
                onClick={() => removeUser(u.userId)}
                disabled={lockedUserIds.includes(u.userId)}
                aria-label={t("common.remove")}
              >
                <CloseOutlined style={{ fontSize: 14 }} />
              </button>
            </div>
          ))}

          {selectedUsers.size === 0 && (
            <p className="muted member-picker-empty">{t("memberPicker.empty")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
