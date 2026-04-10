import { env } from "./env";

export const APP_URL = env.NEXT_PUBLIC_APP_URL;
export const GOOGLE_MODEL = env.GOOGLE_MODEL;
export const GHL_BASE_URL = env.GHL_BASE_URL;

export function withAppUrl(pathname: string): string {
  return new URL(pathname, APP_URL).toString();
}
