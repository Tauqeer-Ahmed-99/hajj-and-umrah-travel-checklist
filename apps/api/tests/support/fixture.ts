import { createServer } from "node:http";
import { once } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Pool } from "pg";
import { migrate } from "../../scripts/migrations";

export async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  await new Promise<void>((done) => server.close(() => done()));
  return address.port;
}

export async function startFixture() {
  const directory = await mkdtemp(resolve(tmpdir(), "nmt-profile-"));
  const pgPort = await freePort();
  const postgres = new EmbeddedPostgres({
    databaseDir: resolve(directory, "postgres"),
    port: pgPort,
    user: "postgres",
    password: "local-test-only",
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-h", "127.0.0.1"],
    onLog: () => {},
    onError: () => {},
  });
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "fixture-key",
    use: "sig",
    alg: "RS256",
  };
  const issuer = "https://nmt-fixture.clerk.accounts.dev";
  const identities = new Map<string, { email: string; verified: boolean }>();
  const sessions = new Map<string, { userId: string; status: string }>();
  let providerUnavailable = false;
  const provider = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    output += `\nProvider: ${path}\n`;
    res.setHeader("Content-Type", "application/json");
    if (providerUnavailable) {
      res.writeHead(503).end("{}");
      return;
    }
    if (path === "/v1/jwks") {
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    const user = identities.get(path.replace("/v1/users/", ""));
    if (user) {
      const id = path.replace("/v1/users/", "");
      res.end(
        JSON.stringify({
          id,
          object: "user",
          banned: false,
          locked: false,
          primary_email_address_id: `email_${id}`,
          email_addresses: [
            {
              id: `email_${id}`,
              object: "email_address",
              email_address: user.email,
              linked_to: [],
              verification: {
                status: user.verified ? "verified" : "unverified",
                strategy: "email_code",
              },
            },
          ],
        }),
      );
      return;
    }
    const sessionId = path.replace("/v1/sessions/", "");
    const session = sessions.get(sessionId);
    if (session) {
      res.end(
        JSON.stringify({
          id: sessionId,
          object: "session",
          user_id: session.userId,
          status: session.status,
        }),
      );
      return;
    }
    res.writeHead(404).end(
      JSON.stringify({
        errors: [{ code: "resource_not_found", message: "Not found" }],
      }),
    );
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const address = provider.address();
  if (!address || typeof address === "string")
    throw new Error("No provider port");
  const providerPort = address.port;
  const apiPort = await freePort();
  const url = `http://127.0.0.1:${apiPort}`;
  const databaseUrl = `postgresql://postgres:local-test-only@127.0.0.1:${pgPort}/nmt_test`;
  let child: ChildProcess | undefined;
  let output = "";
  async function stopApi() {
    if (child && child.exitCode === null) {
      const exited = once(child, "exit");
      if (process.platform === "win32") {
        const killer = spawn(
          "taskkill",
          ["/pid", String(child.pid), "/T", "/F"],
          { windowsHide: true },
        );
        await once(killer, "exit");
      } else child.kill("SIGTERM");
      await exited;
    }
    child = undefined;
  }
  async function startApi() {
    child = spawn(
      process.execPath,
      [
        resolve("../../node_modules/next/dist/bin/next"),
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(apiPort),
      ],
      {
        cwd: resolve("."),
        windowsHide: true,
        env: {
          ...process.env,
          NODE_ENV: "development",
          NEXT_TELEMETRY_DISABLED: "1",
          DATABASE_URL: databaseUrl,
          CLERK_SECRET_KEY: "sk_test_fixture_not_a_real_secret",
          CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from("nmt-fixture.clerk.accounts.dev$").toString("base64")}`,
          CLERK_API_URL: `http://127.0.0.1:${providerPort}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout?.on("data", (data) => {
      output += data;
    });
    child.stderr?.on("data", (data) => {
      output += data;
    });
    for (let attempt = 0; attempt < 200; attempt++) {
      try {
        if ((await fetch(url, { signal: AbortSignal.timeout(3000) })).ok)
          return;
      } catch {}
      if (child.exitCode !== null) throw new Error(`Next.js exited: ${output}`);
      await new Promise((done) => setTimeout(done, 150));
    }
    throw new Error(`Next.js failed to start: ${output}`);
  }
  async function cleanup() {
    await stopApi();
    await new Promise<void>((done) => provider.close(() => done()));
    await postgres.stop();
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
  }
  try {
    await postgres.initialise();
    await postgres.start();
    await postgres.createDatabase("nmt_test");
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await migrate(pool);
      await migrate(pool);
    } finally {
      await pool.end();
    }
    await startApi();
  } catch (error) {
    await cleanup();
    throw error;
  }
  return {
    url,
    databaseUrl,
    postgres,
    restartApi: async () => {
      await stopApi();
      await startApi();
    },
    close: cleanup,
    logs: () => output,
    providerAvailable: (available: boolean) => {
      providerUnavailable = !available;
    },
    revoke: (sessionId: string) => {
      const session = sessions.get(sessionId);
      if (session) session.status = "revoked";
    },
    token: async (
      id: string,
      email: string,
      options: {
        verified?: boolean;
        expired?: boolean;
        issuer?: string;
        sessionId?: string;
        azp?: string;
      } = {},
    ) => {
      identities.set(id, { email, verified: options.verified ?? true });
      const sessionId = options.sessionId ?? `sess_${id}`;
      sessions.set(sessionId, { userId: id, status: "active" });
      return new SignJWT({
        sid: sessionId,
        v: 2,
        sts: "active",
        fva: [0, -1],
        ...(options.azp ? { azp: options.azp } : {}),
      })
        .setProtectedHeader({
          alg: "RS256",
          kid: "fixture-key",
          typ: "JWT",
          cat: "cl_B7d4PD111AAA",
        })
        .setSubject(id)
        .setIssuer(options.issuer ?? issuer)
        .setIssuedAt()
        .setNotBefore("-5s")
        .setExpirationTime(options.expired ? "-2m" : "10m")
        .sign(privateKey);
    },
    request: async (
      path: string,
      token?: string,
      body?: unknown,
      method = body ? "PUT" : "GET",
    ) => {
      const response = await fetch(`${url}${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const raw = await response.text();
      let data: any;
      try {
        data = JSON.parse(raw);
      } catch {
        data = raw.slice(0, 500);
      }
      return { status: response.status, headers: response.headers, data };
    },
  };
}
