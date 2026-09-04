import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SearchOutlined,
  CloseOutlined,
  RightOutlined,
  TeamOutlined,
  BankOutlined,
  CheckOutlined,
} from "@ant-design/icons";
import { SysDeptApi, SysUserApi, type DeptItem, type SysUserItem } from "@/api/client";

export type MemberPickerValue = {
  userIds: number[];
  deptIds: number[];
};

type SelectedUser = {
  userId: number;
  nickName: string;
  deptName: string | null;
};

type SelectedDept = {
  deptId: number;
  deptName: string;
  userCount: number;
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
  const [deptTree, setDeptTree] = useState<DeptItem[]>([]);
  const [expandedDepts, setExpandedDepts] = useState<Set<number>>(new Set());
  const [selectedDeptId, setSelectedDeptId] = useState<number | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [userPage, setUserPage] = useState(1);
  const [userTotal, setUserTotal] = useState(0);
  const [users, setUsers] = useState<SysUserItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [deptUserCounts, setDeptUserCounts] = useState<Record<number, number>>({});

  // Selected state (local, synced with value prop)
  const [selectedUsers, setSelectedUsers] = useState<Map<number, SelectedUser>>(new Map());
  const [selectedDepts, setSelectedDepts] = useState<Map<number, SelectedDept>>(new Map());

  // Sync from value prop
  useEffect(() => {
    if (!value) {
      setSelectedUsers(new Map());
      setSelectedDepts(new Map());
      return;
    }
    // Sync selected users
    const userMap = new Map<number, SelectedUser>();
    for (const uid of value.userIds) {
      // Try to find from current users list
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

    const deptMap = new Map<number, SelectedDept>();
    for (const did of value.deptIds) {
      const found = deptTree.find((d) => d.deptId === did);
      deptMap.set(did, {
        deptId: did,
        deptName: found?.deptName ?? String(did),
        userCount: deptUserCounts[did] ?? 0,
      });
    }
    setSelectedDepts(deptMap);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync from external value
  }, [value?.userIds.join(","), value?.deptIds.join(",")]);

  // Load dept tree
  useEffect(() => {
    void SysDeptApi.list().then((res) => {
      setDeptTree(res.tree ?? []);
      // Auto-expand first level
      const firstLevel = (res.tree ?? []).map((d) => d.deptId);
      setExpandedDepts(new Set(firstLevel));
      // Auto-select first dept
      if (firstLevel.length > 0 && selectedDeptId == null) {
        setSelectedDeptId(firstLevel[0]!);
      }
    }).catch(() => {});
  }, []);

  // Load users when dept or search or page changes
  useEffect(() => {
    if (selectedDeptId == null && !userSearch) return;
    setUsersLoading(true);
    void SysUserApi.list({
      deptId: selectedDeptId ?? undefined,
      userName: userSearch || undefined,
      page: userPage,
      pageSize: 50,
    }).then((res) => {
      setUsers(res.items);
      setUserTotal(res.total);
    }).catch(() => {
      setUsers([]);
      setUserTotal(0);
    }).finally(() => setUsersLoading(false));
  }, [selectedDeptId, userSearch, userPage]);

  // Load dept user counts for selected depts
  useEffect(() => {
    for (const dept of deptTree) {
      if (deptUserCounts[dept.deptId] != null) continue;
      void SysUserApi.list({ deptId: dept.deptId, page: 1, pageSize: 1 }).then((res) => {
        setDeptUserCounts((prev) => ({ ...prev, [dept.deptId]: res.total }));
      }).catch(() => {});
    }
  }, [deptTree]);

  const toggleDept = useCallback((deptId: number) => {
    setExpandedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(deptId)) next.delete(deptId);
      else next.add(deptId);
      return next;
    });
  }, []);

  const isUserSelected = useCallback(
    (uid: number) => selectedUsers.has(uid),
    [selectedUsers],
  );

  const toggleUser = useCallback(
    (user: SysUserItem) => {
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
      onChange?.({
        userIds: [...next.keys()],
        deptIds: [...selectedDepts.keys()],
      });
    },
    [selectedUsers, selectedDepts, maxUsers, onChange],
  );

  const isDeptSelected = useCallback(
    (did: number) => selectedDepts.has(did),
    [selectedDepts],
  );

  const toggleDeptSelect = useCallback(
    (dept: DeptItem) => {
      const next = new Map(selectedDepts);
      if (next.has(dept.deptId)) {
        next.delete(dept.deptId);
      } else {
        next.set(dept.deptId, {
          deptId: dept.deptId,
          deptName: dept.deptName,
          userCount: deptUserCounts[dept.deptId] ?? 0,
        });
      }
      setSelectedDepts(next);
      onChange?.({
        userIds: [...selectedUsers.keys()],
        deptIds: [...next.keys()],
      });
    },
    [selectedDepts, selectedUsers, deptUserCounts, onChange],
  );

  const removeUser = useCallback(
    (uid: number) => {
      const next = new Map(selectedUsers);
      next.delete(uid);
      setSelectedUsers(next);
      onChange?.({
        userIds: [...next.keys()],
        deptIds: [...selectedDepts.keys()],
      });
    },
    [selectedUsers, selectedDepts, onChange],
  );

  const removeDept = useCallback(
    (did: number) => {
      const next = new Map(selectedDepts);
      next.delete(did);
      setSelectedDepts(next);
      onChange?.({
        userIds: [...selectedUsers.keys()],
        deptIds: [...next.keys()],
      });
    },
    [selectedUsers, selectedDepts, onChange],
  );

  // Flatten dept tree for rendering
  const flatDepts = useMemo(() => {
    const result: { dept: DeptItem; depth: number }[] = [];
    function walk(items: DeptItem[], depth: number) {
      for (const item of items) {
        result.push({ dept: item, depth });
        if (item.children?.length && expandedDepts.has(item.deptId)) {
          walk(item.children, depth + 1);
        }
      }
    }
    walk(deptTree, 0);
    return result;
  }, [deptTree, expandedDepts]);

  const totalPages = Math.ceil(userTotal / 50);

  return (
    <div className="member-picker">
      {/* Left: dept tree + user list */}
      <div className="member-picker-left">
        <div className="member-picker-search">
          <SearchOutlined style={{ fontSize: 16 }} aria-hidden />
          <input
            type="text"
            placeholder={t("memberPicker.searchUser")}
            value={userSearch}
            onChange={(e) => {
              setUserSearch(e.target.value);
              setUserPage(1);
              setSelectedDeptId(null);
            }}
          />
        </div>

        <div className="member-picker-cols">
          {/* Dept tree */}
          <div className="member-picker-tree">
            <p className="member-picker-section-label">{t("memberPicker.deptTree")}</p>
            <div className="member-picker-tree-list">
              {flatDepts.map(({ dept, depth }) => (
                <div
                  key={dept.deptId}
                  className={`member-picker-dept${selectedDeptId === dept.deptId ? " is-selected" : ""}`}
                  style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
                >
                  <button
                    type="button"
                    className="member-picker-dept-toggle"
                    onClick={() => toggleDept(dept.deptId)}
                    aria-expanded={expandedDepts.has(dept.deptId)}
                  >
                    {dept.children?.length ? (
                      <RightOutlined
                        style={{
                          fontSize: 14,
                          transform: expandedDepts.has(dept.deptId) ? "rotate(90deg)" : "none",
                          transition: "transform 0.15s",
                        }}
                      />
                    ) : (
                      <span style={{ width: 14, display: "inline-block" }} />
                    )}
                  </button>
                  <button
                    type="button"
                    className="member-picker-dept-name"
                    onClick={() => {
                      setSelectedDeptId(dept.deptId);
                      setUserSearch("");
                      setUserPage(1);
                    }}
                  >
                    <BankOutlined style={{ fontSize: 14 }} aria-hidden />
                    <span>{dept.deptName}</span>
                  </button>
                  <button
                    type="button"
                    className={`member-picker-dept-check${isDeptSelected(dept.deptId) ? " is-checked" : ""}`}
                    onClick={() => toggleDeptSelect(dept)}
                    title={t("memberPicker.selectDept")}
                  >
                    {isDeptSelected(dept.deptId) ? <CheckOutlined /> : ""}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* User list */}
          <div className="member-picker-users">
            <p className="member-picker-section-label">
              {selectedDeptId
                ? t("memberPicker.usersInDept")
                : t("memberPicker.searchResults")}
            </p>
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
                    <TeamOutlined style={{ fontSize: 14 }} aria-hidden />
                    <span className="member-picker-user-name">{user.nickName}</span>
                    <span className="member-picker-user-id">({user.userName})</span>
                    {selected && <span className="member-picker-user-check"><CheckOutlined /></span>}
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
        </div>
      </div>

      {/* Right: selected members */}
      <div className="member-picker-right">
        <div className="member-picker-right-header">
          <span>{t("memberPicker.selected")}</span>
          <span className="member-picker-count">
            {selectedUsers.size + selectedDepts.size}
          </span>
        </div>

        <div className="member-picker-selected-list">
          {/* Selected departments */}
          {[...selectedDepts.values()].map((d) => (
            <div key={d.deptId} className="member-picker-selected-item member-picker-selected-dept">
              <BankOutlined style={{ fontSize: 14 }} aria-hidden />
              <span className="member-picker-selected-name">{d.deptName}</span>
              <span className="member-picker-selected-meta">
                {t("memberPicker.deptUserCount", { count: d.userCount })}
              </span>
              <button
                type="button"
                className="member-picker-remove"
                onClick={() => removeDept(d.deptId)}
                aria-label={t("common.remove")}
              >
                <CloseOutlined style={{ fontSize: 14 }} />
              </button>
            </div>
          ))}

          {/* Selected users */}
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

          {selectedUsers.size === 0 && selectedDepts.size === 0 && (
            <p className="muted member-picker-empty">{t("memberPicker.empty")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
