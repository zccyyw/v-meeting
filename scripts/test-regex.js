// Test the special char regex from password-policy.ts
const specialChars = "!@#$%^&*()_+-=[]{}|;:,.<>?/";

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const escaped = escapeRegex(specialChars);
console.log("Special chars:", specialChars);
console.log("Escaped:", escaped);

const regexStr = `[${escaped}]`;
console.log("Regex pattern:", regexStr);

try {
  const regex = new RegExp(regexStr);
  console.log("Regex:", regex);
  console.log("Abcdefg123 (no special):", regex.test("Abcdefg123"));
  console.log("Abcdef@123 (has @):", regex.test("Abcdef@123"));
  console.log("Test1234 (no special):", regex.test("Test1234"));
  console.log("Abc!123 (has !):", regex.test("Abc!123"));
  console.log("Abc+123 (has +):", regex.test("Abc+123"));
  console.log("Abc=123 (has =):", regex.test("Abc=123"));
} catch (e) {
  console.error("Regex error:", e.message);
}
