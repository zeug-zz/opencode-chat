const MAX_REASON_LENGTH = 256;
const REDACTED_PATH = "[redacted-path]";
const REDACTED_URL = "[redacted-url]";
const REDACTED_SECRET = "[redacted-secret]";

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'`]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"'`]*)?/gi;
const PATH_PATTERN =
  /(?:\b[A-Za-z]:[\\/][^\s<>"'`]+|(?:~\/|\.\.\/+(?:\.\.\/+)*)[^\s<>"'`]+|\/(?:Users|home|var|private)\/[^\s<>"'`]+)/g;
const SECRET_PATTERN =
  /\b(?:Bearer\s+[A-Za-z0-9._~+/=-]{8,}|sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16,}|eyJ[A-Za-z0-9_-]{12,}(?:\.[A-Za-z0-9_-]+){0,2}|(?=[A-Za-z0-9+/=_-]{32,}\b)(?=[A-Za-z0-9+/=_-]*[A-Za-z])(?=[A-Za-z0-9+/=_-]*\d)[A-Za-z0-9+/=_-]{32,})\b/gi;
const CONTROL_CHARACTERS = /\p{Cc}+/gu;

/** Normalize untrusted stage wording before it crosses the public summary boundary. */
export function redactReviewReason(text: string): string {
  return text
    .replace(SECRET_PATTERN, REDACTED_SECRET)
    .replace(URL_PATTERN, REDACTED_URL)
    .replace(PATH_PATTERN, REDACTED_PATH)
    .replace(CONTROL_CHARACTERS, " ")
    .slice(0, MAX_REASON_LENGTH);
}
