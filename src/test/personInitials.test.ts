// Avatar letters shown when a profile photo is missing or fails to load.
//
// Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { personInitials } from "../lib/textFormat";

describe("personInitials", () => {
  it("is the first letter of the first and last name", () => {
    assert.equal(personInitials("nikhil", "sharma", "n@x.com"), "NS");
  });

  it("is the first name's letter when there's no last name", () => {
    assert.equal(personInitials("Nikhil", "", "n@x.com"), "N");
    assert.equal(personInitials(" Nikhil ", null), "N");
  });

  it("falls back to the email's first letter, then ?", () => {
    assert.equal(personInitials("", "  ", "zoe@x.com"), "Z");
    assert.equal(personInitials(undefined, undefined, undefined), "?");
  });
});
