package com.codearchive.api.auth;

public class CsrfResponse {
    private final String headerName;
    private final String token;

    public CsrfResponse(String token) {
        this.headerName = "X-XSRF-TOKEN";
        this.token = token;
    }

    public String getHeaderName() {
        return headerName;
    }

    public String getToken() {
        return token;
    }
}
