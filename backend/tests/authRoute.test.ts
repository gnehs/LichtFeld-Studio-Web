import bcrypt from "bcryptjs";
import { describe, expect, it, vi } from "vitest";

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
};

function makeResponse(): MockResponse {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

async function getLoginHandler(password: string) {
  process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash(password, 4);
  vi.resetModules();

  const { authRouter } = await import("../src/routes/auth.js");
  const layer = authRouter.stack.find((entry) => entry.route?.path === "/login");
  const handler = layer?.route?.stack?.[0]?.handle;

  if (!handler) {
    throw new Error("Login handler not found");
  }

  return handler as (req: any, res: MockResponse) => Promise<unknown>;
}

describe("auth login route", () => {
  it("persists the session before returning success", async () => {
    const handler = await getLoginHandler("secret-pass");
    const save = vi.fn((callback: (error?: Error) => void) => callback());
    const response = makeResponse();
    const request = {
      body: { password: "secret-pass" },
      session: {
        authenticated: false,
        save
      }
    };

    await handler(request, response);

    expect(request.session.authenticated).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ success: true });
  });

  it("returns 500 when the session cannot be saved", async () => {
    const handler = await getLoginHandler("secret-pass");
    const save = vi.fn((callback: (error?: Error) => void) => callback(new Error("disk full")));
    const response = makeResponse();
    const request = {
      body: { password: "secret-pass" },
      session: {
        authenticated: false,
        save
      }
    };

    await handler(request, response);

    expect(request.session.authenticated).toBe(true);
    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ message: "Failed to persist session" });
  });

  it("rejects an invalid password without touching the session", async () => {
    const handler = await getLoginHandler("secret-pass");
    const save = vi.fn();
    const response = makeResponse();
    const request = {
      body: { password: "wrong-pass" },
      session: {
        authenticated: false,
        save
      }
    };

    await handler(request, response);

    expect(request.session.authenticated).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ message: "Invalid password" });
  });
});
