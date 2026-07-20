import { fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SliderNumberField } from "../ui/SliderNumberField";

describe("SliderNumberField", () => {
  it("keeps the range and numeric input on the same value contract", () => {
    const onValueChange = vi.fn();
    const { getByLabelText } = render(
      <SliderNumberField
        aria-label="Weight"
        max={1}
        min={0}
        numberInputAriaLabel="Weight value"
        onValueChange={onValueChange}
        step={0.01}
        value={0.25}
      />,
    );

    const slider = getByLabelText("Weight") as HTMLInputElement;
    const number = getByLabelText("Weight value") as HTMLInputElement;
    expect(slider.value).toBe("0.25");
    expect(number.value).toBe("0.25");

    fireEvent.change(slider, { target: { value: "0.5" } });
    expect(onValueChange).toHaveBeenCalledWith(0.5);

    fireEvent.focus(number);
    fireEvent.change(number, { target: { value: "0.75" } });
    expect(onValueChange).toHaveBeenCalledWith(0.75);
  });

  it("clamps committed numeric values to the slider range", () => {
    const onValueChange = vi.fn();
    function ControlledSlider() {
      const [value, setValue] = useState(0);
      return (
        <SliderNumberField
          aria-label="Weight"
          max={1}
          min={0}
          numberInputAriaLabel="Weight value"
          onValueChange={(nextValue) => {
            onValueChange(nextValue);
            setValue(nextValue);
          }}
          value={value}
        />
      );
    }
    const { getByLabelText } = render(<ControlledSlider />);

    const number = getByLabelText("Weight value") as HTMLInputElement;
    fireEvent.focus(number);
    fireEvent.change(number, { target: { value: "2" } });
    fireEvent.blur(number);

    expect(onValueChange).toHaveBeenLastCalledWith(1);
    expect(number.value).toBe("1.00");
  });
});
