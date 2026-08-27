import { Socket } from 'net';

export interface TcpCheckResult {
  online: boolean;
  responseTimeMs: number | null;
}

// Basic TCP reachability probe only — connects and confirms the socket
// opens, then immediately closes it. Deliberately NOT a full RTSP
// handshake or stream validation (explicitly out of scope for Model 1,
// see PRD Section 6a point 2 / FR-4).
export function attemptTcpPortCheck(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<TcpCheckResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = new Socket();
    let settled = false;

    const finish = (result: TcpCheckResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);

    socket.once('connect', () => {
      finish({ online: true, responseTimeMs: Date.now() - startedAt });
    });

    socket.once('timeout', () => {
      finish({ online: false, responseTimeMs: null });
    });

    socket.once('error', () => {
      finish({ online: false, responseTimeMs: null });
    });

    socket.connect(port, host);
  });
}
