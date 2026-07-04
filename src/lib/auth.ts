export function getRedirectUrl(siteUrl: string) {
  return siteUrl.replace(/\/$/, "");
}

export function getPasswordValidation(password: string) {
  if (password.length < 8) {
    return {
      valid: false,
      message: "パスワードは8文字以上で入力してください。",
    };
  }

  return { valid: true, message: "" };
}

export function getFriendlyAuthError(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login credentials")) {
    return "メールアドレスまたはパスワードが違います。初回・未設定の場合は「パスワード設定」から設定してください。";
  }

  if (normalized.includes("email not confirmed")) {
    return "メール確認が完了していません。届いたメールを確認してください。";
  }

  if (normalized.includes("rate limit")) {
    return "短時間に試行が集中しています。少し待ってから再度お試しください。";
  }

  return message;
}
