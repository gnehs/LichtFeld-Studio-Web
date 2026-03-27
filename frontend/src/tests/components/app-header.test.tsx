import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AppHeader } from "@/components/app/AppHeader";

describe("AppHeader", () => {
  test("renders dataset link in header", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <AppHeader onLogout={vi.fn(async () => {})} logoutPending={false} />
      </MemoryRouter>,
    );

    expect(markup).toContain('href="/datasets"');
    expect(markup).toContain("資料集");
    expect(markup).toContain('href="/jobs"');
    expect(markup).toContain("任務");
    expect(markup).toContain("登出");
  });
});
