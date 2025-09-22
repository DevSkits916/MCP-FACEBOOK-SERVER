export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  message: string;
  reqId?: string;
  route?: string;
  status?: number;
  ms?: number;
  tool?: string;
  fb_call?: string;
  details?: Record<string, unknown>;
}

type Listener = (entry: LogEntry) => void;

const MAX_LOGS = 500;
const logBuffer: LogEntry[] = [];
const listeners = new Set<Listener>();

function sanitize(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (key.toLowerCase().includes('token') || key.toLowerCase().includes('secret')) {
      redacted[key] = '[redacted]';
    } else if (typeof val === 'object') {
      redacted[key] = sanitize(val);
    } else {
      redacted[key] = val;
    }
  }
  return redacted;
}

function append(entry: LogEntry) {
  const sanitized: LogEntry = {
    ...entry,
    details: entry.details ? (sanitize(entry.details) as Record<string, unknown>) : undefined,
  };
  logBuffer.push(sanitized);
  if (logBuffer.length > MAX_LOGS) {
    logBuffer.splice(0, logBuffer.length - MAX_LOGS);
  }
  for (const listener of listeners) {
    try {
      listener(sanitized);
    } catch (error) {
      console.error('Log listener error', error);
    }
  }
}

export class RequestLogger {
  constructor(private readonly base: Partial<LogEntry> = {}) {}

  child(extra: Partial<LogEntry>): RequestLogger {
    return new RequestLogger({ ...this.base, ...extra });
  }

  log(level: LogLevel, message: string, details?: Record<string, unknown>) {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      message,
      ...this.base,
      details,
    };
    append(entry);
  }

  debug(message: string, details?: Record<string, unknown>) {
    this.log('debug', message, details);
  }

  info(message: string, details?: Record<string, unknown>) {
    this.log('info', message, details);
  }

  warn(message: string, details?: Record<string, unknown>) {
    this.log('warn', message, details);
  }

  error(message: string, details?: Record<string, unknown>) {
    this.log('error', message, details);
  }
}

const rootLogger = new RequestLogger();

export function getRootLogger(): RequestLogger {
  return rootLogger;
}

export function createRequestLogger(base: Partial<LogEntry>): RequestLogger {
  return rootLogger.child(base);
}

export function getRecentLogs(limit = 100): LogEntry[] {
  return logBuffer.slice(-limit);
}

export function subscribe(onLog: Listener): () => void {
  listeners.add(onLog);
  return () => {
    listeners.delete(onLog);
  };
}
