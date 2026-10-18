// Downloads country images many at a time and clips them on a pool of workers,
// one job per worker at a time, lowest priority number first. A job is keyed by
// country: a new job for the same key cancels the old one, whether it is still
// waiting, downloading or being clipped, and the old promise resolves to null.
// The next jobs download while others clip, so the workers don't wait on the network.
const DOWNLOADS_IN_FLIGHT = 24;

export function createClipQueue(workerCount) {
  const toDownload = []; // jobs waiting for a download slot
  const toClip = []; // downloaded jobs waiting for a worker
  const jobs = new Map(); // key -> job, until it's done
  const running = new Map(); // job id -> job being clipped
  const idle = [];
  let downloading = 0;
  let nextId = 0;

  for (let i = 0; i < workerCount; i++) {
    const worker = new Worker(new URL('./clipWorker.js', import.meta.url));
    worker.onmessage = (e) => {
      const { id, results, error } = e.data;
      const job = running.get(id);
      running.delete(id);
      if (jobs.get(job.key) === job) jobs.delete(job.key);
      if (job.cancelled) job.resolve(null);
      else if (error) job.reject(new Error(error));
      else job.resolve(results);
      idle.push(worker);
      dispatch();
    };
    idle.push(worker);
  }

  function dispatch() {
    while (downloading < DOWNLOADS_IN_FLIGHT && toDownload.length) download(takeFirst(toDownload));
    while (idle.length && toClip.length) {
      const job = takeFirst(toClip);
      job.worker = idle.pop();
      running.set(job.id, job);
      job.worker.postMessage({ ...job.request, id: job.id, blob: job.blob });
      job.blob = null;
    }
  }

  async function download(job) {
    downloading++;
    try {
      job.blob = await fetchBlob(job.request.url, { signal: job.controller.signal });
      if (!job.cancelled) toClip.push(job);
    } catch (err) {
      if (!job.cancelled) {
        jobs.delete(job.key);
        job.reject(err);
      }
    } finally {
      downloading--;
      dispatch();
    }
  }

  function cancel(key) {
    const job = jobs.get(key);
    if (!job) return;
    jobs.delete(key);
    job.cancelled = true;
    job.controller.abort();
    if (job.worker) {
      // The worker answers the cancel like any job, which frees it for the next one
      job.worker.postMessage({ cancel: job.id });
    } else {
      remove(toDownload, job);
      remove(toClip, job);
      job.resolve(null);
    }
  }

  return {
    cancel,
    // Reorders a job that hasn't been clipped yet, e.g. when its country scrolls into view
    setPriority(key, priority) {
      const job = jobs.get(key);
      if (job) job.priority = priority;
    },
    // request: { url, crop, rings }, as clipWorker.js takes it, with the image's
    // URL in place of the image
    clip(key, request, priority = 0) {
      cancel(key);
      return new Promise((resolve, reject) => {
        const job = { key, priority, resolve, reject, request, id: nextId++, controller: new AbortController() };
        jobs.set(key, job);
        toDownload.push(job);
        // After the caller's other jobs are in, so the first downloads are the
        // most urgent ones rather than the first asked for
        queueMicrotask(dispatch);
      });
    }
  };
}

// Lowest priority number, the earliest of those on a tie
function takeFirst(list) {
  let first = 0;
  for (let i = 1; i < list.length; i++) {
    if (list[i].priority < list[first].priority) first = i;
  }
  return list.splice(first, 1)[0];
}

function remove(list, item) {
  const index = list.indexOf(item);
  if (index >= 0) list.splice(index, 1);
}

// Retries server errors and dropped connections, which static hosts' CDNs
// return now and then, a couple of times with a short pause
async function fetchBlob(url, { signal }, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(url, { signal });
    } catch (err) {
      if (signal.aborted || attempt >= retries) throw err;
    }
    if (response?.ok) return response.blob();
    if (response && (response.status < 500 || attempt >= retries)) throw new Error(`HTTP ${response.status} for ${url}`);
    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    signal.throwIfAborted();
  }
}
