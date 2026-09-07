import { useMemo } from "react";
import { CheckCircleFilled, CloseCircleFilled } from "@ant-design/icons";

type Rule = {
  label: string;
  test: (pw: string) => boolean;
};

const RULES: Rule[] = [
  { label: "至少 10 个字符", test: (pw) => pw.length >= 10 },
  { label: "包含大写字母", test: (pw) => /[A-Z]/.test(pw) },
  { label: "包含小写字母", test: (pw) => /[a-z]/.test(pw) },
  { label: "包含数字", test: (pw) => /[0-9]/.test(pw) },
  { label: "包含特殊字符", test: (pw) => /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?/]/.test(pw) },
];

type Props = {
  password: string;
};

export function PasswordStrengthHint({ password }: Props) {
  const results = useMemo(() => {
    return RULES.map((r) => ({ label: r.label, passed: r.test(password) }));
  }, [password]);

  const allPassed = results.every((r) => r.passed);

  return (
    <div className="password-strength-hint" style={{ marginTop: 6 }}>
      <div
        className="password-strength-summary"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: "0.78rem",
          color: allPassed ? "#52c41a" : "#8c8c8c",
        }}
      >
        {allPassed ? (
          <CheckCircleFilled style={{ color: "#52c41a" }} />
        ) : (
          <CloseCircleFilled style={{ color: "#ff4d4f" }} />
        )}
        <span>{allPassed ? "密码强度：符合要求" : "密码强度：不符合要求"}</span>
      </div>
      <ul
        className="password-strength-rules"
        style={{
          listStyle: "none",
          margin: "4px 0 0",
          padding: 0,
          display: "flex",
          flexWrap: "wrap",
          gap: "4px 12px",
        }}
      >
        {results.map((r, i) => (
          <li
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 3,
              fontSize: "0.72rem",
              color: r.passed ? "#52c41a" : "#bfbfbf",
            }}
          >
            {r.passed ? (
              <CheckCircleFilled style={{ fontSize: 11, color: "#52c41a" }} />
            ) : (
              <CloseCircleFilled style={{ fontSize: 11, color: "#d9d9d9" }} />
            )}
            <span>{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
