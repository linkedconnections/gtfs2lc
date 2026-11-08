module.exports = {
  // Keep source offsets identical in Jest, CLI subprocesses, and workers so c8
  // can merge their native coverage without mixing in transformed copies.
  transform: {},
};
