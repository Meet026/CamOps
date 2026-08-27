import { createServer, Server } from 'net';
import { attemptTcpPortCheck } from './tcp-port-check';

describe('attemptTcpPortCheck', () => {
  let server: Server;
  let port: number;

  beforeAll((done) => {
    server = createServer((socket) => socket.end());
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      port = typeof address === 'object' && address ? address.port : 0;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  it('resolves online:true with a numeric responseTimeMs when the port is open', async () => {
    const result = await attemptTcpPortCheck('127.0.0.1', port, 2000);

    expect(result.online).toBe(true);
    expect(typeof result.responseTimeMs).toBe('number');
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('resolves online:false with responseTimeMs null when the connection is refused', async () => {
    // Port 1 is a well-known unassigned/reserved port unlikely to have
    // anything listening in a test environment, and connection refusal is
    // near-instant (no need to wait out the timeout for this case).
    const result = await attemptTcpPortCheck('127.0.0.1', 1, 2000);

    expect(result.online).toBe(false);
    expect(result.responseTimeMs).toBeNull();
  });

  it('resolves online:false when the connection times out', async () => {
    // 10.255.255.1 is a non-routable address commonly used in tests to
    // simulate a connection that hangs rather than actively refuses —
    // pairs with a short timeout so the test itself stays fast.
    const result = await attemptTcpPortCheck('10.255.255.1', 9999, 200);

    expect(result.online).toBe(false);
    expect(result.responseTimeMs).toBeNull();
  }, 10000);
});
