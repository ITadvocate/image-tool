let activeJobs = 0;
let chain = Promise.resolve();

function enqueue(task) {
  const runner = async () => {
    activeJobs += 1;

    try {
      return await task();
    } finally {
      activeJobs -= 1;
    }
  };

  const scheduled = chain.then(runner, runner);
  chain = scheduled.catch(() => undefined);
  return scheduled;
}

function getQueueState() {
  return {
    activeJobs
  };
}

module.exports = {
  enqueue,
  getQueueState
};
