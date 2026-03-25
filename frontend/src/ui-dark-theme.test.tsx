import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

describe("dark compact ui primitives", () => {
  test("button default variant uses compact dark console styling", () => {
    const markup = renderToStaticMarkup(<Button>Run</Button>);

    expect(markup).toContain("h-9");
    expect(markup).toContain("border-white/12");
    expect(markup).toContain("bg-white");
    expect(markup).toContain("text-black");
  });

  test("card uses dark glass panel styling", () => {
    const markup = renderToStaticMarkup(<Card>Panel</Card>);

    expect(markup).toContain("rounded-[1.35rem]");
    expect(markup).toContain("border-white/10");
    expect(markup).toContain("bg-white/[0.03]");
    expect(markup).toContain("backdrop-blur-xl");
  });

  test("input keeps compact dark field appearance", () => {
    const markup = renderToStaticMarkup(<Input placeholder="dataset" />);

    expect(markup).toContain("h-9");
    expect(markup).toContain("border-white/10");
    expect(markup).toContain("bg-black/30");
    expect(markup).toContain("placeholder:text-zinc-500");
  });

  test("outline badge renders subdued telemetry chip styling", () => {
    const markup = renderToStaticMarkup(<Badge variant="outline">queued</Badge>);

    expect(markup).toContain("border-white/12");
    expect(markup).toContain("bg-white/[0.04]");
    expect(markup).toContain("text-zinc-200");
  });
});
