import { describe, expect, it, vi } from "vitest";
import { createEmbeddingWarmup } from "./embedding-warmup.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("embedding warm-up", () => {
  it("embeds once for the first message of a workbench with vectors", async () => {
    const hasVectors = vi.fn(async () => "/bench");
    const embed = vi.fn(async () => {});
    const warmup = createEmbeddingWarmup({ hasVectors, embed });
    warmup.request("w1");
    warmup.request("w1");
    await tick();
    warmup.request("w1");
    await tick();
    expect(hasVectors).toHaveBeenCalledTimes(1);
    expect(hasVectors).toHaveBeenCalledWith("w1");
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith("/bench", expect.any(AbortSignal));
  });

  it("starts no embedding when the workbench has no vectors and tries again on a later message", async () => {
    let root: string | undefined;
    const embed = vi.fn(async () => {});
    const warmup = createEmbeddingWarmup({ hasVectors: async () => root, embed });
    warmup.request("w1");
    await tick();
    expect(embed).not.toHaveBeenCalled();
    root = "/bench";
    warmup.request("w1");
    await tick();
    warmup.request("w1");
    await tick();
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith("/bench", expect.any(AbortSignal));
  });

  it("aborts on close and warms again after the workbench reopens", async () => {
    const signals: AbortSignal[] = [];
    const embed = vi.fn(
      (_root: string, signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signals.push(signal);
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const warmup = createEmbeddingWarmup({ hasVectors: async () => "/bench", embed });
    warmup.request("w1");
    await tick();
    expect(signals[0]?.aborted).toBe(false);
    warmup.cancel();
    expect(signals[0]?.aborted).toBe(true);
    warmup.request("w1");
    await tick();
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it("does not embed when closed while the vector check runs", async () => {
    let answer: (root: string) => void = () => {};
    const embed = vi.fn(async () => {});
    const warmup = createEmbeddingWarmup({
      hasVectors: () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
      embed,
    });
    warmup.request("w1");
    warmup.cancel();
    answer("/bench");
    await tick();
    expect(embed).not.toHaveBeenCalled();
  });

  it("ignores a failed check or embedding", async () => {
    const failing = createEmbeddingWarmup({
      hasVectors: async () => {
        throw Error("closed");
      },
      embed: async () => {},
    });
    failing.request("w1");
    const broken = createEmbeddingWarmup({
      hasVectors: async () => "/bench",
      embed: async () => {
        throw Error("indexer stopped");
      },
    });
    broken.request("w1");
    await tick();
  });
});
