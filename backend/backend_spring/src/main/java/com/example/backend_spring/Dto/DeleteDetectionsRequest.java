package com.example.backend_spring.Dto;

import java.util.List;

public class DeleteDetectionsRequest {

    private List<Long> requestIds;

    public List<Long> getRequestIds() {
        return requestIds;
    }

    public void setRequestIds(List<Long> requestIds) {
        this.requestIds = requestIds;
    }
}
