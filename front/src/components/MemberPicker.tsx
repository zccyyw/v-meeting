import { useCallback, useEffect, useRef, useState } from "react";
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
};

export function MemberPicker({
  value,
  onChange,
  excludeUserIds = [],
  maxUsers = 0,
}: Props) {
  const { t } = useTranslation();
  const [userSearch, setUserSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [userPage, setUserPage] = useState(1);
  const [userTotal, setUserTotal] = useState(0);
  const [users, setUsers] = useState<SimpleUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  // Selected state (local, synced with value prop)
  const [selectedUsers, setSelectedUsers] = useState<Map<number, SelectedUser>>(new Map());

  // Sync from value prop
  useEffect(() => {
    if (!value) {
      setSelectedUsers(new Map());
      return;
    }
    const userMap = new Map<number, SelectedUser>();
    for (const uid of value.userIds) {
      const found = users.find((u) => u.userId === uid);
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
  }, [value?.userIds.join(",")]);

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(userSearch);
      setUserPage(1);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [userSearch]);

  // Load all users (no dept filter), support search
  useEffect(() => {
    setUsersLoading(true);
    void SysUserApi.simpleList({
      userName: debouncedSearch || undefined,
      page: userPage,
      pageSize: 50,
    }).then((res) => {
      setUsers(res.items);
      setUserTotal(res.total);
    }).catch(() => {
      setUsers([]);
      setUserTotal(0);
    }).finally(() => setUsersLoading(false));
  }, [debouncedSearch, userPage]);

  const isUserSelected = useCallback(
    (uid: number) => selectedUsers.has(uid),
    [selectedUsers],
  );

  const toggleUser = useCallback(
    (user: SimpleUser) => {
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
    [selectedUsers, maxUsers, onChange, value?.deptIds],
  );

  const removeUser = useCallback(
    (uid: number) => {
      const next = new Map(selectedUsers);
      next.delete(uid);
      setSelectedUsers(next);
      onChange?.({
        userIds: [...next.keys()],
        deptIds: value?.deptIds ?? [],
      });
    },
    [selectedUsers, onChange, value?.deptIds],
  );

  const totalPages = Math.ceil(userTotal / 50);

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
          {!usersLoading && users.length === 0 && (
            <p className="muted">{t("memberPicker.noUsers")}</p>
          )}
          {users.map((user) => {
            const excluded = excludeUserIds.includes(user.userId);
            const selected = isUserSelected(user.userId);
            return (
              <button
                key={user.userId}
                type="button"
                className={`member-picker-user${selected ? " is-selected" : ""}${excluded ? " is-disabled" : ""}`}
                disabled={excluded}
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
        {totalPages > 1 && (
          <div className="member-picker-pagination">
            <button
              type="button"
              disabled={userPage <= 1}
              onClick={() => setUserPage((p) => p - 1)}
            >
              ‹
            </button>
            <span>{userPage} / {totalPages}</span>
            <button
              type="button"
              disabled={userPage >= totalPages}
              onClick={() => setUserPage((p) => p + 1)}
            >
              ›
            </button>
          </div>
        )}
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
