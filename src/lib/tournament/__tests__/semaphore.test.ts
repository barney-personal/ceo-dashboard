import { describe, expect, it } from "vitest";
import { Semaphore } from "../semaphore";

describe("Semaphore", () => {
  it("rejects zero or negative capacity", () => {
    expect(() => new Semaphore(0)).toThrow();
    expect(() => new Semaphore(-1)).toThrow();
  });

  it("never lets more than capacity tasks run concurrently", async () => {
    const cap = 3;
    const sem = new Semaphore(cap);
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 25 }, () =>
      sem.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 10 + Math.random() * 10));
        active--;
      }),
    );
    await Promise.all(tasks);
    expect(peak).toBeLessThanOrEqual(cap);
  });

  it("releases capacity even when the task throws", async () => {
    const sem = new Semaphore(1);
    await expect(
      sem.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    let ran = false;
    await sem.run(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("processes waiters in FIFO order", async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];
    const ack = sem.run(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const t1 = sem.run(async () => {
      order.push(1);
    });
    const t2 = sem.run(async () => {
      order.push(2);
    });
    const t3 = sem.run(async () => {
      order.push(3);
    });
    await Promise.all([ack, t1, t2, t3]);
    expect(order).toEqual([1, 2, 3]);
  });
});
