import { googleSignupReturn } from '../analytics/source';
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

// The server reads it only when the request creates the user (signupSource.ts).
const source = (campaign: string | null) =>
  campaign ? { fetchOptions: { headers: { 'x-notaflow-source': campaign } } } : {};

export async function signInWithCode(
  email: string,
  otp: string,
  campaign: string | null,
): Promise<void> {
  await unwrap(authClient.signIn.emailOtp({ email, otp, ...source(campaign) }));
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  await unwrap(authClient.signIn.email({ email, password }));
}

export async function signUpWithPassword(
  name: string,
  email: string,
  password: string,
  token: string | null,
  campaign: string | null,
): Promise<void> {
  const headers = {
    ...(token ? { 'x-captcha-response': token } : {}),
    ...(campaign ? { 'x-notaflow-source': campaign } : {}),
  };
  await unwrap(authClient.signUp.email({ name, email, password, fetchOptions: { headers } }));
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

// Leaves the page: Google brings the browser back to callbackURL, or to errorCallbackURL with ?error=.
export async function signInWithGoogle(
  callbackURL: string,
  errorCallbackURL: string,
  campaign: string | null,
): Promise<void> {
  await unwrap(
    authClient.signIn.social({
      provider: 'google',
      callbackURL,
      errorCallbackURL,
      newUserCallbackURL: googleSignupReturn(campaign),
      ...(campaign ? { additionalData: { signupSource: campaign } } : {}),
    }),
  );
}

export async function signInWithPasskey(): Promise<void> {
  await unwrap(authClient.signIn.passkey());
}

export async function signOut(): Promise<void> {
  await unwrap(authClient.signOut());
}

export interface LinkedAccount {
  id: string;
  providerId: string;
}

export interface PasskeyItem {
  id: string;
  name: string | null;
  createdAt: string;
}

export interface SessionItem {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  updatedAt: string;
  current: boolean;
}

const iso = (value: Date | string | null | undefined) =>
  value ? new Date(value).toISOString() : new Date(0).toISOString();

export async function updateName(name: string): Promise<void> {
  await unwrap(authClient.updateUser({ name }));
}

export async function listAccounts(): Promise<LinkedAccount[]> {
  const accounts = (await unwrap(authClient.listAccounts())) ?? [];
  return accounts.map((a) => ({ id: a.id, providerId: a.providerId }));
}

export async function linkGoogle(): Promise<void> {
  await unwrap(
    authClient.linkSocial({
      provider: 'google',
      callbackURL: '/app/conta',
      errorCallbackURL: '/app/conta',
    }),
  );
}

export async function unlinkAccount(accountId: string): Promise<void> {
  await unwrap(authClient.unlinkAccount({ accountId }));
}

export async function listPasskeys(): Promise<PasskeyItem[]> {
  const passkeys = (await unwrap(authClient.passkey.listUserPasskeys())) ?? [];
  return passkeys.map((p) => ({ id: p.id, name: p.name ?? null, createdAt: iso(p.createdAt) }));
}

export async function addPasskey(name: string): Promise<void> {
  await unwrap(authClient.passkey.addPasskey({ name }));
}

export async function deletePasskey(id: string): Promise<void> {
  await unwrap(authClient.passkey.deletePasskey({ id }));
}

export async function listSessions(): Promise<SessionItem[]> {
  const [sessions, current] = await Promise.all([
    unwrap(authClient.listSessions()),
    unwrap(authClient.getSession()),
  ]);
  return (sessions ?? []).map((s) => ({
    id: s.id,
    userAgent: s.userAgent ?? null,
    ipAddress: s.ipAddress ?? null,
    updatedAt: iso(s.updatedAt),
    current: s.id === current?.session.id,
  }));
}

export async function revokeSessions(): Promise<void> {
  await unwrap(authClient.revokeSessions());
}
