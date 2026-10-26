/** Admission starts only after preparation and permission waits have completed. */
export class WriteQueue {
  private tail: Promise<void> = Promise.resolve();
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  async drain(): Promise<void> {
    await this.tail;
  }
}
