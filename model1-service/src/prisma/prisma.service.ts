import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Prisma's default query engine (a Rust binary) does its own DNS
 * resolution outside Node, independent of Node's `dns`/`net` modules —
 * so it can't benefit from Node's Happy Eyeballs (`autoSelectFamily`)
 * dual-stack racing. In dev environments with a broken/unreachable IPv6
 * route (confirmed directly here: raw IPv6 TCP to Neon times out, IPv4
 * to the same host connects in under a second), the default engine
 * hangs at P1001 trying IPv6 addresses first, since Neon's DNS lists
 * IPv6 before IPv4.
 *
 * The `pg` driver (via @prisma/adapter-pg) uses Node's own `net.connect`,
 * which *does* use Happy Eyeballs and reliably falls through to IPv4 —
 * confirmed directly: a raw `pg.Client` connects in ~3.6s in the same
 * environment where the default engine hangs indefinitely.
 *
 * One real caveat found while fixing this: Neon's `channel_binding=require`
 * connection-string parameter (present in DATABASE_URL for the stronger
 * SCRAM-SHA-256-PLUS auth) is a libpq-specific option that `pg`'s
 * connection-string parser doesn't handle the same way — including it
 * causes `pg` to hang too. `sslmode=require` alone still gives full TLS
 * (pg treats it as `verify-full`, per its own startup warning — as
 * strong or stronger than plain `require`), so channel_binding is
 * stripped here specifically for the adapter's connection, without
 * touching DATABASE_URL itself (other tooling, e.g. `prisma migrate`,
 * still uses the real env var unmodified).
 */
function buildPgConnectionString(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error('DATABASE_URL is not set');
  }
  const url = new URL(raw);
  url.searchParams.delete('channel_binding');
  return url.toString();
}

const adapter = new PrismaPg({ connectionString: buildPgConnectionString() });

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
