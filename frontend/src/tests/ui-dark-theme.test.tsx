import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

describe("dark compact ui primitives", () => {
  test("button default variant uses compact dark console styling", () => {
    const markup = renderToStaticMarkup(<Button>Run</Button>);

    expect(markup).toContain("h-8");
    expect(markup).toContain("rounded-lg");
    expect(markup).toContain("bg-primary");
    expect(markup).toContain("text-primary-foreground");
  });

  test("card uses dark glass panel styling", () => {
    const markup = renderToStaticMarkup(<Card>Panel</Card>);

    expect(markup).toContain("rounded-xl");
    expect(markup).toContain("bg-card");
    expect(markup).toContain("text-card-foreground");
    expect(markup).toContain("ring-foreground/10");
  });

  test("input keeps compact dark field appearance", () => {
    const markup = renderToStaticMarkup(<Input placeholder="dataset" />);

    expect(markup).toContain("h-8");
    expect(markup).toContain("border-input");
    expect(markup).toContain("dark:bg-input/30");
    expect(markup).toContain("placeholder:text-muted-foreground");
  });

  test("outline badge renders subdued telemetry chip styling", () => {
    const markup = renderToStaticMarkup(<Badge variant="outline">queued</Badge>);

    expect(markup).toContain("border-border");
    expect(markup).toContain("text-foreground");
    expect(markup).toContain("rounded-4xl");
  });
});
