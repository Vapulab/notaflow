const KEY = 'notaflow-login-email';

// Not in the URL: analytics and access logs record URLs.
export function rememberLoginEmail(email: string): void {
  try {
    sessionStorage.setItem(KEY, email);
  } catch {
    // Without storage the login form starts empty.
  }
}

export function takeLoginEmail(): string {
  try {
    const email = sessionStorage.getItem(KEY) ?? '';
    sessionStorage.removeItem(KEY);
    return email;
  } catch {
    return '';
  }
}
