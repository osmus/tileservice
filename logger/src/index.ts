// TODO: these types aren't included yet in Cloudflare's generated
// types API, I guess because Tail Workers are still in beta? See here:
//
// https://github.com/cloudflare/workerd/issues/1860
//
// For now we'll just handroll some types

interface TailLog {
  timestamp: number;
  level: "debug" | "info" | "log" | "warn" | "error";
  message: any[];
}

interface TailException {
  timestamp: number;
  name: string;
  message: string;
}

interface TailItem {
  scriptName: string;
  eventTimestamp: number;
  logs: TailLog[];
  exceptions: TailException[];
  outcome:
    | "unknown"
    | "ok"
    | "exception"
    | "exceededCpu"
    | "exceededMemory"
    | "scriptNotFound"
    | "canceled"
    | "responseStreamDisconnected";
  wallTime: number;
  cpuTime: number;
  event: {
    request: {
      url: string;
      method: string;
      headers: Record<string, string>;
      cf: Record<string, any>;
    };
    response: {
      status: number;
    };
  };
}

export default {
  async tail(items: TailItem[], env: Env, _context: ExecutionContext) {
    const streams = items.map(toLoki);
    if (streams.length === 0) {
      return;
    }

    const response = await fetch(env.LOKI_API_URL, {
      method: "POST",
      headers: {
        authorization: `Basic ${env.LOKI_CREDENTIALS}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ streams }),
    });
  },
};

function toLoki(item: TailItem) {
  const values: [string, string][] = [];

  // Add request log entry
  const requestEntry = formatRequest(item);
  if (requestEntry) {
    values.push(requestEntry);
  }

  // Add any captured console logs
  const logs = item.logs.map(formatLog);
  values.push(...logs);

  // Add any captured exceptions
  const exceptions = item.exceptions.map(formatException);
  values.push(...exceptions);

  return { stream: { app: item.scriptName }, values };
}

function formatRequest(item: TailItem): [string, string] | undefined {
  if (!item.eventTimestamp || !item.event?.request) {
    return undefined;
  }

  const { url, method, headers } = item.event.request;
  const { city, region, country, continent } = item.event.request.cf;

  const logEntry = {
    level: "info",
    outcome: item.outcome,
    wallTime: item.wallTime,
    cpuTime: item.cpuTime,
    request: {
      url,
      method,
      headers,
      cf: {
        city,
        region,
        country,
        continent,
      },
    },
    response: {
      status: item.event.response.status,
    },
  };

  return [toNano(item.eventTimestamp), JSON.stringify(logEntry)];
}

function formatLog(log: TailLog): [string, string] {
  const [first, ...args] = log.message;
  let logEntry;

  if (typeof first === "object") {
    logEntry = { ...first, args, level: log.level };
  } else {
    logEntry = { msg: first, args, level: log.level };
  }

  return [toNano(log.timestamp), JSON.stringify(logEntry)];
}

function formatException(exception: TailException): [string, string] {
  const logEntry = {
    msg: exception.message,
    name: exception.name,
    level: "error",
  };

  return [toNano(exception.timestamp), JSON.stringify(logEntry)];
}

function toNano(timestamp: number) {
  const nano = BigInt(timestamp) * BigInt(1_000_000);
  return nano.toString();
}
