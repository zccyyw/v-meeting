import { randomBytes as rb } from "node:crypto";

export function generateMeetingCode(bytes: () => Buffer = () => rb(4)): string {
  const n = bytes().readUInt32BE(0) % 1_000_000_000;
  return String(n).padStart(9, "0");
}
