export const CODES = Object.freeze({
  INVALID_ARGUMENT: 'CORVID_INVALID_ARGUMENT',
  NOT_FOUND: 'CORVID_NOT_FOUND',
  CONTROL_LOST: 'CORVID_CONTROL_LOST',
  EXECUTION_RISK: 'CORVID_EXECUTION_RISK',
  TIMEOUT: 'CORVID_TIMEOUT',
  STALE_REFERENCE: 'CORVID_STALE_REFERENCE',
  UNSUPPORTED: 'CORVID_UNSUPPORTED',
  UNAUTHORIZED: 'CORVID_UNAUTHORIZED',
  DESKTOP_ERROR: 'CORVID_DESKTOP_ERROR',
});

/**
 * Operational error raised by the Corvid SDK. Argument-shape problems keep using
 * TypeError/RangeError so callers can tell "bad input" apart from "the browser
 * or the room refused the operation".
 */
export class CorvidError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'CorvidError';
    this.code = code;
    this.details = details;
  }
}

export function isCorvidError(error) {
  return error instanceof CorvidError || Boolean(error && typeof error.code === 'string' && error.code.startsWith('CORVID_'));
}

export function errorFromResponse(status, payload) {
  if (payload && typeof payload.code === 'string' && payload.code.startsWith('CORVID_')) {
    return new CorvidError(payload.code, payload.error || `Desktop request failed: ${status}`, { status });
  }
  return new CorvidError(CODES.DESKTOP_ERROR, payload && payload.error ? payload.error : `Desktop request failed: ${status}`, { status });
}
