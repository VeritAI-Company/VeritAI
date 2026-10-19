"""Controlled benchmark for the request-thread offloading change.

It compares the previous event-loop blocking pattern with the current
asyncio.to_thread pattern using identical 150 ms simulated CPU work.
"""

import asyncio
import json
import statistics
import time


WORK_SECONDS = 0.150
HEARTBEAT_SECONDS = 0.020
RUNS = 30


async def heartbeat_delay_ms():
    started = time.perf_counter()
    await asyncio.sleep(HEARTBEAT_SECONDS)
    return (time.perf_counter() - started) * 1000


async def blocking_sample():
    heartbeat = asyncio.create_task(heartbeat_delay_ms())
    await asyncio.sleep(0)
    time.sleep(WORK_SECONDS)
    return await heartbeat


async def offloaded_sample():
    heartbeat = asyncio.create_task(heartbeat_delay_ms())
    await asyncio.sleep(0)
    await asyncio.to_thread(time.sleep, WORK_SECONDS)
    return await heartbeat


def percentile(values, percentage):
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * percentage)))
    return ordered[index]


async def main():
    blocking = [await blocking_sample() for _ in range(RUNS)]
    offloaded = [await offloaded_sample() for _ in range(RUNS)]
    result = {
        "runs": RUNS,
        "simulatedWorkMs": int(WORK_SECONDS * 1000),
        "targetHeartbeatMs": int(HEARTBEAT_SECONDS * 1000),
        "blockingMedianMs": round(statistics.median(blocking), 2),
        "blockingP95Ms": round(percentile(blocking, 0.95), 2),
        "offloadedMedianMs": round(statistics.median(offloaded), 2),
        "offloadedP95Ms": round(percentile(offloaded, 0.95), 2),
    }
    result["medianDelayReductionPercent"] = round(
        (1 - result["offloadedMedianMs"] / result["blockingMedianMs"]) * 100,
        2,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
