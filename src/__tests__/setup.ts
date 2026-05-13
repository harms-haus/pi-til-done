import { vi } from "vitest";

/** Mock Text class for testing */
class MockText {
  constructor(
    private _text: string,
    _x: number,
    _y: number,
  ) {}

  toString(): string {
    return this._text;
  }

  render(_width: number): string[] {
    // Simple mock that returns text split into lines
    if (this._text === "") {
      return [];
    }
    const lines = this._text.split("\n");
    return lines;
  }
}

// Mock the Text class globally
vi.mock("@earendil-works/pi-tui", () => ({
  Text: MockText,
}));
