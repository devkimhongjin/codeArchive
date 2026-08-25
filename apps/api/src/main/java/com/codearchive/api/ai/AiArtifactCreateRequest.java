package com.codearchive.api.ai;

import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;
import com.fasterxml.jackson.databind.JsonNode;

public record AiArtifactCreateRequest(
        AiArtifactType type
) {

    public static AiArtifactCreateRequest from(JsonNode body) {
        if (body == null
                || !body.isObject()
                || body.size() != 1
                || !body.hasNonNull("type")
                || !body.get("type").isTextual()) {
            throw invalidRequest();
        }

        try {
            return new AiArtifactCreateRequest(
                    AiArtifactType.valueOf(
                            body.get("type").textValue()
                    )
            );
        } catch (IllegalArgumentException exception) {
            throw invalidRequest();
        }
    }

    private static CodeArchiveException invalidRequest() {
        return new CodeArchiveException(
                ErrorCode.INVALID_REQUEST
        );
    }
}
