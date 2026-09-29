import { describe } from "bun:test";
import { clockContract } from "../../../application/ports/clock.contract.ts";
import { systemClock } from "./system-clock.ts";

describe("systemClock", () => {
	clockContract(() => systemClock);
});
