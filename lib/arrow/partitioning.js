const TIME_PARTITION_SECONDS = 6 * 3600;

function timePartitionKey(epochSeconds) {
  const start =
    Math.floor(epochSeconds / TIME_PARTITION_SECONDS) * TIME_PARTITION_SECONDS;
  return new Date(start * 1000).toISOString().slice(0, 13); // YYYY-MM-DDTHH, UTC
}

module.exports = { TIME_PARTITION_SECONDS, timePartitionKey };
