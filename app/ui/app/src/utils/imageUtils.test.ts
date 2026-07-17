import { describe, it, expect } from "vitest";
import { isImageFile } from "./imageUtils";

describe("isImageFile", () => {
  it.each(["photo.png", "image.jpg", "pic.jpeg", "anim.gif", "modern.webp"])(
    "returns true for image file: %s",
    (filename) => {
      expect(isImageFile(filename)).toBe(true);
    },
  );

  it.each(["document.pdf", "readme.txt", "report.doc"])(
    "returns false for non-image file: %s",
    (filename) => {
      expect(isImageFile(filename)).toBe(false);
    },
  );

  it("returns false when there is no extension", () => {
    expect(isImageFile("noextension")).toBe(false);
  });

  it.each(["PHOTO.PNG", "Image.Jpg", "PIC.JPEG", "ANIM.GIF", "MODERN.WEBP"])(
    "is case insensitive: %s",
    (filename) => {
      expect(isImageFile(filename)).toBe(true);
    },
  );

  it("handles multiple dots correctly (photo.backup.jpg)", () => {
    expect(isImageFile("photo.backup.jpg")).toBe(true);
    expect(isImageFile("archive.tar.gz")).toBe(false);
  });
});
