import { createRef } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("forwards its ref to the native button", () => {
    const ref = createRef<HTMLButtonElement>();

    render(<Button ref={ref}>保存</Button>);

    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});
