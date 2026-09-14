// Loader threads own decoding temporarily, then transfer the backing buffers.
export class LoaderPool {
  constructor(createWorker, size = 2) {
    this.queue = [];
    this.workers = [];
    try {
      for (let i = 0; i < size; i += 1) {
        const worker = createWorker();
        const slot = { worker, job: null };
        this.workers.push(slot);
        worker.addEventListener("message", ({ data }) => {
          const job = slot.job;
          if (!job) return;
          slot.job = null;
          if (data.error) job.reject(new Error(data.error));
          else job.resolve(data.batches);
          this.dispatch();
        });
        const fail = (event) =>
          this.fail(new Error(event.message || "Page loader worker failed"));
        worker.addEventListener("error", fail);
        worker.addEventListener("messageerror", fail);
      }
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }
  fail(error) {
    this.failure = error;
    for (const slot of this.workers) {
      slot.job?.reject(error);
      slot.job = null;
      slot.worker.terminate();
    }
    for (const job of this.queue.splice(0)) job.reject(error);
  }
  load(request) {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.queue.push({ request, resolve, reject });
      this.dispatch();
    });
  }
  dispatch() {
    for (const slot of this.workers)
      if (!slot.job && this.queue.length) {
        slot.job = this.queue.shift();
        try {
          slot.worker.postMessage(slot.job.request);
        } catch (error) {
          this.fail(error);
          return;
        }
      }
  }
}
