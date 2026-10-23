package com.example.backend_spring.Service;

import java.util.concurrent.TimeUnit;

public interface DetectionJobQueue {
    boolean offer(DetectionJob job);

    DetectionJob poll(long timeout, TimeUnit unit) throws InterruptedException;

    int size();

    int remainingCapacity();

    int capacity();

    default boolean durable() {
        return false;
    }
}
