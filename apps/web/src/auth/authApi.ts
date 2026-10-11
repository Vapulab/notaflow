import { ApiError } from '../api';
import { authClient } from './authClient';

type Result<T> = { data: T | null; error: { status: number; code?: string | undefined } | null };

// Better Auth answers { data, error }; the screens use ApiError, like every other call.
async function unwrap<T>(call: Promise<Result<T>>): Promise<T | null> {
  const { data, error } = await call;
  if (error) {
    const code = error.code ?? (error.status === 429 ? 'rate_limited' : `http_${error.status}`);
    throw new ApiError(error.status, code);
  }
  return data;
}

const captcha = (token: string | null) =>
  token ? { fetchOptions: { headers: { 'x-captcha-response': token } } } : {};

export async function sendCode(
  email: string,
  type: 'sign-in' | 'email-verification',
  token: string | null,
): Promise<void> {
  await unwrap(authClient.emailOtp.sendVerificationOtp({ email, type, ...captcha(token) }));
}

export async function signInWithCode(email: string, otp: string): Promise<void> {
  await unwrap(authClient.signIn.emailOtp({ email, otp }));
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  await unwrap(authClient.signIn.email({ email, password }));
}

export async function signUpWithPassword(
  name: string,
  email: string,
  password: string,
  token: string | null,
): Promise<void> {
  await unwrap(authClient.signUp.email({ name, email, password, ...captcha(token) }));
}

export async function verifyEmail(email: string, otp: string): Promise<void> {
  await unwrap(authClient.emailOtp.verifyEmail({ email, otp }));
}

export async function requestReset(email: string, token: string | null): Promise<void> {
  await unwrap(authClient.emailOtp.requestPasswordReset({ email, ...captcha(token) }));
}

export async function resetPassword(email: string, otp: string, password: string): Promise<void> {
  await unwrap(authClient.emailOtp.resetPassword({ email, otp, password }));
}

// Leaves the page: Google brings the browser back to callbackURL.
export async function signInWithGoogle(callbackURL: string): Promise<void> {
  await unwrap(authClient.signIn.social({ provider: 'google', callbackURL }));
}

export async function signInWithPasskey(): Promise<void> {
  await unwrap(authClient.signIn.passkey());
}

export async function signOut(): Promise<void> {
  await unwrap(authClient.signOut());
}
