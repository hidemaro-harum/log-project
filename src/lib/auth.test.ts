import test from "node:test";
import assert from "node:assert/strict";
import { getPasswordValidation, getRedirectUrl } from "./auth.ts";

test("password validation requires an 8 character password", () => {
  assert.deepEqual(getPasswordValidation("short7"), {
    valid: false,
    message: "パスワードは8文字以上で入力してください。",
  });
});

test("password validation accepts a normal account password", () => {
  assert.deepEqual(getPasswordValidation("long-enough-password"), {
    valid: true,
    message: "",
  });
});

test("redirect url removes a trailing slash", () => {
  assert.equal(getRedirectUrl("https://log-project-psi.vercel.app/"), "https://log-project-psi.vercel.app");
});
