import { Card, Typography, theme } from "antd";
import type { ReactNode } from "react";

type ActionTileProps = {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  color?: string;
};

export function ActionTile({
  icon,
  label,
  onClick,
}: ActionTileProps) {
  const { token } = theme.useToken();

  return (
    <Card
      hoverable
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "center",
        borderRadius: token.borderRadiusLG,
        cursor: "pointer",
      }}
      styles={{
        body: {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          padding: "20px 12px",
        },
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: token.borderRadiusLG,
          background: token.colorPrimary,
          color: token.colorTextLightSolid,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 24,
          boxShadow: `0 4px 12px ${token.colorPrimaryBg}`,
        }}
      >
        {icon}
      </div>
      <Typography.Text style={{ fontSize: 13 }}>{label}</Typography.Text>
    </Card>
  );
}
